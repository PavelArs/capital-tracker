import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import {
  HORIZON_PAYMENT_PAGE_SIZE,
  HORIZON_TRANSACTION_PAGE_SIZE,
  HorizonClient,
  OPERATION_BITS,
  type StellarPayment,
  type StellarTransaction,
} from './horizon-client';
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
    const failed = (reason: StepFailure, imported = 0): StepResult => ({
      outcome: 'provider_error',
      reason,
      imported,
    });
    const after = state.readTo === null ? null : BigInt(state.readTo);
    const started = Date.now();

    const transactions: StellarTransaction[] = [];
    let listedAll = false;
    for (let page = 0; page < MAX_STELLAR_TRANSACTION_PAGES; page++) {
      const cursor = transactions.at(-1)?.toid ?? after;
      const listed = await this.client.transactions(state.address, cursor);
      if (!listed.ok) return failed(listed.reason);
      for (const item of listed.items) {
        // Oldest first and past the cursor: anything else is an answer the sync cannot trust.
        if ((transactions.at(-1)?.toid ?? after ?? -1n) >= item.toid)
          return failed('invalid_response');
        transactions.push(item);
      }
      if (listed.items.length < HORIZON_TRANSACTION_PAGE_SIZE) {
        listedAll = true;
        break;
      }
    }
    if (transactions.length === 0) {
      await this.commit(state, [], null, true);
      const refused = await this.refreshBalance(state);
      return refused ? failed(refused) : { outcome: 'complete', reason: null, imported: 0 };
    }
    // Everything up to the last listed transaction; the payments must reach it.
    let end = transactions[transactions.length - 1].toid;

    // The operations of the stored transaction itself come after its TOID: start past them.
    const paidAfter = after === null ? null : after | OPERATION_BITS;
    const payments: StellarPayment[] = [];
    let paidAll = false;
    for (let page = 0; page < MAX_STELLAR_PAYMENT_PAGES; page++) {
      const cursor = payments.at(-1)?.id ?? paidAfter;
      const listed = await this.client.payments(state.address, cursor);
      if (!listed.ok) return failed(listed.reason);
      for (const item of listed.items) {
        if ((payments.at(-1)?.id ?? paidAfter ?? -1n) >= item.id) return failed('invalid_response');
        payments.push(item);
      }
      if (listed.items.length < HORIZON_PAYMENT_PAGE_SIZE || payments.at(-1)!.transaction > end) {
        paidAll = true;
        break;
      }
    }
    // The page budget ran out inside the read range: the transaction of the last operation may
    // go on in the next page, so only the ones before it are complete.
    if (!paidAll) end = payments[payments.length - 1].transaction - 1n;
    const ready = transactions.filter((item) => item.toid <= end);
    if (ready.length === 0) return failed('invalid_response');
    end = ready[ready.length - 1].toid;

    const byTransaction = new Map<bigint, StellarOperation[]>();
    let failure: StepFailure | null = null;
    for (const payment of payments) {
      if (payment.transaction > end) break;
      let merged: bigint | null = null;
      if (payment.merge) {
        if (Date.now() - started > SYNC_TIME_BUDGET_MS) {
          // Stop before this transaction; the next pass reads its merge.
          end = payment.transaction - 1n;
          break;
        }
        const read = await this.client.mergeAmount(payment.id, payment.merge.into);
        if (!read.ok) {
          failure = read.reason;
          end = payment.transaction - 1n;
          break;
        }
        merged = read.units;
      }
      const operations = byTransaction.get(payment.transaction) ?? [];
      operations.push({ payment, merged });
      byTransaction.set(payment.transaction, operations);
    }
    const legs: StellarLeg[] = [];
    let done: bigint | null = null;
    for (const transaction of transactions) {
      if (transaction.toid > end) break;
      const operations = byTransaction.get(transaction.toid) ?? [];
      // A payment names the transaction it belongs to by hash too.
      if (operations.some(({ payment }) => payment.hash !== transaction.hash))
        return failed('invalid_response');
      const leg = stellarLeg(state.address, transaction, operations);
      if (leg) legs.push(leg);
      done = transaction.toid;
    }
    // Every operation in the range belongs to a listed transaction.
    const listed = new Set(transactions.map((item) => item.toid));
    if (payments.some((item) => item.transaction <= end && !listed.has(item.transaction)))
      return failed('invalid_response');

    const caughtUp = failure === null && listedAll && done === transactions.at(-1)!.toid;
    const imported = done === null ? 0 : await this.commit(state, legs, done, caughtUp);
    if (failure) return failed(failure, imported);
    if (caughtUp) {
      const refused = await this.refreshBalance(state);
      if (refused) return failed(refused, imported);
    }
    return { outcome: caughtUp ? 'complete' : 'partial', reason: null, imported };
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
        JSON.stringify(leg.raw),
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
