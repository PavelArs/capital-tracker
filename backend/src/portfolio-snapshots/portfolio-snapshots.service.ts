import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import { parseDecimal, parseUuid } from '../accounting/input';
import type {
  PortfolioInstrument,
  PortfolioPrices,
  StoredPrice,
} from '../accounting/portfolio-valuation';
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
import { capitalFlows, investedAt, profitToDate, splitChange, stateFlows } from './capital-flows';
import {
  DEFAULT_PERIOD,
  HISTORY_FROM_MS,
  type HistoryPeriod,
  HOURLY_WINDOW_MS,
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
  // D1: unanswered chain movements count, so new ones and new answers change the history.
  'wallet_address_transactions',
  'chain_transaction_classifications',
  // SOL-STAKE-*, ETH-STAKE-*, TRON-STAKE-*: what stayed in a wallet's stake accounts, pools or
  // Tron staking, and their rewards. A last read balance changes no value by itself.
  'wallet_stake_moves',
  'wallet_stake_rewards',
  'wallet_ether_stake_moves',
  'wallet_ether_stake_rewards',
  'wallet_tron_stake_moves',
] as const;
// Only which account an address belongs to; its sync progress changes no value.
const INPUT_PARTS: readonly [string, string][] = [
  ...INPUT_TABLES.map((table): [string, string] => [table, 't::text']),
  ['wallet_addresses', `t.id::text || ':' || coalesce(t."accountId"::text, '')`],
];
const INPUTS_REVISION = `SELECT md5(string_agg(part, '|' ORDER BY part)) AS revision FROM (${INPUT_PARTS.map(
  ([table, row]) =>
    `SELECT '${table}:' || coalesce(md5(string_agg(${row}, ',' ORDER BY ${row})), '') AS part
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
): (SnapshotValue & { unpriced: boolean })[] {
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
      // The value leaves out a held asset without a price (not an account yet to start).
      unpriced: rated && report.missingPriceCount > 0,
    };
  });
}

/**
 * Valuation inputs and every stored price series they use. With `instrumentId`, only that
 * instrument's prices are read.
 */
async function readSeriesInputs(
  manager: EntityManager,
  owner: string,
  instrumentId?: string,
): Promise<SeriesInputs> {
  const valuation = await readValuationInputs(manager, owner);
  const priced = valuation.instruments.filter(
    (instrument) => instrumentId === undefined || instrument.id === instrumentId,
  );
  const market: {
    asset: string;
    observedAt: Date;
    price: string;
    source: string;
    kind: string;
  }[] = await manager.query(
    `SELECT asset, "observedAt", price::text AS price, source, kind FROM price_observations
        WHERE asset = ANY($1) AND "quoteCurrency" = $2`,
    [marketCodes(priced), QUOTE_CURRENCY],
  );
  const manual: {
    instrumentId: string;
    observedAt: Date;
    revision: number;
    kind: 'set' | 'void';
    priceUsd: string | null;
  }[] = await manager.query(
    `SELECT "instrumentId","observedAt",revision,kind,"priceUsd"::text AS "priceUsd"
      FROM manual_usd_price_versions WHERE "ownerId"=$1 AND "instrumentId" = ANY($2)`,
    [owner, priced.map((instrument) => instrument.id)],
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

/** One asset's value and the known cost of what is held at one instant (ASSET-CHART). */
function assetAt(
  valuation: ValuationInputs,
  instrument: PortfolioInstrument,
  at: number,
  prices: PortfolioPrices,
  fx: FxConverter,
) {
  const instant = new Date(at);
  const accounts = accountsAt(valuation, instant.toISOString(), {
    emptyBeforeCoverage: true,
  }).map((account) => ({
    ...account,
    lots: account.lots.filter((lot) => lot.instrumentId === instrument.id),
    realizations: account.realizations.filter(
      (realization) => realization.instrumentId === instrument.id,
    ),
  }));
  const report = projectPortfolio(instant, [instrument], accounts, prices, fx);
  const [asset] = report.assets;
  return {
    at: instant.toISOString(),
    quantity: asset.quantity,
    // Null when the asset had no price or rate then; nothing held is a known zero.
    value: asset.value,
    complete: asset.value !== null && report.unavailableAccountCount === 0,
    // Cost of the held lots whose purchase price and rate are known.
    cost: asset.knownCostSubtotal,
    costComplete:
      asset.unknownCostQuantity === '0' &&
      asset.missingRateQuantity === '0' &&
      report.unavailableAccountCount === 0,
  };
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
      const series = [
        ...stored,
        {
          at: now.getTime(),
          value: current.value,
          complete: current.complete,
          unpriced: current.unpriced,
        },
      ];
      // Deposits and withdrawals come from the operations themselves, in this currency at the
      // rate of each one's date (split-market-and-flows).
      const flows = stateFlows(capitalFlows(valuation), fx);
      const invested = investedAt(
        flows,
        series.map((point) => point.at),
      );
      const points = series.map((point, index) => ({
        at: iso(point.at),
        value: point.value,
        complete: point.complete,
        invested: invested[index],
      }));
      const start = series.find((point) => point.value !== null) ?? null;
      return {
        period: query.period,
        currency,
        mainCurrency,
        from: iso(Math.max(from, HISTORY_FROM_MS)),
        at: now.toISOString(),
        value: current.value,
        complete: points.every((point) => point.complete),
        ...periodChange(start?.value ?? null, current.value),
        invested: invested.at(-1) ?? null,
        // Profit or loss to date against all-time net invested, whatever the period.
        ...profitToDate(current.value, invested.at(-1) ?? null, current.unpriced),
        ...splitChange(start, series.at(-1)!, flows),
        points,
      };
    });
  }

  /**
   * One asset's value and cost basis over a chart period (ASSET-CHART), computed from stored
   * prices and rates at the same instants as the portfolio snapshots, then the current value.
   */
  async assetHistory(ownerId: string, instrumentId: string, rawQuery: unknown, now = new Date()) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(instrumentId);
    const query = parseQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const inputs = await readSeriesInputs(manager, owner, id);
      const instrument = inputs.valuation.instruments.find((item) => item.id === id);
      if (!instrument) throw new NotFoundException();
      const mainCurrency = await readMainCurrency(manager, owner);
      const currency = query.currency ?? mainCurrency;
      const fx = new FxConverter(await readFxRates(manager), currency);
      const at = now.getTime();
      const { from } = periodStart(query.period, at);
      const instants = periodPoints(
        seriesInstants(at, at - HOURLY_WINDOW_MS).map((instant) => ({ at: instant })),
        query.period,
        at,
      ).filter((point) => point.at < at);
      const latest = await latestPortfolioPrices(manager, owner, [instrument], now);
      return {
        instrumentId: id,
        period: query.period,
        currency,
        mainCurrency,
        from: iso(Math.max(from, HISTORY_FROM_MS)),
        at: now.toISOString(),
        points: [
          ...instants.map((point) =>
            assetAt(inputs.valuation, instrument, point.at, pricesAt(inputs, point.at), fx),
          ),
          // The current value closes the period with the live valuation's prices.
          assetAt(inputs.valuation, instrument, at, latest, fx),
        ],
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
      const inputs = await readSeriesInputs(manager, owner);
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
