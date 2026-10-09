import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { lockAccountingOwner } from '../accounting/accounting-lock';
import { parseUuid } from '../accounting/input';
import { ensureChainCoins } from '../accounting/portfolio-valuation.service';
import { presentSource, type SourceRow } from '../sync-status/sync-source';
import { chainAsset, formatUnits, type Network, networkAssets } from './chain-assets';
import type { StakeState } from './solana-stake';
import { stakeMoves, stakeRewards } from './stake-tables';
import { parseRegistration, parseTransactionQuery, parseUpdate } from './wallet-address-input';
import { WalletSyncService } from './wallet-sync.service';

interface AddressRow {
  id: string;
  ownerId: string;
  network: Network;
  address: string;
  accountId: string | null;
  label: string | null;
  scannedBlock: number | null;
  walkTopTxid: string | null;
  walkCursorTxid: string | null;
  completedTopTxid: string | null;
  completedAt: Date | null;
  createdAt: Date;
  transactionCount: number;
  /** Received minus sent per asset; null names the network's own coin. */
  balances: { asset: string | null; units: string }[];
  /**
   * The wallet's Solana stake accounts or Ethereum pools, what each holds by its history and its
   * rewards.
   */
  stake: StakeRow[];
  // json_build_object turns timestamps into text.
  source:
    | (Omit<SourceRow, 'lastAttemptAt' | 'lastSuccessAt' | 'nextRunAt'> &
        Record<'lastAttemptAt' | 'lastSuccessAt' | 'nextRunAt', string | null>)
    | null;
}
interface StakeRow {
  account: string;
  validator: string | null;
  /** Ethereum: the pool token's symbol, when it has a plain one. */
  pool: string | null;
  state: StakeState | null;
  units: string;
  rewardUnits: string;
}
interface TransactionRow {
  txid: string;
  network: Network;
  asset: string | null;
  blockHeight: number;
  blockTime: Date;
  direction: 'in' | 'out' | 'self';
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
}
// Each stored leg's received minus sent units is its whole effect on the address in its asset,
// the network fee included, so their sum per asset over the complete history is the chain
// balance. A wallet's stake accounts (SOL-STAKE-BALANCE) and staking pools (ETH-STAKE-BALANCE)
// are part of it: what moved into them stays the wallet's coin, and so do their rewards. An
// Ethereum pool that holds nothing for the wallet any more while its history says it should
// reads as unstaking: the ether waits in the pool's exit queue until claimed. The wallet's background source (PR-SYN-1) comes along; null until
// its first pass.
const stakeHeld = (table: string, key: string) => `
        coalesce((SELECT sum(m.units) FROM ${stakeMoves} m
          WHERE m."addressId" = ${table}."addressId" AND m.account = ${table}.${key}), 0) AS moved,
        coalesce((SELECT sum(r.units) FROM ${stakeRewards} r
          WHERE r."addressId" = ${table}."addressId" AND r.account = ${table}.${key}), 0) AS rewarded`;
const selectAddress = `SELECT a.*, t."transactionCount", b.balances, k.stake,
    CASE WHEN s.key IS NULL THEN NULL ELSE json_build_object('state', s.state,
      'lastAttemptAt', s."lastAttemptAt", 'lastSuccessAt', s."lastSuccessAt",
      'nextRunAt', s."nextRunAt", 'errorCode', s."errorCode", 'errorMessage', s."errorMessage")
    END AS source
  FROM wallet_addresses a
  CROSS JOIN LATERAL (SELECT count(*)::int AS "transactionCount"
    FROM wallet_address_transactions x WHERE x."addressId" = a.id) t
  CROSS JOIN LATERAL (SELECT coalesce(json_agg(json_build_object('asset', y.asset,
      'units', y.units::text)), '[]'::json) AS balances
    FROM (SELECT z.asset, sum(z.units) AS units FROM (
        SELECT x.asset, x."receivedUnits" - x."sentUnits" AS units
          FROM wallet_address_transactions x WHERE x."addressId" = a.id
        UNION ALL SELECT NULL, m.units FROM ${stakeMoves} m WHERE m."addressId" = a.id
        UNION ALL SELECT NULL, r.units FROM ${stakeRewards} r WHERE r."addressId" = a.id
      ) z GROUP BY z.asset) y) b
  CROSS JOIN LATERAL (SELECT coalesce(json_agg(json_build_object('account', w.account,
      'validator', w.validator, 'state', w.state, 'pool', w.pool,
      'units', (w.moved + w.rewarded)::text, 'rewardUnits', w.rewarded::text)
      ORDER BY w."discoveredAt", w.account), '[]'::json) AS stake
    FROM (SELECT sa.account, sa.validator, sa.state, NULL::text AS pool, sa."discoveredAt",
        ${stakeHeld('sa', 'account')}
      FROM wallet_stake_accounts sa WHERE sa."addressId" = a.id
      UNION ALL
      SELECT e.contract, NULL, CASE WHEN e.units IS NULL THEN NULL
          WHEN e.units > 0 THEN 'active'
          WHEN e.moved + e.rewarded > 0 THEN 'deactivating' ELSE 'closed' END, e.symbol, e."discoveredAt",
        e.moved, e.rewarded
      FROM (SELECT p.*, ${stakeHeld('p', 'contract')}
        FROM wallet_ether_stake_positions p WHERE p."addressId" = a.id) e) w) k
  LEFT JOIN sync_sources s ON s.key = 'wallet:' || a.id::text`;

