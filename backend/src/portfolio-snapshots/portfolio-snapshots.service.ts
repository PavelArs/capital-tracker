import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import { parseDecimal, parseUuid } from '../accounting/input';
import type { PortfolioPrices, StoredPrice } from '../accounting/portfolio-valuation';
import { projectPortfolio } from '../accounting/portfolio-valuation';
import {
  accountsAt,
  latestPortfolioPrices,
  marketCodes,
  readValuationInputs,
  type ValuationInputs,
} from '../accounting/portfolio-valuation.service';
import {
  type AccountingCurrency,
  accountingCurrencies,
  FxConverter,
  isAccountingCurrency,
  moscowDate,
} from '../fx-rates/fx-conversion';
import { readFxRates } from '../fx-rates/fx-rates.service';
import { readMainCurrency } from '../owner-settings/owner-settings.service';
import { QUOTE_CURRENCY } from '../prices/price-catalog';
import {
  DEFAULT_PERIOD,
  HISTORY_FROM_MS,
  type HistoryPeriod,
  historyPeriods,
  hourStart,
  latestAtOrBefore,
  manualSeries,
  marketSeries,
  type PricePoint,
  periodChange,
  periodPoints,
  periodStart,
  rateDateStart,
  type SnapshotValue,
  seriesInstants,
  snapshotChanges,
  snapshotKey,
} from './snapshot-series';

export type RefreshResult =
  | { outcome: 'fresh' }
  | { outcome: 'rebuilt'; from: string | null; written: number; removed: number };
export type TickResult = { outcome: 'disabled' } | { outcome: 'refreshed'; owners: number };

interface StateRow {
  inputsRevision: string;
  pricesFetchedThrough: Date | null;
  ratesFetchedThrough: Date | null;
  hourlyFrom: Date;
}
interface StoredRow {
  takenAt: Date;
  currency: string;
  value: string | null;
  complete: boolean;
}
interface SeriesInputs {
  valuation: ValuationInputs;
  market: Map<string, PricePoint[]>;
  manual: Map<string, PricePoint[]>;
}

// Every owner table a snapshot value depends on. A future operation source joins this list.
const INPUT_TABLES = [
  'accounting_instruments',
  'manual_accounts',
  'account_trade_journals',
  'account_trades',
  'account_trade_versions',
  'account_opening_snapshots',
  'account_opening_positions',
  'account_carry_in_lots',
  'account_rewards',
  'account_reward_versions',
  'account_swaps',
  'account_swap_versions',
  'owner_transfer_journals',
  'owned_transfers',
  'owned_transfer_versions',
  'manual_usd_price_versions',
] as const;
const INPUTS_REVISION = `SELECT md5(string_agg(part, '|' ORDER BY part)) AS revision FROM (${INPUT_TABLES.map(
  (table) =>
    `SELECT '${table}:' || coalesce(md5(string_agg(t::text, ',' ORDER BY t::text)), '') AS part
      FROM ${table} t WHERE t."ownerId"=$1`,
).join(' UNION ALL ')}) parts`;
const INSERT_BATCH = 1000;

const iso = (ms: number) => new Date(ms).toISOString();
const invalid = () => new BadRequestException('Invalid accounting input');

/** `period` (24H, 7D, 1M, 3M, 1Y, ALL; default 1M) and `currency` (default: main currency). */
function parseQuery(query: unknown): {
  period: HistoryPeriod;
  currency: AccountingCurrency | null;
} {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw invalid();
  const { period = DEFAULT_PERIOD, currency = null, ...rest } = query as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw invalid();
  if (!(historyPeriods as readonly unknown[]).includes(period)) throw invalid();
  if (currency !== null && !isAccountingCurrency(currency)) throw invalid();
  return { period: period as HistoryPeriod, currency };
}

/** Each stored price at the instant, as the live valuation would have read it then. */
function pricesAt(inputs: SeriesInputs, at: number): PortfolioPrices {
  const stored = (series: Map<string, PricePoint[]>) => {
    const prices = new Map<string, StoredPrice>();
    for (const [key, points] of series) {
      const point = latestAtOrBefore(points, at);
      if (point)
        prices.set(key, { priceUsd: point.price, observedAt: iso(point.at), source: point.source });
    }
    return prices;
  };
  return { market: stored(inputs.market), manual: stored(inputs.manual) };
}

