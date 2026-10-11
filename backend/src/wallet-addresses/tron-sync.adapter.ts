import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { tronHex } from './tron-address';
import {
  needsInfo,
  type TronLeg,
  type TronStakeMove,
  type TronTransactionGroup,
  tronLegs,
  tronTokenContracts,
} from './tron-legs';
import {
  type PageResult,
  TRONSCAN_PAGE_SIZE,
  type TronAccountItem,
  TronGridClient,
  type TronscanInternal,
  type TronTokenTransfer,
  type TronTransactionInfo,
} from './trongrid-client';

// Bounds for one pass; the next pass continues from the committed block time.
export const MAX_INFO_PER_SYNC = 40;
// Pages of one list in one pass: 1 000 items.
export const MAX_TRON_PAGES = 5;
const SYNC_TIME_BUDGET_MS = 25_000;

interface ScanRow {
  id: string;
  ownerId: string;
  address: string;
  readTo: Date | null;
}

type Listed<T> = { ok: true; items: T[]; end: number } | { ok: false; reason: StepFailure };

/**
 * TRON-SYNC: Tron history from TronGrid. Every confirmed transaction of the wallet, its TRX
 * moved by contracts and its USDT and USDC transfers are listed oldest first by block time up to
 * the newest confirmed block; the node's record of each transaction the wallet signed gives its
 * fee and staking amounts. Whole block times are committed with the cursor, so an interrupted
 * pass resumes without gaps or duplicates. Once the history is read, the staking the chain
 * reports is stored beside it (TRON-STAKE-STATE).
 */
@Injectable()
export class TronSyncAdapter implements ChainSyncAdapter {
  readonly network = 'tron';
  readonly name = 'Tron';

  constructor(
    private readonly source: DataSource,
    private readonly client: TronGridClient,
  ) {}

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    const state = await this.scan(ownerId, addressId);
    const hex = tronHex(state.address);
    if (!hex) throw new Error('A stored Tron address is valid');
    const failed = (reason: StepFailure): StepResult => ({
      outcome: 'provider_error',
      reason,
      imported: 0,
    });
    const tip = await this.client.tip();
    if (!tip.ok) return failed(tip.reason);
    const target = tip.tip.timestamp;
    const after = state.readTo?.getTime() ?? 0;
    if (after >= target) {
      await this.commit(state, [], [], after, tip.tip.number, true);
      const imported = await this.readInternal(state, hex, after);
      const refused = await this.refreshState(state);
      if (refused) return { outcome: 'provider_error', reason: refused, imported };
      return { outcome: 'complete', reason: null, imported };
    }

    const started = Date.now();
    const lists: Listed<TronAccountItem | TronTokenTransfer>[] = [
      await this.list((fingerprint) =>
        this.client.transactions(state.address, after + 1, target, fingerprint),
      ),
    ];
    for (const contract of tronTokenContracts)
      lists.push(
        await this.list((fingerprint) =>
          this.client.tokenTransfers(state.address, contract, after + 1, target, fingerprint),
        ),
      );
    let end = target;
    for (const listed of lists) {
      if (!listed.ok) return failed(listed.reason);
      end = Math.min(end, listed.end);
    }
    // One block time alone fills more pages than a pass may read.
    if (end <= after) return failed('invalid_response');
    const groups = new Map<string, Omit<TronTransactionGroup, 'info'>>();
    const group = (txid: string, timestamp: number) => {
      const found = groups.get(txid) ?? {
        txid,
        timestamp,
        transaction: null,
        internal: [],
        tokens: [],
      };
      groups.set(txid, found);
      return found;
    };
    for (const listed of lists) {
      if (!listed.ok) continue;
      for (const item of listed.items) {
        if (item.timestamp <= after || item.timestamp > end) continue;
        // A zero-value token transfer (address poisoning) moves nothing and needs no reading.
        if ('value' in item && item.value === 0n) continue;
        const found = group(item.txid, item.timestamp);
        if ('kind' in item && item.kind === 'transaction') found.transaction = item;
        else if ('kind' in item) found.internal.push(item);
        else found.tokens.push(item);
      }
    }
    const ordered = [...groups.values()].sort(
      (left, right) => left.timestamp - right.timestamp || left.txid.localeCompare(right.txid),
    );

