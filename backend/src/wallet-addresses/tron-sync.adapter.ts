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
import { MAX_TRON_PAGES, readTronLists } from './tron-listing';
import {
  TRONSCAN_PAGE_SIZE,
  type TronAccountItem,
  TronGridClient,
  type TronscanInternal,
  type TronTokenTransfer,
  type TronTransactionInfo,
} from './trongrid-client';
import { insertTransactions } from './wallet-transactions';

// Bounds for one pass; the next pass continues from the committed block time.
export const MAX_INFO_PER_SYNC = 40;
const SYNC_TIME_BUDGET_MS = 25_000;

interface ScanRow {
  id: string;
  ownerId: string;
  address: string;
  readTo: Date | null;
}

/** One transaction hash as the lists name it, before the node's record is read. */
type ListedGroup = Omit<TronTransactionGroup, 'info'>;

const failed = (reason: StepFailure, imported: number): StepResult => ({
  outcome: 'provider_error',
  reason,
  imported,
});

/** Files one listed item under its transaction. */
function addItem(group: ListedGroup, item: TronAccountItem | TronTokenTransfer) {
  if ('kind' in item && item.kind === 'transaction') group.transaction = item;
  else if ('kind' in item) group.internal.push(item);
  else group.tokens.push(item);
}

/** The index just past the transactions of the block time at `position`. */
function blockEnd(ordered: readonly ListedGroup[], position: number): number {
  const { timestamp } = ordered[position];
  let next = position;
  while (next < ordered.length && ordered[next].timestamp === timestamp) next++;
  return next;
}

