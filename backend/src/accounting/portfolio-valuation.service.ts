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
import type { Network } from '../wallet-addresses/chain-assets';
import { stakeMoves, stakeRewards } from '../wallet-addresses/stake-tables';
import type { PriceSource } from './asset-classification';
import { chainCoin, legMovement } from './chain-classification';
import { poolMoveUnits } from './chain-pool';
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
import { applyChainMoves, type ChainMove } from './provisional-chain';
import { findOrCreateInstrument } from './trade.service';

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
  /** D1: each account's unanswered chain movements and outgoing "Other" answers. */
  chainMoves: ReadonlyMap<string, readonly ChainMove[]>;
}

interface ChainMoveRow {
  accountId: string;
  network: Network;
  asset: string | null;
  blockTime: Date;
  receivedUnits: string;
  sentUnits: string;
  /** SOL-STAKE-MOVE: the part of the leg that went into (or came from) own stake accounts. */
  stakeUnits: string;
}

/** A signed amount as a leg: positive arrives, negative leaves. */
const signedLeg = (units: bigint) => ({
  receivedUnits: (units > 0n ? units : 0n).toString(),
  sentUnits: (units < 0n ? -units : 0n).toString(),
});

/**
 * D1, CLS-PROVISIONAL: the chain movements that count before anyone answers them. Hidden ones
 * and answers that produced an entry are out; an outgoing "Other" produced none and stays in.
 * A coin the owner has no asset for yet is left out until one exists. SOL-STAKE-MOVE: SOL that
 * went into the wallet's own stake accounts never left it, so only the rest of its leg (the
 * fee) moves; a stake change without a leg of its own and every staking reward count as they
 * are (SOL-STAKE-REWARD: received without a purchase price, not a deposit).
 */
export async function readChainMoves(
  manager: EntityManager,
  owner: string,
): Promise<Map<string, ChainMove[]>> {
  const rows: ChainMoveRow[] = await manager.query(
    `SELECT w."accountId", w.network, t.asset, t."blockTime",
        t."receivedUnits"::text AS "receivedUnits",
        t."sentUnits"::text AS "sentUnits",
        coalesce((SELECT sum(m.units) FROM ${stakeMoves} m WHERE t.asset IS NULL
          AND m."addressId"=t."addressId" AND m.txid=t.txid), 0)::text AS "stakeUnits"
      FROM wallet_addresses w
      JOIN wallet_address_transactions t ON t."ownerId"=w."ownerId" AND t."addressId"=w.id
      LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId"
        AND h.txid=t.txid
      LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
        AND v.txid=h.txid AND v.version=h."currentVersion"
      WHERE w."ownerId"=$1 AND w."accountId" IS NOT NULL
        AND (v.status IS NULL OR v.status='unclassified' OR (v.status='classified'
          AND v.type='other' AND v."tradeId" IS NULL AND v."rewardId" IS NULL
          AND v."transferId" IS NULL))
      ORDER BY t."blockTime", t.txid, w.id`,
    [owner],
  );
  // BYBIT-TRADES (M22): a Bybit trade nobody has answered moved its quote coin as well (USDT
  // spent on a buy, received on a sale). So does one answered "Other", which records nothing
  // for that side. A recognised Buy or Sell settles the quote coin itself.
  const quotes: ChainMoveRow[] = await manager.query(
    `SELECT w."accountId", w.network, t.raw->>'quoteAsset' AS asset, t."blockTime",
        greatest((t.raw->>'quoteUnits')::numeric, 0)::text AS "receivedUnits",
        greatest(-(t.raw->>'quoteUnits')::numeric, 0)::text AS "sentUnits", '0' AS "stakeUnits"
      FROM wallet_addresses w
      JOIN wallet_address_transactions t ON t."ownerId"=w."ownerId" AND t."addressId"=w.id
      LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId"
        AND h.txid=t.txid
      LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
        AND v.txid=h.txid AND v.version=h."currentVersion"
      WHERE w."ownerId"=$1 AND w."accountId" IS NOT NULL AND w.network='bybit'
        AND t.raw ? 'quoteAsset'
        AND (v.status IS NULL OR v.status='unclassified'
          OR (v.status='classified' AND v.type='other'))
      ORDER BY t."blockTime", t.txid`,
    [owner],
  );
  rows.push(...quotes);
  const stake: (Omit<ChainMoveRow, 'receivedUnits' | 'sentUnits'> & { units: string })[] =
    await manager.query(
      `SELECT w."accountId", w.network, NULL AS asset, m."blockTime", m.units::text AS units,
          '0' AS "stakeUnits"
        FROM wallet_addresses w
        JOIN ${stakeMoves} m ON m."ownerId"=w."ownerId" AND m."addressId"=w.id
        WHERE w."ownerId"=$1 AND w."accountId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM wallet_address_transactions t
            WHERE t."addressId"=m."addressId" AND t.txid=m.txid)
      UNION ALL
      SELECT w."accountId", w.network, NULL, r."observedAt", r.units::text, '0'
        FROM wallet_addresses w
        JOIN ${stakeRewards} r ON r."ownerId"=w."ownerId" AND r."addressId"=w.id
        WHERE w."ownerId"=$1 AND w."accountId" IS NOT NULL`,
      [owner],
    );
  for (const { units, ...row } of stake) rows.push({ ...row, ...signedLeg(BigInt(units)) });
  // POOL-DEPOSIT, POOL-WITHDRAW: coins in a liquidity pool stay held; a deposit and a withdrawal
  // spend their network fee, and a withdrawal that returned less than its deposit the rest.
  const pools: (Omit<ChainMoveRow, 'stakeUnits'> & {
    feeUnits: string;
    deposit: { receivedUnits: string; sentUnits: string; feeUnits: string } | null;
  })[] = await manager.query(
    `SELECT w."accountId", w.network, t.asset, t."blockTime",
        t."receivedUnits"::text AS "receivedUnits", t."sentUnits"::text AS "sentUnits",
        t."feeUnits"::text AS "feeUnits",
        CASE WHEN p.txid IS NULL THEN NULL ELSE json_build_object(
          'receivedUnits', p."receivedUnits"::text, 'sentUnits', p."sentUnits"::text,
          'feeUnits', p."feeUnits"::text) END AS deposit
      FROM wallet_addresses w
      JOIN wallet_address_transactions t ON t."ownerId"=w."ownerId" AND t."addressId"=w.id
      JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
      JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
        AND v.txid=h.txid AND v.version=h."currentVersion"
      LEFT JOIN wallet_address_transactions p ON v.type='pool-withdrawal'
        AND p."addressId"=v."pairedAddressId" AND p.txid=v."pairedTxid"
      WHERE w."ownerId"=$1 AND w."accountId" IS NOT NULL AND v.status='classified'
        AND v.type IN ('pool-deposit', 'pool-withdrawal')
      ORDER BY t."blockTime", t.txid, w.id`,
    [owner],
  );
  for (const { deposit, feeUnits, ...row } of pools) {
    const units = poolMoveUnits({ ...row, feeUnits }, deposit && { ...row, ...deposit });
    rows.push({ ...row, ...signedLeg(units), stakeUnits: '0' });
  }
  const coins = new Map<string, string | null>();
  const moves = new Map<string, ChainMove[]>();
  for (const row of rows) {
    const key = `${row.network}:${row.asset ?? ''}`;
    if (!coins.has(key))
      coins.set(
        key,
        (await findOrCreateInstrument(manager, owner, chainCoin(row), false))?.id ?? null,
      );
    const instrumentId = coins.get(key);
    const occurredAt = row.blockTime.toISOString();
    const net = BigInt(row.receivedUnits) - BigInt(row.sentUnits) + BigInt(row.stakeUnits);
    const { inbound, quantity } = legMovement({ ...row, ...signedLeg(net), blockTime: occurredAt });
    if (!instrumentId || quantity === '0') continue;
    const list = moves.get(row.accountId) ?? [];
    list.push({ instrumentId, occurredAt, inbound, quantity });
    moves.set(row.accountId, list);
  }
  return moves;
}

