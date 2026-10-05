import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { parseUuid } from '../accounting/input';
import { presentSource, type SourceRow } from '../sync-status/sync-source';
import { formatSats } from './esplora-client';
import { parseRegistration, parseTransactionQuery, parseUpdate } from './wallet-address-input';
import { WalletSyncService } from './wallet-sync.service';

interface AddressRow {
  id: string;
  ownerId: string;
  network: 'bitcoin';
  address: string;
  accountId: string | null;
  label: string | null;
  walkTopTxid: string | null;
  walkCursorTxid: string | null;
  completedTopTxid: string | null;
  completedAt: Date | null;
  createdAt: Date;
  transactionCount: number;
  balanceUnits: string;
  // json_build_object turns timestamps into text.
  source:
    | (Omit<SourceRow, 'lastAttemptAt' | 'lastSuccessAt' | 'nextRunAt'> &
        Record<'lastAttemptAt' | 'lastSuccessAt' | 'nextRunAt', string | null>)
    | null;
}
interface TransactionRow {
  txid: string;
  blockHeight: number;
  blockTime: Date;
  direction: 'in' | 'out' | 'self';
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
}
// Each stored transaction's received minus sent units is its whole effect on the address,
// the network fee included, so their sum over the complete history is the chain balance.
// The wallet's background source (PR-SYN-1) comes along; null until its first pass.
const selectAddress = `SELECT a.*, t."transactionCount", t."balanceUnits",
    CASE WHEN s.key IS NULL THEN NULL ELSE json_build_object('state', s.state,
      'lastAttemptAt', s."lastAttemptAt", 'lastSuccessAt', s."lastSuccessAt",
      'nextRunAt', s."nextRunAt", 'errorCode', s."errorCode", 'errorMessage', s."errorMessage")
    END AS source
  FROM wallet_addresses a
  CROSS JOIN LATERAL (SELECT count(*)::int AS "transactionCount",
    coalesce(sum(x."receivedUnits" - x."sentUnits"), 0)::text AS "balanceUnits"
    FROM wallet_address_transactions x WHERE x."addressId" = a.id) t
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

function summary(row: AddressRow, now = new Date()) {
  const state = row.walkTopTxid ? 'partial' : row.completedAt ? 'complete' : 'never';
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
    chainBalance: state === 'complete' ? formatSats(BigInt(row.balanceUnits)) : null,
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
  const received = BigInt(row.receivedUnits);
  const sent = BigInt(row.sentUnits);
  return {
    txid: row.txid,
    blockHeight: row.blockHeight,
    blockTime: row.blockTime.toISOString(),
    direction: row.direction,
    receivedBtc: formatSats(received),
    sentBtc: formatSats(sent),
    netBtc: formatSats(received - sent),
    feeBtc: formatSats(BigInt(row.feeUnits)),
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
    const { address, accountId, label } = parseRegistration(raw);
    return this.source.transaction('READ COMMITTED', async (manager) => {
      if (accountId) await this.account(manager, owner, accountId);
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO wallet_addresses (id, "ownerId", network, address, "accountId", label)
          VALUES ($1, $2, 'bitcoin', $3, $4, $5)
          ON CONFLICT ("ownerId", network, address) DO NOTHING RETURNING id`,
        [randomUUID(), owner, address, accountId, label],
      );
      const [row]: AddressRow[] = await manager.query(
        `${selectAddress} WHERE a."ownerId" = $1 AND a.network = 'bitcoin' AND a.address = $2`,
        [owner, address],
      );
      return { created: inserted.length === 1, value: summary(row) };
    });
  }

  // WAL-ACCOUNT: moves the address to another account (or none) and renames it.
  async update(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const addressId = parseUuid(id);
    const changes = parseUpdate(raw);
    return this.source.transaction('READ COMMITTED', async (manager) => {
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
      return summary(await this.address(manager, owner, addressId));
    });
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
        `SELECT txid, "blockHeight", "blockTime", direction, "receivedUnits"::text AS "receivedUnits",
          "sentUnits"::text AS "sentUnits", "feeUnits"::text AS "feeUnits"
          FROM wallet_address_transactions WHERE "addressId" = $1
          ORDER BY "blockHeight" DESC, txid LIMIT $2 OFFSET $3`,
        [addressId, limit, offset],
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

  // Another owner's account is as unknown as a missing one.
  private async account(manager: EntityManager, owner: string, id: string) {
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
