import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  type AccountingCurrency,
  FxConverter,
  isAccountingCurrency,
} from '../fx-rates/fx-conversion';
import { readFxRates } from '../fx-rates/fx-rates.service';
import { readMainCurrency } from '../owner-settings/owner-settings.service';
import { latestMarketPrices } from '../prices/market-price.store';
import type { PriceSource } from './asset-classification';
import {
  type ConnectedLedger,
  type ConnectedLedgerCache,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { parseDecimal, parseUuid } from './input';
import type { OwnedProjection } from './owned-transfer-fifo';
import {
  DAY_MS,
  type PortfolioAccountInput,
  type PortfolioInstrument,
  type PortfolioPrices,
  portfolioAccount,
  projectPortfolio,
  type StoredPrice,
} from './portfolio-valuation';

export interface AccountRow {
  accountId: string;
  name: string;
  coverageFrom: Date | null;
}
interface ManualPriceRow {
  instrumentId: string;
  observedAt: Date;
  priceUsd: string;
}

/** Only `currency` (USD, EUR or RUB) may be asked; without it the main currency is used. */
function parseQuery(query: unknown): AccountingCurrency | null {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('Invalid accounting input');
  const keys = Object.keys(query);
  if (keys.length === 0) return null;
  const { currency } = query as Record<string, unknown>;
  if (keys.length !== 1 || keys[0] !== 'currency' || !isAccountingCurrency(currency))
    throw new BadRequestException('Invalid accounting input');
  return currency;
}

/** Latest manual point at or before the instant whose current version is not void. */
async function latestManualPrices(
  manager: EntityManager,
  owner: string,
  instrumentIds: readonly string[],
  at: Date,
): Promise<Map<string, StoredPrice>> {
  if (instrumentIds.length === 0) return new Map();
  const rows: ManualPriceRow[] = await manager.query(
    `SELECT DISTINCT ON (point."instrumentId") point."instrumentId", point."observedAt",
        point."priceUsd"::text AS "priceUsd"
      FROM (
        SELECT DISTINCT ON (v."instrumentId", v."observedAt") v."instrumentId", v."observedAt",
          v."priceUsd", v.kind
        FROM manual_usd_price_versions v
        WHERE v."ownerId"=$1 AND v."instrumentId"=ANY($2::uuid[]) AND v."observedAt"<=$3
        ORDER BY v."instrumentId", v."observedAt", v.revision DESC
      ) point
      WHERE point.kind='set'
      ORDER BY point."instrumentId", point."observedAt" DESC`,
    [owner, instrumentIds, at],
  );
  return new Map(
    rows.map((row) => [
      row.instrumentId,
      {
        priceUsd: parseDecimal(row.priceUsd, false),
        observedAt: row.observedAt.toISOString(),
        source: 'manual',
      },
    ]),
  );
}

export interface ValuationInputs {
  instruments: PortfolioInstrument[];
  accounts: AccountRow[];
  ledgers: ConnectedLedgerCache;
}

/**
 * The owner's instruments, accounts and connected ledgers, read once. With `startedBy`,
 * only accounts whose journal had started by then are replayed.
 */
export async function readValuationInputs(
  manager: EntityManager,
  owner: string,
  startedBy?: string,
): Promise<ValuationInputs> {
  const instruments: PortfolioInstrument[] = await manager.query(
    `SELECT id,name,symbol,"assetType","valuationCurrency","priceSource"
      FROM accounting_instruments WHERE "ownerId"=$1 ORDER BY id`,
    [owner],
  );
  const accounts: AccountRow[] = await manager.query(
    `SELECT a.id AS "accountId",a.name,j."coverageFrom"
      FROM manual_accounts a LEFT JOIN account_trade_journals j
        ON j."ownerId"=a."ownerId" AND j."accountId"=a.id
      WHERE a."ownerId"=$1 ORDER BY a.id`,
    [owner],
  );
  const ledgers: ConnectedLedgerCache = new Map();
  try {
    for (const row of accounts) {
      if (!row.coverageFrom || ledgers.has(row.accountId)) continue;
      if (startedBy !== undefined && row.coverageFrom.toISOString() > startedBy) continue;
      // One replay per connected component, shared by all of its accounts.
      const ledger = await readConnectedLedger(manager, owner, [row.accountId]);
      for (const id of ledger.accounts.keys()) ledgers.set(id, ledger);
    }
  } catch (error) {
    rethrowAccountingHistory(error);
  }
  return { instruments, accounts, ledgers };
}

/**
 * Every account's FIFO lots and realizations at one instant. An account whose journal starts
 * later is unknown then, unless `emptyBeforeCoverage` and it carried nothing in: such an
 * account held nothing before its first operation.
 */
export function accountsAt(
  inputs: ValuationInputs,
  at: string,
  options: { emptyBeforeCoverage?: boolean } = {},
): PortfolioAccountInput[] {
  const accounts: PortfolioAccountInput[] = [];
  const projections = new Map<ConnectedLedger, OwnedProjection>();
  try {
    for (const row of inputs.accounts) {
      const identity = { accountId: row.accountId, name: row.name };
      const ledger = inputs.ledgers.get(row.accountId);
      const started = !!row.coverageFrom && row.coverageFrom.toISOString() <= at;
      const empty =
        options.emptyBeforeCoverage &&
        ledger?.accounts.get(row.accountId)?.initialLots.length === 0;
      if (!ledger || (!started && !empty)) {
        accounts.push({
          ...identity,
          coverage: row.coverageFrom ? 'before-coverage' : 'not-started',
          lots: [],
          realizations: [],
        });
        continue;
      }
      const projection = projections.get(ledger) ?? projectConnectedLedger(ledger, { at });
      projections.set(ledger, projection);
      accounts.push(
        portfolioAccount(
          identity,
          projection.accounts.get(row.accountId)!,
          {
            ...ledger.accounts.get(row.accountId)!,
            linkedTrades: [...ledger.accounts.values()].flatMap((account) => account.trades),
          },
          projection.swapAllocations,
        ),
      );
    }
  } catch (error) {
    rethrowAccountingHistory(error);
  }
  return accounts;
}

/** Stored market prices by code and manual prices by instrument, latest at or before `at`. */
export async function latestPortfolioPrices(
  manager: EntityManager,
  owner: string,
  instruments: readonly PortfolioInstrument[],
  at: Date,
): Promise<PortfolioPrices> {
  const bySource = (source: PriceSource) =>
    instruments.filter((instrument) => instrument.priceSource === source);
  const market = await latestMarketPrices(manager, marketCodes(instruments), at);
  const manual = await latestManualPrices(
    manager,
    owner,
    bySource('manual').map((instrument) => instrument.id),
    at,
  );
  return {
    market: new Map(
      market.map((row) => [
        row.asset,
        { priceUsd: row.price, observedAt: row.observedAt, source: row.source },
      ]),
    ),
    manual,
  };
}

/** Market codes of the instruments priced from stored market prices. */
export function marketCodes(instruments: readonly PortfolioInstrument[]): string[] {
  return [
    ...new Set(
      instruments.flatMap((instrument) =>
        instrument.priceSource === 'market' && instrument.symbol
          ? [instrument.symbol.toUpperCase()]
          : [],
      ),
    ),
  ];
}

@Injectable()
export class PortfolioValuationService {
  constructor(private readonly source: DataSource) {}

  async read(ownerId: string, rawQuery: unknown, now = new Date()) {
    const owner = parseUuid(ownerId);
    const asked = parseQuery(rawQuery);
    const at = now.toISOString();
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const inputs = await readValuationInputs(manager, owner, at);
      const accounts = accountsAt(inputs, at);
      const prices = await latestPortfolioPrices(manager, owner, inputs.instruments, now);
      const mainCurrency = await readMainCurrency(manager, owner);
      const fx = new FxConverter(await readFxRates(manager), asked ?? mainCurrency);
      // The prices stored a day earlier give each price's 24-hour change.
      const previous = await latestPortfolioPrices(
        manager,
        owner,
        inputs.instruments,
        new Date(now.getTime() - DAY_MS),
      );
      const report = projectPortfolio(now, inputs.instruments, accounts, prices, fx, previous);
      return { ...report, mainCurrency };
    });
  }
}
