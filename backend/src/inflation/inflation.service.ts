import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import { parseUuid } from '../accounting/input';
import { type AccountingCurrency, accountingCurrencies } from '../fx-rates/fx-conversion';
import { trackJob } from '../observability/metrics';
import {
  parseCurrency,
  parseFactorQuery,
  parseMonth,
  parseMonthlyChange,
  parsePersonalRate,
  parseTypedMonth,
} from './inflation-input';
import {
  buildSeries,
  formatFactor,
  type InflationFactor,
  type InflationSeries,
  officialFactor,
  personalFactor,
  trailingYearEstimated,
  trailingYearPercent,
} from './inflation-math';
import {
  InflationClient,
  type InflationFailure,
  OFFICIAL_SOURCES,
  PROVIDER_NAMES,
} from './inflation-sources';

export const INFLATION_SOURCE_KEY = 'fx:inflation';
// Arbitrary constant identifying the collector's session advisory lock.
const LOCK_KEY = 7_340_600_021;
const HOUR_MS = 3_600_000;
// The statistics offices publish once a month; twice a day is plenty, an hour after a failure.
const REFRESH_AFTER_MS = 12 * HOUR_MS;
const RETRY_AFTER_MS = HOUR_MS;
const FAILURE_TEXT: Record<InflationFailure, string> = {
  unavailable: 'did not answer',
  rate_limited: 'rate limit reached',
  invalid_response: 'sent an unreadable answer',
};

