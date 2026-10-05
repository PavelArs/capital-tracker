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
  type PortfolioAccountInput,
  type PortfolioInstrument,
  portfolioAccount,
  projectPortfolio,
  type StoredPrice,
} from './portfolio-valuation';

interface AccountRow {
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

@Injectable()
export class PortfolioValuationService {
  constructor(private readonly source: DataSource) {}

  async read(ownerId: string, rawQuery: unknown, now = new Date()) {
    const owner = parseUuid(ownerId);
    const asked = parseQuery(rawQuery);
    const at = now.toISOString();
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const instruments: PortfolioInstrument[] = await manager.query(
        `SELECT id,name,symbol,"assetType","valuationCurrency","priceSource"
          FROM accounting_instruments WHERE "ownerId"=$1 ORDER BY id`,
        [owner],
      );
      const rows: AccountRow[] = await manager.query(
        `SELECT a.id AS "accountId",a.name,j."coverageFrom"
          FROM manual_accounts a LEFT JOIN account_trade_journals j
            ON j."ownerId"=a."ownerId" AND j."accountId"=a.id
          WHERE a."ownerId"=$1 ORDER BY a.id`,
        [owner],
      );
      const accounts: PortfolioAccountInput[] = [];
      const ledgers: ConnectedLedgerCache = new Map();
      const projections = new Map<ConnectedLedger, OwnedProjection>();
      try {
        for (const row of rows) {
          const identity = { accountId: row.accountId, name: row.name };
          if (!row.coverageFrom || row.coverageFrom.toISOString() > at) {
            accounts.push({
              ...identity,
              coverage: row.coverageFrom ? 'before-coverage' : 'not-started',
              lots: [],
              realizations: [],
            });
            continue;
          }
          // One replay per connected component, shared by all of its accounts.
          const ledger =
            ledgers.get(row.accountId) ??
            (await readConnectedLedger(manager, owner, [row.accountId]));
          for (const id of ledger.accounts.keys()) ledgers.set(id, ledger);
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
      const bySource = (source: PriceSource) =>
        instruments.filter((instrument) => instrument.priceSource === source);
      const codes = [
        ...new Set(
          bySource('market').flatMap((instrument) =>
            instrument.symbol ? [instrument.symbol.toUpperCase()] : [],
          ),
        ),
      ];
      const market = await latestMarketPrices(manager, codes, now);
      const manual = await latestManualPrices(
        manager,
        owner,
        bySource('manual').map((instrument) => instrument.id),
        now,
      );
      const mainCurrency = await readMainCurrency(manager, owner);
      const fx = new FxConverter(await readFxRates(manager), asked ?? mainCurrency);
      const report = projectPortfolio(
        now,
        instruments,
        accounts,
        {
          market: new Map(
            market.map((row) => [
              row.asset,
              { priceUsd: row.price, observedAt: row.observedAt, source: row.source },
            ]),
          ),
          manual,
        },
        fx,
      );
      return { ...report, mainCurrency };
    });
  }
}