/** The listed items of block times in (after, end], by transaction hash, oldest first. */
function byTransaction(
  lists: readonly { items: (TronAccountItem | TronTokenTransfer)[] }[],
  after: number,
  end: number,
): ListedGroup[] {
  const groups = new Map<string, ListedGroup>();
  for (const list of lists) {
    for (const item of list.items) {
      if (item.timestamp <= after || item.timestamp > end) continue;
      // A zero-value token transfer (address poisoning) moves nothing and needs no reading.
      if ('value' in item && item.value === 0n) continue;
      const found = groups.get(item.txid) ?? {
        txid: item.txid,
        timestamp: item.timestamp,
        transaction: null,
        internal: [],
        tokens: [],
      };
      groups.set(item.txid, found);
      addItem(found, item);
    }
  }
  return [...groups.values()].sort(
    (left, right) => left.timestamp - right.timestamp || left.txid.localeCompare(right.txid),
  );
}

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
    const tip = await this.client.tip();
    if (!tip.ok) return failed(tip.reason, 0);
    const target = tip.tip.timestamp;
    const after = state.readTo?.getTime() ?? 0;
    if (after >= target) {
      await this.commit(state, [], [], after, tip.tip.number, true);
      return this.completed(state, hex, after, 0);
    }

    const started = Date.now();
    const listed = await readTronLists<TronAccountItem | TronTokenTransfer>(
      [
        (from, to, fingerprint) => this.client.transactions(state.address, from, to, fingerprint),
        ...tronTokenContracts.map(
          (contract) => (from: number, to: number, fingerprint: string | null) =>
            this.client.tokenTransfers(state.address, contract, from, to, fingerprint),
        ),
      ],
      after,
      target,
    );
    if (!listed.ok) return failed(listed.reason, 0);
    const { lists, end } = listed;
    const ordered = byTransaction(lists, after, end);
    const read = await this.readBlocks(state.address, hex, ordered, after, started);
    const all = read.failure === null && read.position === ordered.length;
    const caughtUp = all && end === target;
    // Everything listed is read: the cursor moves to the end of what the lists covered.
    const done = all ? end : read.done;
    const imported =
      done === after
        ? 0
        : await this.commit(state, read.legs, read.stake, done, tip.tip.number, caughtUp);
    if (read.failure) return failed(read.failure, imported);
    if (!caughtUp) return { outcome: 'partial', reason: null, imported };
    return this.completed(state, hex, done, imported);
  }

  /** A history read up to the tip: contract payouts, then the staking the chain reports. */
  private async completed(
    state: ScanRow,
    hex: string,
    readTo: number,
    imported: number,
  ): Promise<StepResult> {
    const total = imported + (await this.readInternal(state, hex, readTo));
    const refused = await this.refreshState(state);
    if (refused) return { outcome: 'provider_error', reason: refused, imported: total };
    return { outcome: 'complete', reason: null, imported: total };
  }

  /**
   * Whole block times, oldest first, until the pass budget is spent or the provider fails. The
   * first block time is always taken: a pass that listed for long must still advance.
   */
  private async readBlocks(
    address: string,
    hex: string,
    ordered: readonly ListedGroup[],
    after: number,
    started: number,
  ) {
    const legs: TronLeg[] = [];
    const stake: TronStakeMove[] = [];
    let done = after;
    let fetched = 0;
    let position = 0;
    while (position < ordered.length) {
      const timestamp = ordered[position].timestamp;
      const next = blockEnd(ordered, position);
      const batch = ordered.slice(position, next);
      const wanted = batch.filter((item) => needsInfo(hex, item)).length;
      if (fetched > 0 && fetched + wanted > MAX_INFO_PER_SYNC) break;
      if (position > 0 && Date.now() - started > SYNC_TIME_BUDGET_MS) break;
      const read = await this.readBatch(hex, batch, timestamp);
      if (!read.ok) return { legs, stake, done, position, failure: read.reason };
      fetched += wanted;
      for (const item of read.groups) {
        const effect = tronLegs(address, hex, item);
        legs.push(...effect.legs);
        if (effect.stake) stake.push(effect.stake);
      }
      done = timestamp;
      position = next;
    }
    return { legs, stake, done, position, failure: null };
  }

  /** The node's record of each transaction of one block time that needs one. */
  private async readBatch(
    hex: string,
    batch: readonly ListedGroup[],
    timestamp: number,
  ): Promise<{ ok: true; groups: TronTransactionGroup[] } | { ok: false; reason: StepFailure }> {
    const groups: TronTransactionGroup[] = [];
    for (const item of batch) {
      let info: TronTransactionInfo | null = null;
      if (needsInfo(hex, item)) {
        const found = await this.client.info(item.txid);
        if (!found.ok) return { ok: false, reason: found.reason };
        if (found.info.timestamp !== timestamp) return { ok: false, reason: 'invalid_response' };
        info = found.info;
      }
      groups.push({ ...item, info });
    }
    return { ok: true, groups };
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
    const listed = await this.listInternal(state.address);
    if (!listed) return 0;
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
    const legs = await this.payoutLegs(state.address, hex, missing, readTo);
    if (legs.length === 0) return 0;
    return this.source.transaction('READ COMMITTED', (manager) =>
      this.insert(manager, state, legs),
    );
  }

  /** Tronscan's pages of contract transfers to the account; null when one cannot be read. */
  private async listInternal(address: string): Promise<TronscanInternal[] | null> {
    const listed: TronscanInternal[] = [];
    for (let page = 0; page < MAX_TRON_PAGES; page++) {
      const found = await this.client.internalTransfers(address, page * TRONSCAN_PAGE_SIZE);
      if (!found.ok) return null;
      listed.push(...found.items);
      if (found.items.length < TRONSCAN_PAGE_SIZE) break;
    }
    return listed;
  }

  /** The TRX legs of each payout by TronGrid's record of it, until a record cannot be read. */
  private async payoutLegs(
    address: string,
    hex: string,
    missing: readonly TronscanInternal[],
    readTo: number,
  ): Promise<TronLeg[]> {
    const legs: TronLeg[] = [];
    for (const item of missing) {
      const found = await this.client.info(item.txid);
      if (!found.ok) break;
      const { info } = found;
      if (info.timestamp > readTo) continue;
      const effect = tronLegs(address, hex, {
        txid: item.txid,
        timestamp: info.timestamp,
        transaction: null,
        internal: info.internal,
        tokens: [],
        info,
      });
      legs.push(...effect.legs);
    }
    return legs;
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

  private insert(manager: EntityManager, address: ScanRow, legs: TronLeg[]) {
    return insertTransactions(manager, address, legs, { blockHash: 'NULL' });
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
