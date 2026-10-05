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

// Rates from the start of Bitcoin on: carry-in lots and other operations may be older than the
// chart history (1 January 2025) and still need the rate of their own date.
export const FX_HISTORY_FROM = '2009-01-01';
export const FX_SOURCE_KEY = 'fx:cbr';
const SOURCE = 'cbr';
// Re-read a week back so a day missed by an outage is filled on the next run.
const OVERLAP_DAYS = 7;
// Arbitrary constant identifying the rate collector's session advisory lock.
const LOCK_KEY = 7_340_600_002;
const INTERRUPTED_AFTER_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
// One request per four years keeps an answer near 150 KB, well under the client's limit.
const REQUEST_DAYS = 4 * 365;
// The Bank of Russia sets a rate for every working day; its longest pause, the New Year
// holidays, is under two weeks. A longer stretch without rates is a range a failed
// request left out.
const HOLE_DAYS = 20;
// An unreadable answer for a longer range is asked for again in two halves, so a refused
// part leaves out at most this many days, still a hole the next runs ask for again.
const SPLIT_ABOVE_DAYS = 45;
// Unreadable answers one run accepts per currency before it stops asking.
const MAX_UNREADABLE = 16;
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
// A month earlier, so the rate in effect on 1 January 2009 (set before the holidays) is stored.
const HISTORY_REQUEST_FROM = addDays(FX_HISTORY_FROM, -31);

function split(from: string, to: string): [string, string][] {
  const ranges: [string, string][] = [];
  for (let start = from; start <= to; ) {
    const end = addDays(start, REQUEST_DAYS - 1);
    ranges.push([start, end < to ? end : to]);
    start = addDays(end, 1);
  }
  return ranges;
}

/**
 * Inclusive date ranges to ask for one currency: the last week before the latest stored
 * rate up to `to` first, then, newest first, every hole of more than HOLE_DAYS between
 * stored rates and the years before the earliest one while it is later than 2009. On the
 * first run that is the whole history. A range that keeps failing never holds back the
 * rates read before it.
 */
export function fxRequestRanges(
  stored: { first: string; last: string; gaps?: [string, string][] } | undefined,
  to: string,
): [string, string][] {
  if (!stored) return split(HISTORY_REQUEST_FROM, to).reverse();
  const missing = (stored.gaps ?? [])
    .filter(([before, after]) => Date.parse(after) - Date.parse(before) > HOLE_DAYS * DAY_MS)
    .map(([before, after]): [string, string] => [addDays(before, 1), addDays(after, -1)]);
  if (stored.first > FX_HISTORY_FROM)
    missing.push([HISTORY_REQUEST_FROM, addDays(stored.first, -1)]);
  return [
    ...split(addDays(stored.last, -OVERLAP_DAYS), to),
    ...missing
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .flatMap(([from, until]) => split(from, until).reverse()),
  ];
}

/** The newer and the older half of an inclusive range longer than SPLIT_ABOVE_DAYS. */
export function fxSplitUnreadable(from: string, until: string): [string, string][] | null {
  const days = (Date.parse(until) - Date.parse(from)) / DAY_MS + 1;
  if (days <= SPLIT_ABOVE_DAYS) return null;
  const middle = addDays(from, Math.floor(days / 2) - 1);
  return [
    [addDays(middle, 1), until],
    [from, middle],
  ];
}

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

  // Reads the history from 2009 once, then re-reads the last week up to tomorrow, whose
  // rate the Bank of Russia publishes in the afternoon.
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
    const stored: { currency: RatedCurrency; first: string; last: string }[] =
      await this.source.query(
        `SELECT currency, to_char(min("rateDate"), 'YYYY-MM-DD') AS first,
           to_char(max("rateDate"), 'YYYY-MM-DD') AS last
         FROM fx_rates WHERE source = $1 GROUP BY currency`,
        [SOURCE],
      );
    const holes: { currency: RatedCurrency; before: string; after: string }[] =
      await this.source.query(
        `SELECT currency, to_char("rateDate", 'YYYY-MM-DD') AS before, to_char(next, 'YYYY-MM-DD') AS after
         FROM (SELECT currency, "rateDate",
                 lead("rateDate") OVER (PARTITION BY currency ORDER BY "rateDate") AS next
               FROM fx_rates WHERE source = $1) AS r
         WHERE next - "rateDate" > $2 ORDER BY currency, "rateDate"`,
        [SOURCE, HOLE_DAYS],
      );
    const bounds = new Map(
      stored.map(({ currency, ...row }) => [
        currency,
        {
          ...row,
          gaps: holes
            .filter((hole) => hole.currency === currency)
            .map(({ before, after }): [string, string] => [before, after]),
        },
      ]),
    );
    const rows: { currency: RatedCurrency; rate: FxRate }[] = [];
    // A currency, or the range of it an unreadable answer kept out.
    const failed: string[] = [];
    // What the first refused answer held; the state has room for one.
    let detail: string | undefined;
    let reason: FxFailure | null = null;
    for (const currency of ratedCurrencies) {
      const queue = fxRequestRanges(bounds.get(currency), to);
      let unreadable = 0;
      for (let range = queue.shift(); range; range = queue.shift()) {
        const [from, until] = range;
        const result = await this.cbr.dynamic(currency, from, until);
        if (result.ok) {
          rows.push(...result.rates.map((rate) => ({ currency, rate })));
          continue;
        }
        const halves = fxSplitUnreadable(from, until);
        if (result.reason === 'invalid_response' && ++unreadable <= MAX_UNREADABLE) {
          // The same answer every time: read the halves around the refused part, newer first,
          // so only a short range stays missing; its hole is asked for again every hour.
          if (halves) queue.unshift(...halves);
          else {
            reason ??= result.reason;
            this.logger.warn(
              `Bank of Russia unreadable for ${currency} ${from}..${until}: ${result.detail}`,
            );
            failed.push(`${currency} ${from}..${until}`);
            detail ??= result.detail;
          }
          continue;
        }
        // The next hourly run asks again for this and the older ranges; the ranges already
        // read are kept.
        this.logger.warn(`Bank of Russia ${result.reason} for ${currency} ${from}..${until}`);
        reason ??= result.reason;
        failed.push(currency);
        break;
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
              state: ratedCurrencies.every((currency) => failed.includes(currency))
                ? 'failed'
                : 'delayed',
              errorCode: reason,
              errorMessage:
                `Bank of Russia ${FAILURE_TEXT[reason!]}; no new rates for ${failed.join(', ')}${detail ? ` (${detail})` : ''}`.slice(
                  0,
                  300,
                ),
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

  /** Rates effective on a Moscow date (today by default) and the collector's state. */
  async read(now = new Date(), date?: string) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const today = date ?? moscowDate(now);
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
