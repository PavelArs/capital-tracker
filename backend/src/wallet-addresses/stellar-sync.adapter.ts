import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import {
  HORIZON_PAYMENT_PAGE_SIZE,
  HORIZON_TRANSACTION_PAGE_SIZE,
  HorizonClient,
  OPERATION_BITS,
  type PageResult,
  type StellarPayment,
  type StellarTransaction,
} from './horizon-client';
import { jsonbText } from './jsonb-text';
import { type StellarLeg, type StellarOperation, stellarLeg } from './stellar-legs';

// Bounds for one pass; the next pass continues from the committed transaction. A transaction
// holds at most 100 operations, so the payment pages always reach past the first one.
export const MAX_STELLAR_TRANSACTION_PAGES = 8;
export const MAX_STELLAR_PAYMENT_PAGES = 12;
const SYNC_TIME_BUDGET_MS = 25_000;

interface ScanRow {
  id: string;
  ownerId: string;
  address: string;
  /** The TOID of the newest transaction whose legs are stored; null before the first. */
  readTo: string | null;
}

const failed = (reason: StepFailure, imported = 0): StepResult => ({
  outcome: 'provider_error',
  reason,
  imported,
});

/**
 * Up to `pages` pages of a Horizon list past `after`; `all` once a page ran short or `reached`
 * says the items go far enough.
 */
async function readList<T>(
  pages: number,
  size: number,
  after: bigint | null,
  position: (item: T) => bigint,
  read: (cursor: bigint | null) => Promise<PageResult<T>>,
  reached: (items: T[]) => boolean = () => false,
): Promise<{ ok: true; items: T[]; all: boolean } | { ok: false; reason: StepFailure }> {
  const items: T[] = [];
  const latest = () => {
    const last = items.at(-1);
    return last === undefined ? null : position(last);
  };
  for (let page = 0; page < pages; page++) {
    const listed = await read(latest() ?? after);
    if (!listed.ok) return listed;
    for (const item of listed.items) {
      // Oldest first and past the cursor: anything else is an answer the sync cannot trust.
      if ((latest() ?? after ?? -1n) >= position(item))
        return { ok: false, reason: 'invalid_response' };
      items.push(item);
    }
    if (listed.items.length < size || reached(items)) return { ok: true, items, all: true };
  }
  return { ok: true, items, all: false };
}

/** The legs of the listed transactions up to `end`; null when a payment names another hash. */
function legsOf(
  address: string,
  transactions: readonly StellarTransaction[],
  byTransaction: ReadonlyMap<bigint, StellarOperation[]>,
  end: bigint,
): { legs: StellarLeg[]; done: bigint | null } | null {
  const legs: StellarLeg[] = [];
  let done: bigint | null = null;
  for (const transaction of transactions) {
    if (transaction.toid > end) break;
    const operations = byTransaction.get(transaction.toid) ?? [];
    // A payment names the transaction it belongs to by hash too.
    if (operations.some(({ payment }) => payment.hash !== transaction.hash)) return null;
    const leg = stellarLeg(address, transaction, operations);
    if (leg) legs.push(leg);
    done = transaction.toid;
  }
  return { legs, done };
}

/** Whether an operation in the range belongs to no listed transaction. */
function unlisted(
  transactions: readonly StellarTransaction[],
  payments: readonly StellarPayment[],
  end: bigint,
): boolean {
  const listed = new Set(transactions.map((item) => item.toid));
  return payments.some((item) => item.transaction <= end && !listed.has(item.transaction));
}

/**
 * STELLAR-SYNC: Stellar history from Horizon, oldest first. The wallet's transactions give the
 * order and the fee of each one it paid for; its payment operations give the XLM moved. A pass
 * reads a few pages of both from the stored cursor and commits whole transactions with the
 * cursor, so an interrupted pass resumes without gaps or duplicates. Once the history is read,
 * the balance Horizon reports is stored beside it (STELLAR-REPORTED).
 */
@Injectable()
export class StellarSyncAdapter implements ChainSyncAdapter {
  readonly network = 'stellar';
  readonly name = 'Stellar';

  constructor(
    private readonly source: DataSource,
    private readonly client: HorizonClient,
  ) {}

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    const state = await this.scan(ownerId, addressId);
    const after = state.readTo === null ? null : BigInt(state.readTo);
    const started = Date.now();

    const listed = await readList(
      MAX_STELLAR_TRANSACTION_PAGES,
      HORIZON_TRANSACTION_PAGE_SIZE,
      after,
      (item: StellarTransaction) => item.toid,
      (cursor) => this.client.transactions(state.address, cursor),
    );
    if (!listed.ok) return failed(listed.reason);
    const transactions = listed.items;
    if (transactions.length === 0) {
      await this.commit(state, [], null, true);
      return this.completed(state, 0);
    }
    // Everything up to the last listed transaction; the payments must reach it.
    const last = transactions[transactions.length - 1].toid;

    // The operations of the stored transaction itself come after its TOID: start past them.
    const paidAfter = after === null ? null : after | OPERATION_BITS;
    const paid = await readList(
      MAX_STELLAR_PAYMENT_PAGES,
      HORIZON_PAYMENT_PAGE_SIZE,
      paidAfter,
      (item: StellarPayment) => item.id,
      (cursor) => this.client.payments(state.address, cursor),
      (items) => items[items.length - 1].transaction > last,
    );
    if (!paid.ok) return failed(paid.reason);
    const payments = paid.items;
    // The page budget ran out inside the read range: the transaction of the last operation may
    // go on in the next page, so only the ones before it are complete.
    const paidTo = paid.all ? last : payments[payments.length - 1].transaction - 1n;
    const ready = transactions.filter((item) => item.toid <= paidTo);
    if (ready.length === 0) return failed('invalid_response');