/** Portfolio value at one instant in every accounting currency at that day's rate. */
function valuesAt(
  valuation: ValuationInputs,
  at: number,
  prices: PortfolioPrices,
  converters: readonly FxConverter[],
): SnapshotValue[] {
  const instant = new Date(at);
  const accounts = accountsAt(valuation, instant.toISOString(), { emptyBeforeCoverage: true });
  return converters.map((fx) => {
    const report = projectPortfolio(instant, valuation.instruments, accounts, prices, fx);
    // Without a rate the value in that currency is unknown, not a smaller sum.
    const rated = fx.available('USD', moscowDate(instant));
    return {
      at,
      currency: fx.currency,
      value: rated ? report.pricedSubtotal : null,
      complete: rated && report.completeness === 'complete',
    };
  });
}

@Injectable()
export class PortfolioSnapshotsService {
  private readonly logger = new Logger(PortfolioSnapshotsService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  // Follows the hourly price collection switch; reads also refresh, so a disabled job only
  // means a new hour waits for the next read.
  @Interval(5 * 60_000)
  async scheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch {
      this.logger.warn('Portfolio snapshots could not be refreshed');
    }
  }

  async tick(now = new Date()): Promise<TickResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    const owners: { ownerId: string }[] = await this.source.query(
      `SELECT "ownerId" FROM accounting_instruments UNION SELECT "ownerId" FROM manual_accounts
        ORDER BY 1`,
    );
    for (const { ownerId } of owners) {
      try {
        await this.refresh(ownerId, now);
      } catch {
        // One owner's invalid history never stops the others.
        this.logger.warn('Portfolio snapshots of one owner could not be refreshed');
      }
    }
    return { outcome: 'refreshed', owners: owners.length };
  }

  /**
   * Brings the owner's snapshots up to date: adds instants that passed and rebuilds every
   * snapshot from the earliest changed input on. Equal snapshots are left untouched.
   */
  async refresh(ownerId: string, now = new Date()): Promise<RefreshResult> {
    const owner = parseUuid(ownerId);
    return this.locked(owner, (manager) => this.rebuild(manager, owner, now.getTime()));
  }

  async history(ownerId: string, rawQuery: unknown, now = new Date()) {
    const owner = parseUuid(ownerId);
    const query = parseQuery(rawQuery);
    await this.refresh(owner, now);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const mainCurrency = await readMainCurrency(manager, owner);
      const currency = query.currency ?? mainCurrency;
      const { from } = periodStart(query.period, now.getTime());
      const rows: StoredRow[] = await manager.query(
        `SELECT "takenAt", value::text AS value, complete FROM portfolio_snapshots
          WHERE "ownerId"=$1 AND currency=$2 AND "takenAt">=$3 AND "takenAt"<=$4
          ORDER BY "takenAt"`,
        [owner, currency, new Date(from), now],
      );
      const stored = periodPoints(
        rows.map((row) => ({
          at: row.takenAt.getTime(),
          value: row.value,
          complete: row.complete,
        })),
        query.period,
        now.getTime(),
      );
      // The current value closes the period with the same rules as the snapshots.
      const valuation = await readValuationInputs(manager, owner);
      const prices = await latestPortfolioPrices(manager, owner, valuation.instruments, now);
      const fx = new FxConverter(await readFxRates(manager), currency);
      const [current] = valuesAt(valuation, now.getTime(), prices, [fx]);
      const points = [
        ...stored.map((point) => ({
          at: iso(point.at),
          value: point.value,
          complete: point.complete,
        })),
        { at: now.toISOString(), value: current.value, complete: current.complete },
      ];
      const start = points.find((point) => point.value !== null)?.value ?? null;
      return {
        period: query.period,
        currency,
        mainCurrency,
        from: iso(Math.max(from, HISTORY_FROM_MS)),
        at: now.toISOString(),
        value: current.value,
        complete: points.every((point) => point.complete),
        ...periodChange(start, current.value),
        points,
      };
    });
  }

  /** One rebuild per owner at a time; the snapshot of inputs is taken after the lock. */
  private async locked<T>(owner: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const runner = this.source.createQueryRunner();
    await runner.connect();
    try {
      const key = [owner];
      await runner.query(
        "SELECT pg_advisory_lock(hashtextextended('portfolio-snapshots:' || $1::text, 0))",
        key,
      );
      try {
        await runner.startTransaction('REPEATABLE READ');
        try {
          const result = await work(runner.manager);
          await runner.commitTransaction();
          return result;
        } catch (error) {
          await runner.rollbackTransaction();
          throw error;
        }
      } finally {
        await runner.query(
          "SELECT pg_advisory_unlock(hashtextextended('portfolio-snapshots:' || $1::text, 0))",
          key,
        );
      }
    } finally {
      await runner.release();
    }
  }

  private async rebuild(
    manager: EntityManager,
    owner: string,
    now: number,
  ): Promise<RefreshResult> {
    const [state]: StateRow[] = await manager.query(
      `SELECT "inputsRevision","pricesFetchedThrough","ratesFetchedThrough","hourlyFrom"
        FROM portfolio_snapshot_state WHERE "ownerId"=$1`,
      [owner],
    );
    const [{ revision }]: { revision: string }[] = await manager.query(INPUTS_REVISION, [owner]);
    const [marks]: { prices: Date | null; rates: Date | null }[] = await manager.query(
      `SELECT (SELECT max("fetchedAt") FROM price_observations) AS prices,
        (SELECT max("fetchedAt") FROM fx_rates) AS rates`,
    );
    const hourlyFrom = state ? state.hourlyFrom.getTime() : hourStart(now);
    const instants = seriesInstants(now, hourlyFrom);
    const storedRows: StoredRow[] = await manager.query(
      `SELECT "takenAt", currency, value::text AS value, complete FROM portfolio_snapshots
        WHERE "ownerId"=$1`,
      [owner],
    );
    const existing = new Map(
      storedRows.map((row) => [
        snapshotKey(row.takenAt.getTime(), row.currency),
        { value: row.value, complete: row.complete },
      ]),
    );
    const expected = new Set(instants);
    const obsolete = [...new Set(storedRows.map((row) => row.takenAt.getTime()))].filter(
      (at) => !expected.has(at),
    );
    const from =
      !state || state.inputsRevision !== revision
        ? HISTORY_FROM_MS
        : await this.earliestChange(manager, state, marks, instants, existing);
    if (from === null && obsolete.length === 0) return { outcome: 'fresh' };

    let written = 0;
    if (from !== null) {
      const inputs = await this.seriesInputs(manager, owner);
      const rates = await readFxRates(manager);
      const converters = accountingCurrencies.map((currency) => new FxConverter(rates, currency));
      const computed = instants
        .filter((at) => at >= from)
        .flatMap((at) => valuesAt(inputs.valuation, at, pricesAt(inputs, at), converters));
      const changes = snapshotChanges(existing, computed);
      await this.write(manager, owner, changes);
      written = changes.length;
    }
    if (obsolete.length > 0)
      await manager.query(
        `DELETE FROM portfolio_snapshots WHERE "ownerId"=$1 AND "takenAt"=ANY($2::timestamptz[])`,
        [owner, obsolete.map((at) => new Date(at))],
      );
    await manager.query(
      `INSERT INTO portfolio_snapshot_state
        ("ownerId","inputsRevision","pricesFetchedThrough","ratesFetchedThrough","hourlyFrom","refreshedAt")
        VALUES ($1,$2,$3,$4,$5,clock_timestamp())
        ON CONFLICT ("ownerId") DO UPDATE SET "inputsRevision"=EXCLUDED."inputsRevision",
          "pricesFetchedThrough"=EXCLUDED."pricesFetchedThrough",
          "ratesFetchedThrough"=EXCLUDED."ratesFetchedThrough",
          "refreshedAt"=EXCLUDED."refreshedAt"`,
      [owner, revision, marks.prices, marks.rates, new Date(hourlyFrom)],
    );
    return {
      outcome: 'rebuilt',
      from: from === null ? null : iso(from),
      written,
      removed: obsolete.length,
    };
  }

  /** The earliest instant a passed hour, a newly stored price or a newly stored rate affects. */
  private async earliestChange(
    manager: EntityManager,
    state: StateRow,
    marks: { prices: Date | null; rates: Date | null },
    instants: readonly number[],
    existing: ReadonlyMap<string, unknown>,
  ): Promise<number | null> {
    const candidates: number[] = [];
    const missing = instants.find((at) =>
      accountingCurrencies.some((currency) => !existing.has(snapshotKey(at, currency))),
    );
    if (missing !== undefined) candidates.push(missing);
    if (marks.prices && marks.prices.getTime() !== state.pricesFetchedThrough?.getTime()) {
      const [row]: { at: Date | null }[] = await manager.query(
        `SELECT min("observedAt") AS at FROM price_observations
          WHERE $1::timestamptz IS NULL OR "fetchedAt" > $1`,
        [state.pricesFetchedThrough],
      );
      if (row.at) candidates.push(row.at.getTime());
    }
    if (marks.rates && marks.rates.getTime() !== state.ratesFetchedThrough?.getTime()) {
      const [row]: { date: string | null }[] = await manager.query(
        `SELECT to_char(min("rateDate"), 'YYYY-MM-DD') AS date FROM fx_rates
          WHERE $1::timestamptz IS NULL OR "fetchedAt" > $1`,
        [state.ratesFetchedThrough],
      );
      if (row.date) candidates.push(rateDateStart(row.date));
    }
    return candidates.length > 0 ? Math.max(HISTORY_FROM_MS, Math.min(...candidates)) : null;
  }

  private async seriesInputs(manager: EntityManager, owner: string): Promise<SeriesInputs> {
    const valuation = await readValuationInputs(manager, owner);
    const market: {
      asset: string;
      observedAt: Date;
      price: string;
      source: string;
      kind: string;
    }[] = await manager.query(
      `SELECT asset, "observedAt", price::text AS price, source, kind FROM price_observations
          WHERE asset = ANY($1) AND "quoteCurrency" = $2`,
      [marketCodes(valuation.instruments), QUOTE_CURRENCY],
    );
    const manual: {
      instrumentId: string;
      observedAt: Date;
      revision: number;
      kind: 'set' | 'void';
      priceUsd: string | null;
    }[] = await manager.query(
      `SELECT "instrumentId","observedAt",revision,kind,"priceUsd"::text AS "priceUsd"
        FROM manual_usd_price_versions WHERE "ownerId"=$1`,
      [owner],
    );
    return {
      valuation,
      market: marketSeries(
        market.map((row) => ({
          ...row,
          observedAt: row.observedAt.getTime(),
          price: parseDecimal(row.price, false),
        })),
      ),
      manual: manualSeries(
        manual.map((row) => ({
          ...row,
          observedAt: row.observedAt.getTime(),
          priceUsd: row.priceUsd === null ? null : parseDecimal(row.priceUsd, false),
        })),
      ),
    };
  }

  private async write(manager: EntityManager, owner: string, rows: readonly SnapshotValue[]) {
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const batch = rows.slice(start, start + INSERT_BATCH);
      await manager.query(
        `INSERT INTO portfolio_snapshots ("ownerId","takenAt",currency,value,complete)
          SELECT $1, "takenAt", currency, value, complete
          FROM unnest($2::timestamptz[], $3::text[], $4::numeric[], $5::boolean[])
            AS s("takenAt", currency, value, complete)
          ON CONFLICT ("ownerId","takenAt",currency) DO UPDATE SET value=EXCLUDED.value,
            complete=EXCLUDED.complete, "computedAt"=clock_timestamp()`,
        [
          owner,
          batch.map((row) => new Date(row.at)),
          batch.map((row) => row.currency),
          batch.map((row) => row.value),
          batch.map((row) => row.complete),
        ],
      );
    }
  }
}
