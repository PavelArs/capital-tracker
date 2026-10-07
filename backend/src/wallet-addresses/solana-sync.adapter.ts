import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { type SolanaLeg, solanaLegs, solanaMints } from './solana-legs';
import {
  type SignatureInfo,
  SOLANA_SIGNATURE_PAGE_SIZE,
  SolanaRpcClient,
} from './solana-rpc-client';

// Bounds for one pass; the next pass continues from the committed slot.
export const MAX_TRANSACTIONS_PER_SYNC = 40;
// Signature pages of one address in one pass: 50 000 signatures.
export const MAX_SIGNATURE_PAGES = 50;
const SYNC_TIME_BUDGET_MS = 25_000;

interface ScanRow {
  id: string;
  ownerId: string;
  address: string;
  scannedBlock: number | null;
}

/**
 * Solana history from public JSON-RPC. A wallet's signatures do not include tokens sent to its
 * token accounts, so the signatures of each USDT and USDC account it owns are read too. Every
 * finalized signature newer than the stored slot is fetched oldest first, and whole slots are
 * committed with the cursor, so an interrupted pass resumes without gaps or duplicates.
 */
@Injectable()
export class SolanaSyncAdapter implements ChainSyncAdapter {
  readonly network = 'solana';
  readonly name = 'Solana';

  constructor(
    private readonly source: DataSource,
    private readonly rpc: SolanaRpcClient,
  ) {}

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    const state = await this.scan(ownerId, addressId);
    const failed = (reason: StepFailure): StepResult => ({
      outcome: 'provider_error',
      reason,
      imported: 0,
    });
    // The finalized slot first: every slot up to it is final in each list read below.
    const tip = await this.rpc.slot();
    if (!tip.ok) return failed(tip.reason);
    const target = tip.slot;
    const after = state.scannedBlock ?? -1;
    if (after >= target) {
      await this.commit(state, [], after, true);
      return { outcome: 'complete', reason: null, imported: 0 };
    }
    const tokenAccounts = new Set<string>();
    for (const mint of solanaMints) {
      const found = await this.rpc.tokenAccounts(state.address, mint);
      if (!found.ok) return failed(found.reason);
      for (const account of found.accounts) tokenAccounts.add(account);
    }
    const pending = new Map<string, SignatureInfo>();
    for (const address of [state.address, ...tokenAccounts]) {
      const listed = await this.newSignatures(address, after, target);
      if (!listed.ok) return failed(listed.reason);
      for (const item of listed.items) pending.set(item.signature, item);
    }
    const ordered = [...pending.values()].sort(
      (left, right) => left.slot - right.slot || left.signature.localeCompare(right.signature),
    );

    // Whole slots, oldest first, until the pass budget is spent or the provider fails.
    const started = Date.now();
    const legs: SolanaLeg[] = [];
    let end = after;
    let fetched = 0;
    let failure: StepFailure | null = null;
    let position = 0;
    while (position < ordered.length) {
      if (fetched >= MAX_TRANSACTIONS_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS) break;
      const slot = ordered[position].slot;
      const slotLegs: SolanaLeg[] = [];
      let next = position;
      for (; next < ordered.length && ordered[next].slot === slot; next++) {
        const found = await this.rpc.transaction(ordered[next].signature);
        fetched++;
        if (found.ok && found.transaction.slot !== slot) failure = 'invalid_response';
        else if (!found.ok) failure = found.reason;
        if (failure) break;
        if (found.ok) slotLegs.push(...solanaLegs(state.address, tokenAccounts, found.transaction));
      }
      if (failure) break;
      legs.push(...slotLegs);
      end = slot;
      position = next;
    }
    const caughtUp = failure === null && position === ordered.length;
    if (caughtUp) end = target;
    const imported = end === after && !caughtUp ? 0 : await this.commit(state, legs, end, caughtUp);
    if (failure) return { outcome: 'provider_error', reason: failure, imported };
    return { outcome: caughtUp ? 'complete' : 'partial', reason: null, imported };
  }

  /** Signatures of one address in (after, target], newest first, every page of them. */
  private async newSignatures(address: string, after: number, target: number) {
    const items: SignatureInfo[] = [];
    let before: string | null = null;
    for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
      const listed = await this.rpc.signatures(address, before);
      if (!listed.ok) return listed;
      for (const item of listed.items) {
        // Newest first: the first one at or below the stored slot ends the new history.
        if (item.slot <= after) return { ok: true as const, items };
        if (item.slot <= target) items.push(item);
      }
      if (listed.items.length < SOLANA_SIGNATURE_PAGE_SIZE) return { ok: true as const, items };
      before = listed.items[listed.items.length - 1].signature;
    }
    // More history than one pass may list: never store a part that would leave a gap.
    return { ok: false as const, reason: 'invalid_response' as const };
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    const [row]: ScanRow[] = await this.source.query(
      `SELECT id, "ownerId", address, "scannedBlock"
        FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND network = 'solana'`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Stores the legs of whole slots and moves the cursor past them in one transaction. */
  private commit(expected: ScanRow, legs: SolanaLeg[], end: number, caughtUp: boolean) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT id, "ownerId", address, "scannedBlock" FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!current || current.scannedBlock !== expected.scannedBlock) {
        throw new ConflictException('Another sync advanced this address');
      }
      const inserted = await this.insert(manager, current, legs);
      // "completedAt" marks a history read up to a finalized slot: the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET "scannedBlock" = $3,
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, end, caughtUp],
      );
      return inserted;
    });
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: SolanaLeg[]) {
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
        leg.asset,
      );
      const slot = (offset: number) => `$${base + offset}`;
      return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},NULL,${slot(5)},${slot(6)}::numeric,${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)},${slot(10)}::jsonb,${slot(11)})`;
    });
    const inserted: { txid: string }[] = await manager.query(
      `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
        "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw, asset)
        VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
      values,
    );
    return inserted.length;
  }
}