    const read = await this.operations(payments, ready[ready.length - 1].toid, started);
    const legs = legsOf(state.address, transactions, read.byTransaction, read.end);
    if (!legs || unlisted(transactions, payments, read.end)) return failed('invalid_response');

    const { failure } = read;
    const caughtUp = failure === null && listed.all && legs.done === last;
    const imported =
      legs.done === null ? 0 : await this.commit(state, legs.legs, legs.done, caughtUp);
    if (failure) return failed(failure, imported);
    if (!caughtUp) return { outcome: 'partial', reason: null, imported };
    return this.completed(state, imported);
  }

  /** A history read to its end: the balance Horizon reports is stored beside it. */
  private async completed(state: ScanRow, imported: number): Promise<StepResult> {
    const refused = await this.refreshBalance(state);
    return refused ? failed(refused, imported) : { outcome: 'complete', reason: null, imported };
  }

  /**
   * Each transaction's operations up to `end`, with the XLM each merge moved. A merge whose
   * amount is not read now ends the range before its transaction.
   */
  private async operations(
    payments: readonly StellarPayment[],
    end: bigint,
    started: number,
  ): Promise<{
    byTransaction: Map<bigint, StellarOperation[]>;
    end: bigint;
    failure: StepFailure | null;
  }> {
    const byTransaction = new Map<bigint, StellarOperation[]>();
    for (const payment of payments) {
      if (payment.transaction > end) break;
      let merged: bigint | null = null;
      if (payment.merge) {
        // Stop before this transaction; the next pass reads its merge.
        if (Date.now() - started > SYNC_TIME_BUDGET_MS)
          return { byTransaction, end: payment.transaction - 1n, failure: null };
        const read = await this.client.mergeAmount(payment.id, payment.merge.into);
        if (!read.ok) return { byTransaction, end: payment.transaction - 1n, failure: read.reason };
        merged = read.units;
      }
      const operations = byTransaction.get(payment.transaction) ?? [];
      operations.push({ payment, merged });
      byTransaction.set(payment.transaction, operations);
    }
    return { byTransaction, end, failure: null };
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    await this.source.query(
      `INSERT INTO wallet_stellar_accounts ("ownerId", "addressId")
        SELECT "ownerId", id FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND network = 'stellar'
        ON CONFLICT ("addressId") DO NOTHING`,
      [owner, id],
    );
    const [row]: ScanRow[] = await this.source.query(
      `SELECT a.id, a."ownerId", a.address, s."readTo"::text AS "readTo"
        FROM wallet_addresses a JOIN wallet_stellar_accounts s ON s."addressId" = a.id
        WHERE a."ownerId" = $1 AND a.id = $2 AND a.network = 'stellar'`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Stores the legs of whole transactions and moves the cursor past them in one transaction. */
  private commit(expected: ScanRow, legs: StellarLeg[], end: bigint | null, caughtUp: boolean) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT a.id, a."ownerId", a.address, s."readTo"::text AS "readTo"
          FROM wallet_addresses a JOIN wallet_stellar_accounts s ON s."addressId" = a.id
          WHERE a."ownerId" = $1 AND a.id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!current || current.readTo !== expected.readTo) {
        throw new ConflictException('Another sync advanced this address');
      }
      const inserted = await this.insert(manager, current, legs);
      if (end !== null)
        await manager.query(
          'UPDATE wallet_stellar_accounts SET "readTo" = $2::bigint WHERE "addressId" = $1',
          [current.id, end.toString()],
        );
      // "scannedBlock" is the ledger of the newest transaction read; "completedAt" marks a
      // history read to its end, so the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET
          "scannedBlock" = coalesce($3::int, "scannedBlock", 0),
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, end === null ? null : Number(end >> 32n), caughtUp],
      );
      return inserted;
    });
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: StellarLeg[]) {
    if (legs.length === 0) return 0;
    const values: unknown[] = [];
    const rows = legs.map((leg) => {
      const base = values.length;
      values.push(
        address.ownerId,
        address.id,
        leg.txid,
        leg.blockHeight,
        leg.blockTime,
        leg.receivedUnits.toString(),
        leg.sentUnits.toString(),
        leg.feeUnits.toString(),
        leg.direction,
        jsonbText(leg.raw),
      );
      const slot = (offset: number) => `$${base + offset}`;
      return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},NULL,${slot(5)},${slot(6)}::numeric,${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)},${slot(10)}::jsonb,NULL)`;
    });
    const inserted: { txid: string }[] = await manager.query(
      `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
        "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw, asset)
        VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
      values,
    );
    return inserted.length;
  }

  /**
   * STELLAR-REPORTED: the XLM balance Horizon reports now. It changes no balance; the history
   * does. Returns the provider's refusal, if any.
   */
  private async refreshBalance(state: ScanRow): Promise<StepFailure | null> {
    const read = await this.client.balance(state.address);
    if (!read.ok) return read.reason;
    await this.source.query(
      `UPDATE wallet_stellar_accounts SET "reportedUnits" = $2::numeric,
        "reportedAt" = clock_timestamp() WHERE "addressId" = $1`,
      [state.id, read.units.toString()],
    );
    return null;
  }
}
