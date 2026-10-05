import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import { isDue, nextRunAt } from '../prices/price-collection';
import { CbrClient, type FxFailure } from './cbr-client';
import {
  type FxRate,
  type FxRates,
  moscowDate,
  type RatedCurrency,
  ratedCurrencies,
} from './fx-conversion';

export type FxCollectionResult =
  | { outcome: 'collected'; stored: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

// Owner decision Q4: history starts on 1 January 2025.
export const FX_BACKFILL_FROM = '2025-01-01';
export const FX_SOURCE_KEY = 'fx:cbr';
const SOURCE = 'cbr';
// Re-read a week back so a day missed by an outage is filled on the next run.
const OVERLAP_DAYS = 7;
// Arbitrary constant identifying the rate collector's session advisory lock.
const LOCK_KEY = 7_340_600_002;
const INTERRUPTED_AFTER_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const FAILURE_TEXT: Record<FxFailure, string> = {
  unavailable: 'did not answer',
  rate_limited: 'rate limit reached',
  invalid_response: 'sent an unreadable answer',
};

interface RateRow {
  currency: RatedCurrency;
  rateDate: string;
  rubPerUnit: string;
}
interface SourceRow {
  key: string;
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
// numeric(78,30) text without trailing zeros.
const exact = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
const iso = (date: Date | null) => date?.toISOString() ?? null;

/** Every stored Bank of Russia rate, ascending per currency (a few hundred rows a year). */
export async function readFxRates(manager: EntityManager): Promise<FxRates> {
  const rows: RateRow[] = await manager.query(
    `SELECT currency, to_char("rateDate", 'YYYY-MM-DD') AS "rateDate", "rubPerUnit"::text AS "rubPerUnit"
     FROM fx_rates WHERE source = $1 AND currency = ANY($2) ORDER BY currency, "rateDate"`,
    [SOURCE, ratedCurrencies],
  );
  const rates: Record<RatedCurrency, FxRate[]> = { USD: [], EUR: [] };
  for (const row of rows)
    rates[row.currency].push({ date: row.rateDate, rubPerUnit: exact(row.rubPerUnit) });
  return rates;
}

@Injectable()
export class FxRatesService {
  private readonly logger = new Logger(FxRatesService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    private readonly cbr: CbrClient,
  ) {}

  // Market data collection is one owner switch: rates follow the hourly prices (M3).
  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  @Interval(5 * 60_000)
  async scheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch {
      this.logger.warn('Bank of Russia rate collection could not finish');
    }
  }

  async tick(now = new Date()): Promise<FxCollectionResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    return this.collect(now, true);
  }

  // Backfills from 2025-01-01 on the first run, then re-reads the last week up to tomorrow,
  // whose rate the Bank of Russia publishes in the afternoon.
  async collect(now = new Date(), onlyIfDue = false): Promise<FxCollectionResult> {
    const runner = this.source.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      try {
        const [lock]: { locked: boolean }[] = await runner.query(
          'SELECT pg_try_advisory_xact_lock($1) AS locked',
          [LOCK_KEY],
        );
        if (!lock.locked) return { outcome: 'busy' };
        if (onlyIfDue) {
          const [row]: { at: Date | null }[] = await this.source.query(
            'SELECT "lastAttemptAt" AS at FROM sync_sources WHERE key = $1',
            [FX_SOURCE_KEY],
          );
          if (!isDue(row?.at ?? null, now)) return { outcome: 'not_due' };
        }
        return { outcome: 'collected', stored: await this.collectRates(now) };
      } finally {
        await runner.rollbackTransaction();
      }
    } finally {
      await runner.release();
    }
  }

  private async collectRates(now: Date): Promise<number> {
    const to = addDays(moscowDate(now), 1);
    const latest: { currency: RatedCurrency; last: string }[] = await this.source.query(
      `SELECT currency, to_char(max("rateDate"), 'YYYY-MM-DD') AS last
       FROM fx_rates WHERE source = $1 GROUP BY currency`,
      [SOURCE],
    );
    const lastDate = new Map(latest.map((row) => [row.currency, row.last]));
    const rows: { currency: RatedCurrency; rate: FxRate }[] = [];
    const failed: RatedCurrency[] = [];
    let reason: FxFailure | null = null;
    for (const currency of ratedCurrencies) {
      const last = lastDate.get(currency);
      const overlap = last ? addDays(last, -OVERLAP_DAYS) : FX_BACKFILL_FROM;
      const from = overlap < FX_BACKFILL_FROM ? FX_BACKFILL_FROM : overlap;
      const result = await this.cbr.dynamic(currency, from, to);
      if (result.ok) rows.push(...result.rates.map((rate) => ({ currency, rate })));
      else {
        failed.push(currency);
        reason ??= result.reason;
      }
    }
    return this.source.transaction(async (manager) => {
      const inserted: unknown[] = rows.length
        ? await manager.query(
            `INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit")
             SELECT currency, $1, "rateDate", "rubPerUnit"
             FROM unnest($2::text[], $3::date[], $4::numeric[]) AS r(currency, "rateDate", "rubPerUnit")
             ON CONFLICT DO NOTHING RETURNING currency`,
            [
              SOURCE,
              rows.map(({ currency }) => currency),
              rows.map(({ rate }) => rate.date),
              rows.map(({ rate }) => rate.rubPerUnit),
            ],
          )
        : [];
      const outcome =
        failed.length === 0
          ? { state: 'synced', errorCode: null, errorMessage: null }
          : {
              state: failed.length === ratedCurrencies.length ? 'failed' : 'delayed',
              errorCode: reason,
              errorMessage: `Bank of Russia ${FAILURE_TEXT[reason!]}; no new rates for ${failed.join(', ')}`,
            };
      await manager.query(
        `INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt", "errorCode", "errorMessage")
         VALUES ($1, $2, $3, CASE WHEN $4 THEN $3::timestamptz END, $5, $6, $7)
         ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state,
           "lastAttemptAt" = EXCLUDED."lastAttemptAt",
           "lastSuccessAt" = COALESCE(EXCLUDED."lastSuccessAt", sync_sources."lastSuccessAt"),
           "nextRunAt" = EXCLUDED."nextRunAt", "errorCode" = EXCLUDED."errorCode",
           "errorMessage" = EXCLUDED."errorMessage"`,
        [
          FX_SOURCE_KEY,
          outcome.state,
          now,
          failed.length === 0,
          nextRunAt(now),
          outcome.errorCode,
          outcome.errorMessage,
        ],
      );
      return inserted.length;
    });
  }

  /** Rates effective today (Moscow date) and the collector's state. */
  async read(now = new Date()) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const today = moscowDate(now);
      const rows: RateRow[] = await manager.query(
        `SELECT DISTINCT ON (currency) currency, to_char("rateDate", 'YYYY-MM-DD') AS "rateDate",
           "rubPerUnit"::text AS "rubPerUnit"
         FROM fx_rates WHERE source = $1 AND "rateDate" <= $2::date
         ORDER BY currency, "rateDate" DESC`,
        [SOURCE, today],
      );
      const [state]: SourceRow[] = await manager.query(
        'SELECT * FROM sync_sources WHERE key = $1',
        [FX_SOURCE_KEY],
      );
      const byCurrency = new Map(rows.map((row) => [row.currency, row]));
      const interrupted =
        state?.state === 'syncing' &&
        (!state.lastAttemptAt ||
          now.getTime() - state.lastAttemptAt.getTime() > INTERRUPTED_AFTER_MS);
      return {
        date: today,
        source: SOURCE,
        rates: ratedCurrencies.map((currency) => {
          const row = byCurrency.get(currency);
          return {
            currency,
            rubPerUnit: row ? exact(row.rubPerUnit) : null,
            date: row?.rateDate ?? null,
          };
        }),
        sync: state
          ? {
              key: state.key,
              state: interrupted ? 'failed' : state.state,
              lastAttemptAt: iso(state.lastAttemptAt),
              lastSuccessAt: iso(state.lastSuccessAt),
              nextRunAt: iso(state.nextRunAt),
              errorCode: interrupted ? 'interrupted' : state.errorCode,
              errorMessage: interrupted
                ? 'Collection stopped before it finished'
                : state.errorMessage,
            }
          : null,
      };
    });
  }
}
