import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { parseUuid } from '../accounting/input';
import {
  type ChainObservation,
  EsploraClient,
  PAGE_SIZE,
  type ProviderFailure,
  formatSats,
} from './esplora-client';
import { parseRegistration, parseTransactionQuery } from './wallet-address-input';

// Bounds for one sync request; the next request continues from the committed cursor.
export const MAX_PAGES_PER_SYNC = 10;
const SYNC_TIME_BUDGET_MS = 25_000;

interface AddressRow {
  id: string;
  ownerId: string;
  network: 'bitcoin';
  address: string;
  walkTopTxid: string | null;
  walkCursorTxid: string | null;
  completedTopTxid: string | null;
  completedAt: Date | null;
  createdAt: Date;
  transactionCount: number;
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
type SyncOutcome = 'complete' | 'partial' | 'provider_error';

const selectAddress = `SELECT a.*, (SELECT count(*) FROM wallet_address_transactions t
  WHERE t."addressId" = a.id)::int AS "transactionCount" FROM wallet_addresses a`;

function summary(row: AddressRow) {
  return {
    id: row.id,
    network: row.network,
    address: row.address,
    createdAt: row.createdAt.toISOString(),
    transactionCount: row.transactionCount,
    sync: {
      state: row.walkTopTxid ? 'partial' : row.completedAt ? 'complete' : 'never',
      completedAt: row.walkTopTxid || !row.completedAt ? null : row.completedAt.toISOString(),
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
    private readonly esplora: EsploraClient,
  ) {}

  async register(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const { address } = parseRegistration(raw);
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO wallet_addresses (id, "ownerId", network, address) VALUES ($1, $2, 'bitcoin', $3)
          ON CONFLICT ("ownerId", network, address) DO NOTHING RETURNING id`,
        [randomUUID(), owner, address],
      );
      const [row]: AddressRow[] = await manager.query(
        `${selectAddress} WHERE a."ownerId" = $1 AND a.network = 'bitcoin' AND a.address = $2`,
        [owner, address],
      );
      return { created: inserted.length === 1, value: summary(row) };
    });
  }

  async list(ownerId: string) {
    const owner = parseUuid(ownerId);
    return this.read(async (manager) => {
      const rows: AddressRow[] = await manager.query(
        `${selectAddress} WHERE a."ownerId" = $1 ORDER BY a."createdAt", a.id`,
        [owner],
      );
      return rows.map(summary);
    });
  }

  async sync(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const addressId = parseUuid(id);
    let state = await this.read((manager) => this.address(manager, owner, addressId));
    const started = Date.now();
    let imported = 0;
    const finish = async (outcome: SyncOutcome, reason: ProviderFailure | null) => ({
      outcome,
      reason,
      imported,
      address: summary(await this.read((manager) => this.address(manager, owner, addressId))),
    });
    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS) {
        return finish('partial', null);
      }
      const page = await this.esplora.page(state.address, state.walkCursorTxid);
      if (!page.ok) return finish('provider_error', page.reason);
      if (page.transactions.length === 0) {
        const failure = await this.confirmEnd(state);
        if (failure) return finish('provider_error', failure);
      }
      const committed = await this.commit(state, page.transactions);
      imported += committed.inserted;
      if (committed.finished) return finish('complete', null);
      state = committed.state;
    }
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

  // Esplora answers [] both at the end of history and when a lagging backend does not
  // know the cursor or the address yet. Accept [] as the end only when the address's
  // confirmed transaction count matches what is stored plus what arrived above the walk.
  private async confirmEnd(state: AddressRow): Promise<ProviderFailure | null> {
    if (state.walkCursorTxid === null) {
      return state.completedTopTxid === null ? null : 'unavailable';
    }
    const total = await this.esplora.transactionCount(state.address);
    if (!total.ok) return total.reason;
    const [{ stored }]: { stored: number }[] = await this.source.query(
      'SELECT count(*)::int AS stored FROM wallet_address_transactions WHERE "addressId" = $1',
      [state.id],
    );
    if (stored === total.count) return null;
    if (stored > total.count) return 'unavailable';
    const top = await this.esplora.page(state.address, null);
    if (!top.ok) return top.reason;
    const newer = top.transactions.findIndex(({ txid }) => txid === state.walkTopTxid);
    return newer >= 0 && stored + newer === total.count ? null : 'unavailable';
  }

  // Stores one page and advances the walk atomically. A walk starts at the newest
  // transaction and ends at the previous walk's newest transaction or the end of
  // history, so an interrupted walk resumes from its cursor without gaps.
  private commit(expected: AddressRow, page: ChainObservation[]) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: AddressRow[] = await manager.query(
        `SELECT * FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (
        !current ||
        current.walkTopTxid !== expected.walkTopTxid ||
        current.walkCursorTxid !== expected.walkCursorTxid ||
        current.completedTopTxid !== expected.completedTopTxid
      ) {
        throw new ConflictException('Another sync advanced this address');
      }
      const known = current.completedTopTxid
        ? page.findIndex(({ txid }) => txid === current.completedTopTxid)
        : -1;
      const fresh = known >= 0 ? page.slice(0, known) : page;
      const finished = known >= 0 || page.length < PAGE_SIZE;
      const inserted = await this.insert(manager, current, fresh);
      const walkTop = current.walkTopTxid ?? page[0]?.txid ?? null;
      // TypeORM returns [rows, affected] for UPDATE ... RETURNING on PostgreSQL.
      const [[next]]: [AddressRow[], number] = finished
        ? await manager.query(
            `UPDATE wallet_addresses SET "completedTopTxid" = $3, "completedAt" = clock_timestamp(),
              "walkTopTxid" = NULL, "walkCursorTxid" = NULL
              WHERE "ownerId" = $1 AND id = $2 RETURNING *`,
            [current.ownerId, current.id, walkTop],
          )
        : await manager.query(
            `UPDATE wallet_addresses SET "walkTopTxid" = $3, "walkCursorTxid" = $4
              WHERE "ownerId" = $1 AND id = $2 RETURNING *`,
            [current.ownerId, current.id, walkTop, page[page.length - 1].txid],
          );
      return { inserted, finished, state: { ...expected, ...next } };
    });
  }

  private async insert(manager: EntityManager, address: AddressRow, page: ChainObservation[]) {
    if (page.length === 0) return 0;
    const values: unknown[] = [];
    const rows = page.map((tx) => {
      const base = values.length;
      values.push(
        address.ownerId,
        address.id,
        tx.txid,
        tx.blockHeight,
        tx.blockHash,
        tx.blockTime,
        tx.receivedSats.toString(),
        tx.sentSats.toString(),
        tx.feeSats.toString(),
        tx.direction,
        JSON.stringify(tx.raw),
      );
      const slot = (offset: number) => `$${base + offset}`;
      return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},${slot(5)},${slot(6)},${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)}::numeric,${slot(10)},${slot(11)}::jsonb)`;
    });
    const inserted: { txid: string }[] = await manager.query(
      `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
        "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw)
        VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
      values,
    );
    return inserted.length;
  }

  private async address(manager: EntityManager, owner: string, id: string) {
    const [row]: AddressRow[] = await manager.query(
      `${selectAddress} WHERE a."ownerId" = $1 AND a.id = $2`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  private read<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return action(manager);
    });
  }
}