/**
 * D1: creates the asset of every coin or token a wallet in an account moved, so its unanswered
 * movements count. The caller holds the owner's accounting lock.
 */
export async function ensureChainCoins(manager: EntityManager, owner: string): Promise<void> {
  // A Bybit trade (M22) also moves its quote coin.
  const rows: { network: Network; asset: string | null }[] = await manager.query(
    `SELECT DISTINCT w.network, x.asset
      FROM wallet_addresses w
      JOIN wallet_address_transactions t ON t."ownerId"=w."ownerId" AND t."addressId"=w.id
      CROSS JOIN LATERAL (SELECT t.asset UNION ALL
        SELECT t.raw->>'quoteAsset' WHERE w.network='bybit' AND t.raw ? 'quoteAsset') x
      WHERE w."ownerId"=$1 AND w."accountId" IS NOT NULL
      ORDER BY w.network, x.asset`,
    [owner],
  );
  for (const row of rows) await findOrCreateInstrument(manager, owner, chainCoin(row), true);
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
  return { instruments, accounts, ledgers, chainMoves: await readChainMoves(manager, owner) };
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
      const moves = inputs.chainMoves.get(row.accountId) ?? [];
      // D1: a wallet account with no operation of its own holds what the chain moved.
      if (!row.coverageFrom && moves.length > 0) {
        accounts.push({
          ...identity,
          coverage: 'covered',
          lots: applyChainMoves([], moves, at),
          realizations: [],
        });
        continue;
      }
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
      const valued = portfolioAccount(
        identity,
        projection.accounts.get(row.accountId)!,
        {
          ...ledger.accounts.get(row.accountId)!,
          linkedTrades: [...ledger.accounts.values()].flatMap((account) => account.trades),
        },
        projection.swapAllocations,
      );
      accounts.push({ ...valued, lots: applyChainMoves(valued.lots, moves, at) });
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