function sourceRow(raw: AddressRow['source']): SourceRow | null {
  if (!raw) return null;
  const date = (value: string | null) => (value === null ? null : new Date(value));
  return {
    ...raw,
    lastAttemptAt: date(raw.lastAttemptAt),
    lastSuccessAt: date(raw.lastSuccessAt),
    nextRunAt: date(raw.nextRunAt),
  };
}

/** How much of the history is stored: Bitcoin walks newest first, Ethereum oldest first. */
function historyState(row: AddressRow): 'never' | 'partial' | 'complete' {
  if (row.network === 'bitcoin')
    return row.walkTopTxid ? 'partial' : row.completedAt ? 'complete' : 'never';
  return row.completedAt ? 'complete' : row.scannedBlock !== null ? 'partial' : 'never';
}

/** The balance of each asset the network's wallet can hold, its own coin first. */
function balancesOf(row: AddressRow) {
  return networkAssets(row.network).map((asset) => {
    const units = row.balances.find((item) => item.asset === asset.token)?.units ?? '0';
    return { symbol: asset.symbol, quantity: formatUnits(BigInt(units), asset) };
  });
}

/**
 * SOL-STAKE-BALANCE, ETH-STAKE-BALANCE: the coins in the wallet's stake accounts or pools, part
 * of its balance above. A closed one that holds nothing is history only and is left out.
 */
function stakingOf(row: AddressRow) {
  const sol = chainAsset(row.network, null);
  const accounts = row.stake
    .filter((item) => item.state !== 'closed' || BigInt(item.units) !== 0n)
    .map((item) => ({
      account: item.account,
      validator: item.validator,
      pool: item.pool,
      // Null until the chain was read after the account was found.
      state: item.state,
      quantity: formatUnits(BigInt(item.units), sol),
      rewards: formatUnits(BigInt(item.rewardUnits), sol),
    }));
  if (accounts.length === 0) return null;
  const total = (key: 'units' | 'rewardUnits') =>
    formatUnits(
      row.stake.reduce((sum, item) => sum + BigInt(item[key]), 0n),
      sol,
    );
  return { symbol: sol.symbol, quantity: total('units'), rewards: total('rewardUnits'), accounts };
}

function summary(row: AddressRow, now = new Date()) {
  const state = historyState(row);
  const balances = state === 'complete' ? balancesOf(row) : null;
  const staking = state === 'complete' ? stakingOf(row) : null;
  const source = sourceRow(row.source);
  const status = source ? presentSource(source, now) : null;
  return {
    id: row.id,
    network: row.network,
    address: row.address,
    accountId: row.accountId,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    transactionCount: row.transactionCount,
    // SYNC-RECONCILE: known only once the whole history is stored; never a partial sum.
    chainBalance: balances?.[0].quantity ?? null,
    balances,
    staking,
    sync: {
      state,
      completedAt: state === 'complete' ? row.completedAt!.toISOString() : null,
      status: status?.state ?? null,
      lastAttemptAt: status?.lastAttemptAt ?? null,
      lastSuccessAt: status?.lastSuccessAt ?? null,
      nextRunAt: status?.nextRunAt ?? null,
      errorMessage: status?.errorMessage ?? null,
    },
  };
}

function transaction(row: TransactionRow) {
  const asset = chainAsset(row.network, row.asset);
  const amount = (units: bigint) => formatUnits(units, asset);
  const received = amount(BigInt(row.receivedUnits));
  const sent = amount(BigInt(row.sentUnits));
  const net = amount(BigInt(row.receivedUnits) - BigInt(row.sentUnits));
  // The network fee is paid in its own coin, whatever asset the leg moves.
  const fee = formatUnits(BigInt(row.feeUnits), chainAsset(row.network, null));
  return {
    txid: row.txid,
    blockHeight: row.blockHeight,
    blockTime: row.blockTime.toISOString(),
    direction: row.direction,
    symbol: asset.symbol,
    received,
    sent,
    net,
    fee,
    // The Bitcoin-only screen's names for the same amounts.
    receivedBtc: received,
    sentBtc: sent,
    netBtc: net,
    feeBtc: fee,
    // No price source exists yet: the value is unknown, never zero.
    usdValue: null,
    usdValueStatus: 'missing' as const,
  };
}