    // Whole block times, oldest first, until the pass budget is spent or the provider fails.
    const legs: TronLeg[] = [];
    const stake: TronStakeMove[] = [];
    let done = after;
    let fetched = 0;
    let failure: StepFailure | null = null;
    let position = 0;
    while (position < ordered.length) {
      const timestamp = ordered[position].timestamp;
      let next = position;
      while (next < ordered.length && ordered[next].timestamp === timestamp) next++;
      const batch = ordered.slice(position, next);
      const wanted = batch.filter((item) => needsInfo(hex, item)).length;
      if (fetched > 0 && fetched + wanted > MAX_INFO_PER_SYNC) break;
      if (Date.now() - started > SYNC_TIME_BUDGET_MS) break;
      const read: TronTransactionGroup[] = [];
      for (const item of batch) {
        let info: TronTransactionInfo | null = null;
        if (needsInfo(hex, item)) {
          const found = await this.client.info(item.txid);
          fetched++;
          if (!found.ok) failure = found.reason;
          else if (found.info.timestamp !== timestamp) failure = 'invalid_response';
          else info = found.info;
          if (failure) break;
        }
        read.push({ ...item, info });
      }
      if (failure) break;
      for (const item of read) {
        const effect = tronLegs(state.address, hex, item);
        legs.push(...effect.legs);
        if (effect.stake) stake.push(effect.stake);
      }
      done = timestamp;
      position = next;
    }
    const caughtUp = failure === null && position === ordered.length && end === target;
    // Everything listed is read: the cursor moves to the end of what the lists covered.
    if (failure === null && position === ordered.length) done = end;
    let imported =
      done === after ? 0 : await this.commit(state, legs, stake, done, tip.tip.number, caughtUp);
    if (failure) return { outcome: 'provider_error', reason: failure, imported };
    if (caughtUp) {
      imported += await this.readInternal(state, hex, done);
      const refused = await this.refreshState(state);
      if (refused) return { outcome: 'provider_error', reason: refused, imported };
    }
    return { outcome: caughtUp ? 'complete' : 'partial', reason: null, imported };
  }

  /**
   * TRON-INTERNAL: TRX a contract sent the wallet inside another account's transaction (an
   * exchange's payout, say), which TronGrid's account list leaves out. Tronscan's list of such
   * transfers names them; each is then read from TronGrid's record of the transaction, whose
   * amounts are the ones stored, as a TRX leg like any other. Only block times the history has
   * already read (up to `readTo`) are taken, and a hash already stored is skipped, so no leg is
   * ever stored twice. When Tronscan or the record cannot be read, the history stays as it is
   * until a later pass; the wallet shows the chain's total beside it meanwhile.
   */
  private async readInternal(state: ScanRow, hex: string, readTo: number): Promise<number> {
    const listed: TronscanInternal[] = [];
    for (let page = 0; page < MAX_TRON_PAGES; page++) {
      const found = await this.client.internalTransfers(state.address, page * TRONSCAN_PAGE_SIZE);
      if (!found.ok) return 0;
      listed.push(...found.items);
      if (found.items.length < TRONSCAN_PAGE_SIZE) break;
    }
    const wanted = new Map<string, TronscanInternal>();
    for (const item of listed)
      if (item.to === hex && item.timestamp <= readTo) wanted.set(item.txid, item);
    if (wanted.size === 0) return 0;
    const stored: { txid: string }[] = await this.source.query(
      `SELECT txid FROM wallet_address_transactions WHERE "addressId" = $1 AND txid = ANY($2)`,
      [state.id, [...wanted.keys()]],
    );
    for (const { txid } of stored) wanted.delete(txid);
    const missing = [...wanted.values()]
      .sort(
        (left, right) => left.timestamp - right.timestamp || left.txid.localeCompare(right.txid),
      )
      .slice(0, MAX_INFO_PER_SYNC);
    const legs: TronLeg[] = [];
    for (const item of missing) {
      const found = await this.client.info(item.txid);
      if (!found.ok) break;
      const { info } = found;
      if (info.timestamp > readTo) continue;
      const effect = tronLegs(state.address, hex, {
        txid: item.txid,
        timestamp: info.timestamp,
        transaction: null,
        internal: info.internal,
        tokens: [],
        info,
      });
      legs.push(...effect.legs);
    }
    if (legs.length === 0) return 0;
    return this.source.transaction('READ COMMITTED', (manager) =>
      this.insert(manager, state, legs),
    );
  }

  /**
   * Every page of one list, up to the pass's limit. A list that has more pages ends before the
   * block time of its last item, which may continue on the next page.
   */
  private async list<T extends { timestamp: number }>(
    read: (fingerprint: string | null) => Promise<PageResult<T>>,
  ): Promise<Listed<T>> {
    const items: T[] = [];
    let fingerprint: string | null = null;
    for (let page = 0; page < MAX_TRON_PAGES; page++) {
      const listed = await read(fingerprint);
      if (!listed.ok) return listed;
      for (const item of listed.items) {
        // Oldest first: anything else is an answer this reading cannot trust.
        if (items.length > 0 && item.timestamp < items[items.length - 1].timestamp)
          return { ok: false, reason: 'invalid_response' };
        items.push(item);
      }
      if (!listed.next) return { ok: true, items, end: Number.POSITIVE_INFINITY };
      fingerprint = listed.next;
    }
    const last = items[items.length - 1];
    return { ok: true, items, end: last ? last.timestamp - 1 : Number.NEGATIVE_INFINITY };
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    await this.source.query(
      `INSERT INTO wallet_tron_accounts ("ownerId", "addressId")
        SELECT "ownerId", id FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND network = 'tron'
        ON CONFLICT ("addressId") DO NOTHING`,
      [owner, id],
    );
    const [row]: ScanRow[] = await this.source.query(
      `SELECT a.id, a."ownerId", a.address, t."readTo"
        FROM wallet_addresses a JOIN wallet_tron_accounts t ON t."addressId" = a.id
        WHERE a."ownerId" = $1 AND a.id = $2 AND a.network = 'tron'`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Stores the legs of whole block times and moves the cursor past them in one transaction. */
  private commit(
    expected: ScanRow,
    legs: TronLeg[],
    stake: TronStakeMove[],
    end: number,
    block: number,
    caughtUp: boolean,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT a.id, a."ownerId", a.address, t."readTo"
          FROM wallet_addresses a JOIN wallet_tron_accounts t ON t."addressId" = a.id
          WHERE a."ownerId" = $1 AND a.id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!current || current.readTo?.getTime() !== expected.readTo?.getTime()) {
        throw new ConflictException('Another sync advanced this address');
      }
      const inserted = await this.insert(manager, current, legs);
      for (const move of stake) {
        await manager.query(
          `INSERT INTO wallet_tron_stake_moves ("ownerId", "addressId", txid, "blockHeight",
            "blockTime", units) VALUES ($1, $2, $3, $4, $5, $6::numeric)
            ON CONFLICT ("addressId", txid) DO NOTHING`,
          [
            current.ownerId,
            current.id,
            move.txid,
            move.blockHeight,
            move.blockTime,
            move.units.toString(),
          ],
        );
      }
      await manager.query('UPDATE wallet_tron_accounts SET "readTo" = $2 WHERE "addressId" = $1', [
        current.id,
        new Date(end),
      ]);
      // "scannedBlock" is the newest confirmed block the pass read toward; "completedAt" marks a
      // history read up to it, so the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET "scannedBlock" = $3,
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, block, caughtUp],
      );
      return inserted;
    });
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: TronLeg[]) {
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

  /**
   * TRON-STAKE-STATE: what the chain says now about the wallet's TRX: liquid, staked for energy
   * or bandwidth, unstaking, and vote rewards not claimed yet (asked only when something is
   * staked). It changes no balance; the history does. Returns the provider's refusal, if any.
   */
  private async refreshState(state: ScanRow): Promise<StepFailure | null> {
    const read = await this.client.account(state.address);
    if (!read.ok) return read.reason;
    const { balance, energy, bandwidth, unstaking } = read.account;
    const staked = energy + bandwidth + unstaking.reduce((sum, item) => sum + item.units, 0n);
    let unclaimed = 0n;
    if (staked > 0n) {
      const reward = await this.client.reward(state.address);
      if (!reward.ok) return reward.reason;
      unclaimed = reward.units;
    }
    await this.source.query(
      `UPDATE wallet_tron_accounts SET reported = $2::jsonb, "reportedAt" = clock_timestamp()
        WHERE "addressId" = $1`,
      [
        state.id,
        JSON.stringify({
          balance: balance.toString(),
          energy: energy.toString(),
          bandwidth: bandwidth.toString(),
          unstaking: unstaking.map((item) => ({
            units: item.units.toString(),
            availableAt: item.availableAt,
          })),
          unclaimed: unclaimed.toString(),
        }),
      ],
    );
    return null;
  }
}