export type InflationCollectionResult =
  | { outcome: 'collected'; stored: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

interface MonthRow {
  month: string;
  changePercent: string;
}
interface SourceRow {
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;
// numeric text without trailing zeros.
const exact = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

const MONTH_ROWS = `to_char(month, 'YYYY-MM') AS month, "changePercent"::text AS "changePercent"`;

/** The official months of a currency, with the owner's own months laid over them. */
export async function readEffectiveChanges(
  manager: EntityManager,
  owner: string,
  currency: AccountingCurrency,
): Promise<{
  changes: Map<string, number> & { publishedLast: string | null };
  official: MonthRow[];
  manual: MonthRow[];
}> {
  const official: MonthRow[] = await manager.query(
    `SELECT ${MONTH_ROWS} FROM inflation_months WHERE currency = $1 ORDER BY month`,
    [currency],
  );
  const manual: MonthRow[] = await manager.query(
    `SELECT ${MONTH_ROWS} FROM inflation_manual_months
      WHERE "ownerId" = $1 AND currency = $2 ORDER BY month`,
    [owner, currency],
  );
  const changes = Object.assign(new Map<string, number>(), {
    publishedLast: official.length ? official[official.length - 1].month : null,
  });
  for (const row of [...official, ...manual]) changes.set(row.month, Number(row.changePercent));
  return { changes, official, manual };
}

export async function readPersonalRate(
  manager: EntityManager,
  owner: string,
  currency: AccountingCurrency,
): Promise<string | null> {
  const [row]: { annualPercent: string }[] = await manager.query(
    `SELECT "annualPercent"::text AS "annualPercent" FROM inflation_personal_rates
      WHERE "ownerId" = $1 AND currency = $2`,
    [owner, currency],
  );
  return row ? exact(row.annualPercent) : null;
}

@Injectable()
export class InflationService {
  private readonly logger = new Logger(InflationService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    private readonly client: InflationClient,
  ) {}

  // Market data collection is one owner switch, like the prices and the Bank of Russia rates.
  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  @Interval(30 * 60_000)
  async scheduledTick(): Promise<void> {
    try {
      await trackJob('inflation', () => this.tick());
    } catch {
      this.logger.warn('Inflation collection could not finish');
    }
  }

  async tick(now = new Date()): Promise<InflationCollectionResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    return this.collect(now, true);
  }

  async collect(now = new Date(), onlyIfDue = false): Promise<InflationCollectionResult> {
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
            'SELECT "nextRunAt" AS at FROM sync_sources WHERE key = $1',
            [INFLATION_SOURCE_KEY],
          );
          if (row?.at && row.at.getTime() > now.getTime()) return { outcome: 'not_due' };
        }
        return { outcome: 'collected', stored: await this.collectMonths(now) };
      } finally {
        await runner.rollbackTransaction();
      }
    } finally {
      await runner.release();
    }
  }

  private async collectMonths(now: Date): Promise<number> {
    const rows: {
      currency: AccountingCurrency;
      provider: string;
      month: string;
      percent: string;
    }[] = [];
    const failed: string[] = [];
    let reason: InflationFailure | null = null;
    let detail: string | undefined;
    for (const currency of accountingCurrencies) {
      const provider = OFFICIAL_SOURCES[currency];
      if (!provider) continue;
      const result = await this.client.fetch(provider);
      if (result.ok) {
        rows.push(
          ...result.changes.map(({ month, percent }) => ({ currency, provider, month, percent })),
        );
        continue;
      }
      this.logger.warn(
        `${PROVIDER_NAMES[provider]} ${FAILURE_TEXT[result.reason]} for ${currency}`,
      );
      reason ??= result.reason;
      detail ??= result.detail;
      failed.push(currency);
    }
    const sourced = accountingCurrencies.filter((currency) => OFFICIAL_SOURCES[currency]);
    return this.source.transaction(async (manager) => {
      let stored = 0;
      if (rows.length > 0) {
        const written: unknown[] = await manager.query(
          `INSERT INTO inflation_months (currency, month, provider, "changePercent", "fetchedAt")
           SELECT currency, (month || '-01')::date, provider, "changePercent", $5
           FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[])
             AS r(currency, month, provider, "changePercent")
           ON CONFLICT (currency, month) DO UPDATE
             SET provider = EXCLUDED.provider, "changePercent" = EXCLUDED."changePercent",
                 "fetchedAt" = EXCLUDED."fetchedAt"
             WHERE inflation_months."changePercent" IS DISTINCT FROM EXCLUDED."changePercent"
               OR inflation_months.provider <> EXCLUDED.provider
           RETURNING currency`,
          [
            rows.map(({ currency }) => currency),
            rows.map(({ month }) => month),
            rows.map(({ provider }) => provider),
            rows.map(({ percent }) => percent),
            now,
          ],
        );
        stored = written.length;
      }
      const state =
        failed.length === 0 ? 'synced' : failed.length === sourced.length ? 'failed' : 'delayed';
      await manager.query(
        `INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt", "errorCode", "errorMessage")
         VALUES ($1, $2, $3, CASE WHEN $4 THEN $3::timestamptz END, $5, $6, $7)
         ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state,
           "lastAttemptAt" = EXCLUDED."lastAttemptAt",
           "lastSuccessAt" = COALESCE(EXCLUDED."lastSuccessAt", sync_sources."lastSuccessAt"),
           "nextRunAt" = EXCLUDED."nextRunAt", "errorCode" = EXCLUDED."errorCode",
           "errorMessage" = EXCLUDED."errorMessage"`,
        [
          INFLATION_SOURCE_KEY,
          state,
          now,
          failed.length === 0,
          new Date(now.getTime() + (failed.length === 0 ? REFRESH_AFTER_MS : RETRY_AFTER_MS)),
          reason,
          failed.length === 0
            ? null
            : `Inflation data ${FAILURE_TEXT[reason as InflationFailure]} for ${failed.join(', ')}${detail ? ` (${detail})` : ''}`.slice(
                0,
                300,
              ),
        ],
      );
      return stored;
    });
  }

  /** Per currency: where the official series comes from, how far it reaches and the owner's rate. */
  async overview(ownerId: string, now = new Date()) {
    const owner = parseUuid(ownerId);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const currencies = [];
      for (const currency of accountingCurrencies) {
        const { changes, official, manual } = await readEffectiveChanges(manager, owner, currency);
        const series = buildSeries(changes);
        const provider = OFFICIAL_SOURCES[currency];
        const yearly = trailingYearPercent(series);
        // The published months alone, without the owner's own months laid over them.
        const publishedYearly = trailingYearPercent(
          buildSeries(new Map(official.map((row) => [row.month, Number(row.changePercent)]))),
        );
        currencies.push({
          currency,
          officialSource: provider ? PROVIDER_NAMES[provider] : null,
          officialLastMonth: official.length ? official[official.length - 1].month : null,
          lastMonth: series.last,
          // A gap in the middle of the series leaves only the stretch after it comparable.
          comparableFrom: series.chainStart,
          trailingYearPercent: yearly === null ? null : yearly.toFixed(4),
          // True when one of those twelve months is an estimate, not a published or typed figure.
          trailingYearEstimated: trailingYearEstimated(series),
          officialTrailingYearPercent: publishedYearly === null ? null : publishedYearly.toFixed(4),
          estimatedMonthlyPercent: series.last === null ? null : (series.trend * 100).toFixed(6),
          personalRatePercent: await readPersonalRate(manager, owner, currency),
          manualMonths: manual.map(({ month, changePercent }) => ({
            month,
            changePercent: exact(changePercent),
          })),
        });
      }
      const [state]: SourceRow[] = await manager.query(
        'SELECT * FROM sync_sources WHERE key = $1',
        [INFLATION_SOURCE_KEY],
      );
      const interrupted =
        state?.state === 'syncing' &&
        (!state.lastAttemptAt || now.getTime() - state.lastAttemptAt.getTime() > 15 * 60_000);
      return {
        currencies,
        sync: state
          ? {
              key: INFLATION_SOURCE_KEY,
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

  /** How much more money a later day needs to buy what the money of an earlier day bought. */
  async factor(ownerId: string, query: unknown) {
    const owner = parseUuid(ownerId);
    const { currency, basis, from, to } = parseFactorQuery(query);
    const result = await this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return this.factorBetween(manager, owner, currency, basis, from, to);
    });
    return {
      currency,
      basis,
      from,
      to,
      factor: result ? formatFactor(result.factor) : null,
      estimated: result?.estimated ?? null,
    };
  }

  /** The factor of a basis between two days, or null when the series does not cover them. */
  async factorBetween(
    manager: EntityManager,
    owner: string,
    currency: AccountingCurrency,
    basis: 'official' | 'personal',
    from: string,
    to: string,
  ): Promise<InflationFactor | null> {
    if (basis === 'personal') {
      const rate = await readPersonalRate(manager, owner, currency);
      return rate === null ? null : personalFactor(Number(rate), from, to);
    }
    const { changes } = await readEffectiveChanges(manager, owner, currency);
    const series: InflationSeries = buildSeries(changes);
    return officialFactor(series, from, to);
  }

  async setPersonalRate(ownerId: string, currencyInput: string, input: unknown) {
    const owner = parseUuid(ownerId);
    const currency = parseCurrency(currencyInput);
    const rate = parsePersonalRate(input);
    await this.source.transaction(async (manager) => {
      if (rate === null)
        await manager.query(
          'DELETE FROM inflation_personal_rates WHERE "ownerId" = $1 AND currency = $2',
          [owner, currency],
        );
      else
        await manager.query(
          `INSERT INTO inflation_personal_rates ("ownerId", currency, "annualPercent")
           VALUES ($1, $2, $3)
           ON CONFLICT ("ownerId", currency) DO UPDATE
             SET "annualPercent" = EXCLUDED."annualPercent", "updatedAt" = clock_timestamp()`,
          [owner, currency, rate],
        );
    });
    return { currency, annualPercent: rate === null ? null : exact(rate) };
  }

  async setMonth(
    ownerId: string,
    currencyInput: string,
    monthInput: string,
    input: unknown,
    now = new Date(),
  ) {
    const owner = parseUuid(ownerId);
    const currency = parseCurrency(currencyInput);
    const month = parseTypedMonth(monthInput, now);
    const changePercent = parseMonthlyChange(input);
    await this.source.query(
      `INSERT INTO inflation_manual_months ("ownerId", currency, month, "changePercent")
       VALUES ($1, $2, ($3 || '-01')::date, $4)
       ON CONFLICT ("ownerId", currency, month) DO UPDATE
         SET "changePercent" = EXCLUDED."changePercent", "updatedAt" = clock_timestamp()`,
      [owner, currency, month, changePercent],
    );
    return { currency, month, changePercent: exact(changePercent) };
  }

  async removeMonth(ownerId: string, currencyInput: string, monthInput: string) {
    const owner = parseUuid(ownerId);
    const currency = parseCurrency(currencyInput);
    const month = parseMonth(monthInput);
    const [, removed]: [unknown, number] = await this.source.query(
      `DELETE FROM inflation_manual_months
        WHERE "ownerId" = $1 AND currency = $2 AND month = ($3 || '-01')::date`,
      [owner, currency, month],
    );
    if (removed === 0) throw new NotFoundException('No such inflation month');
    return { currency, month };
  }
}