@Injectable()
export class WalletAddressService {
  constructor(
    private readonly source: DataSource,
    private readonly walletSync: WalletSyncService,
  ) {}

  // WAL-DUP: an address already tracked is returned as it is, whatever account or name the
  // repeated request names; moving or renaming it is an explicit update.
  async register(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const { network, address, accountId, label } = parseRegistration(raw);
    return this.source.transaction('READ COMMITTED', async (manager) => {
      if (accountId) await this.account(manager, owner, accountId);
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO wallet_addresses (id, "ownerId", network, address, "accountId", label)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT ("ownerId", network, address) DO NOTHING RETURNING id`,
        [randomUUID(), owner, network, address, accountId, label],
      );
      const [row]: AddressRow[] = await manager.query(
        `${selectAddress} WHERE a."ownerId" = $1 AND a.network = $2 AND a.address = $3`,
        [owner, network, address],
      );
      return { created: inserted.length === 1, value: summary(row) };
    });
  }

  // WAL-ACCOUNT: moves the address to another account (or none) and renames it.
  async update(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const addressId = parseUuid(id);
    const changes = parseUpdate(raw);
    const result = await this.source.transaction('READ COMMITTED', async (manager) => {
      if (changes.accountId) await this.account(manager, owner, changes.accountId);
      // TypeORM returns [rows, affected] for UPDATE ... RETURNING on PostgreSQL.
      const [updated]: [unknown[], number] = await manager.query(
        `UPDATE wallet_addresses SET
          "accountId" = CASE WHEN $3 THEN $4::uuid ELSE "accountId" END,
          label = CASE WHEN $5 THEN $6::varchar ELSE label END
          WHERE "ownerId" = $1 AND id = $2 RETURNING id`,
        [
          owner,
          addressId,
          'accountId' in changes,
          changes.accountId ?? null,
          'label' in changes,
          changes.label ?? null,
        ],
      );
      if (updated.length !== 1) throw new NotFoundException();
      if (changes.accountId) await ensureChainCoins(manager, owner);
      return summary(await this.address(manager, owner, addressId));
    });
    // An address now in an account may complete a transfer between own wallets (D7).
    if ('accountId' in changes) await this.walletSync.linkOwnTransfers(owner);
    return result;
  }

  async list(ownerId: string) {
    const owner = parseUuid(ownerId);
    return this.read(async (manager) => {
      const rows: AddressRow[] = await manager.query(
        `${selectAddress} WHERE a."ownerId" = $1 ORDER BY a."createdAt", a.id`,
        [owner],
      );
      return rows.map((row) => summary(row));
    });
  }

  // "Sync now": the same pass the scheduler runs, recorded the same way.
  async sync(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const addressId = parseUuid(id);
    const { network } = await this.read((manager) => this.address(manager, owner, addressId));
    const result = await this.walletSync.run({ id: addressId, ownerId: owner, network });
    if (result === 'busy') throw new ConflictException('Another sync advanced this address');
    return {
      outcome: result.step?.outcome ?? 'provider_error',
      reason: result.step?.reason ?? null,
      imported: result.step?.imported ?? 0,
      address: summary(await this.read((manager) => this.address(manager, owner, addressId))),
    };
  }

  async transactions(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const addressId = parseUuid(id);
    const { offset, limit } = parseTransactionQuery(raw);
    return this.read(async (manager) => {
      const address = await this.address(manager, owner, addressId);
      const rows: TransactionRow[] = await manager.query(
        `SELECT txid, $4::text AS network, asset, "blockHeight", "blockTime", direction,
          "receivedUnits"::text AS "receivedUnits", "sentUnits"::text AS "sentUnits",
          "feeUnits"::text AS "feeUnits"
          FROM wallet_address_transactions WHERE "addressId" = $1
          ORDER BY "blockHeight" DESC, txid LIMIT $2 OFFSET $3`,
        [addressId, limit, offset, address.network],
      );
      const total = address.transactionCount;
      return {
        total,
        offset,
        limit,
        nextOffset: offset + rows.length < total ? offset + rows.length : null,
        missingUsdValueCount: total,
        items: rows.map(transaction),
      };
    });
  }

  private async address(manager: EntityManager, owner: string, id: string) {
    const [row]: AddressRow[] = await manager.query(
      `${selectAddress} WHERE a."ownerId" = $1 AND a.id = $2`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  // Another owner's account is as unknown as a missing one. Accounting writes lock the owner
  // before any account row, so this does too.
  private async account(manager: EntityManager, owner: string, id: string) {
    await lockAccountingOwner(manager, owner);
    const rows: unknown[] = await manager.query(
      'SELECT 1 FROM manual_accounts WHERE "ownerId" = $1 AND id = $2 FOR KEY SHARE',
      [owner, id],
    );
    if (rows.length === 0) throw new NotFoundException();
  }

  private read<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return action(manager);
    });
  }
}
