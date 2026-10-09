import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  type BybitBalance,
  BybitClient,
  type BybitCredentials,
  type BybitDeposit,
  type BybitEarnYield,
  type BybitExecution,
  type BybitKeyInfo,
  type BybitPage,
  type BybitResult,
  type BybitWithdrawal,
} from './bybit-client';
import { BybitKeyBox } from './bybit-key-box';
import {
  type BybitLeg,
  bybitCoins,
  depositLeg,
  earnLeg,
  tradeLeg,
  UnreadableAmount,
  withdrawalLeg,
} from './bybit-records';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';

const DAY_MS = 86_400_000;
// Bybit's longest ranges: seven days of trades, less than 30 days of deposits or withdrawals.
const TRADE_WINDOW_MS = 7 * DAY_MS - 1_000;
const RECORD_WINDOW_MS = 29 * DAY_MS;
/** How far back a new account is read: Bybit keeps two years (730 days) of spot trades. */
export const HISTORY_DAYS = 729;
// Every pass reads the last hour again, so a record Bybit lists late is still found; stored
// records are never written twice.
export const REREAD_MS = 60 * 60_000;
// Bounds for one pass; the next pass continues from the committed windows.
export const MAX_REQUESTS_PER_SYNC = 40;
const PENDING_HOLD_MS = 7 * DAY_MS;
const MAX_PAGES_PER_WINDOW = 30;
const SYNC_TIME_BUDGET_MS = 25_000;
/** BYBIT-EARN: Bybit lists the last three months of Earn yield; a day less stays inside them. */
export const EARN_HISTORY_DAYS = 89;

type EarnColumn = 'flexibleReadTo' | 'onchainReadTo';
type Column =
  | 'tradesReadTo'
  | 'depositsReadTo'
  | 'internalReadTo'
  | 'withdrawalsReadTo'
  | EarnColumn;

interface AccountRow {
  id: string;
  ownerId: string;
  credentials: unknown;
  tradesReadTo: Date;
  depositsReadTo: Date;
  internalReadTo: Date;
  withdrawalsReadTo: Date;
  /** BYBIT-EARN: null until the key could read Earn. */
  flexibleReadTo: Date | null;
  onchainReadTo: Date | null;
}

/** BYBIT-EARN: what one Earn product holds of a coin, as stored with the balances. */
export interface EarnHolding {
  coin: string;
  quantity: string;
  product: 'flexible' | 'onchain' | 'fixed';
}

/** One of Bybit's record lists, read window by window from where the last pass stopped. */
interface Stream<T> {
  column: Column;
  /** An Earn yield list: read only with the key's Earn permission, three months back at most. */
  earn?: boolean;
  window: number;
  read: (
    key: BybitCredentials,
    start: number,
    end: number,
    cursor: string | null,
  ) => Promise<BybitResult<BybitPage<T>>>;
  leg: (item: T) => BybitLeg | null;
  /** When a record that is not final yet happened; the list is read again from there. */
  pendingAt: (item: T, start: number) => number | null;
}

class Failed extends Error {
  constructor(
    readonly reason: StepFailure,
    readonly detail: string | null,
  ) {
    super(reason);
  }
}
class OutOfBudget extends Error {}
/** Bybit refused the request for the key: for Earn, the key lacks its permission. */
const refused = (error: unknown) => error instanceof Failed && error.reason === 'key_rejected';

// sync-bybit-account (M22, PR-EXC-1): the account's spot trades, deposits and withdrawals as
// raw legs, then the balances Bybit reports, all read with the owner's read-only key.
@Injectable()
export class BybitSyncAdapter implements ChainSyncAdapter {
  readonly network = 'bybit';
  readonly name = 'Bybit';
  private readonly streams: Stream<unknown>[];

  constructor(
    private readonly source: DataSource,
    private readonly client: BybitClient,
    private readonly box: BybitKeyBox,
  ) {
    const pending = (item: BybitDeposit | BybitWithdrawal, start: number) =>
      item.state === 'pending' ? (item.time ?? start) : null;
    this.streams = [
      {
        column: 'tradesReadTo',
        window: TRADE_WINDOW_MS,
        read: (key, start, end, cursor) => this.client.executions(key, start, end, cursor),
        leg: (item) => tradeLeg(item as BybitExecution),
        pendingAt: () => null,
      },
      {
        column: 'depositsReadTo',
        window: RECORD_WINDOW_MS,
        read: (key, start, end, cursor) => this.client.deposits(key, start, end, cursor),
        leg: (item) => depositLeg(item as BybitDeposit),
        pendingAt: (item, start) => pending(item as BybitDeposit, start),
      },
      {
        column: 'internalReadTo',
        window: RECORD_WINDOW_MS,
        read: (key, start, end, cursor) => this.client.internalDeposits(key, start, end, cursor),
        leg: (item) => depositLeg(item as BybitDeposit),
        pendingAt: (item, start) => pending(item as BybitDeposit, start),
      },
      {
        column: 'withdrawalsReadTo',
        window: RECORD_WINDOW_MS,
        read: (key, start, end, cursor) => this.client.withdrawals(key, start, end, cursor),
        leg: (item) => withdrawalLeg(item as BybitWithdrawal),
        pendingAt: (item, start) => pending(item as BybitWithdrawal, start),
      },
      ...(['FlexibleSaving', 'OnChain'] as const).map((category) => ({
        column: category === 'FlexibleSaving' ? 'flexibleReadTo' : 'onchainReadTo',
        earn: true,
        window: TRADE_WINDOW_MS,
        read: (key: BybitCredentials, start: number, end: number, cursor: string | null) =>
          this.client.earnYield(key, category, start, end, cursor),
        leg: (item: unknown) => earnLeg(item as BybitEarnYield, category),
        // A yield paid only when the position is redeemed stays pending until then.
        pendingAt: (item: unknown) =>
          (item as BybitEarnYield).state === 'pending' ? (item as BybitEarnYield).time : null,
      })),
    ] as Stream<unknown>[];
  }

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    let imported = 0;
    const finish = (
      outcome: StepResult['outcome'],
      reason: StepFailure | null,
      detail: string | null = null,
    ): StepResult => ({ outcome, reason, imported, detail });
    const account = await this.account(ownerId, addressId);
    const key = account && this.box.open(account.credentials, ownerId, addressId);
    if (!account || !key) return finish('provider_error', 'not_configured');
    const now = Date.now();
    const started = now;
    let requests = 0;
    const call = async <T>(request: () => Promise<BybitResult<T>>): Promise<T> => {
      if (requests >= MAX_REQUESTS_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS)
        throw new OutOfBudget();
      requests += 1;
      const result = await request();
      if (!result.ok) throw new Failed(result.reason, result.detail);
      return result.value;
    };
    try {
      // BYBIT-EARN: whether the key may read Earn now, asked on every pass, so turning the
      // permission on in Bybit counts from the next sync without adding the account again.
      let earn = await this.keyFacts(account, await call(() => this.client.keyInfo(key)), now);
      for (const stream of this.streams) {
        if (stream.earn && !earn) continue;
        const cursor = account[stream.column];
        if (cursor === null) continue;
        // Bybit lists the last three months of yield only.
        let start = stream.earn
          ? Math.max(cursor.getTime(), now - EARN_HISTORY_DAYS * DAY_MS)
          : cursor.getTime();
        let held = Number.POSITIVE_INFINITY;
        try {
          for (;;) {
            const end = Math.min(start + stream.window, now);
            const items: unknown[] = [];
            let page: string | null = null;
            for (let pages = 0; ; pages++) {
              if (pages >= MAX_PAGES_PER_WINDOW) throw new Failed('invalid_response', null);
              const from = start;
              const at = page;
              const read: BybitPage<unknown> = await call(() => stream.read(key, from, end, at));
              items.push(...read.items);
              page = read.cursor;
              if (page === null || read.items.length === 0) break;
            }
            const legs = items.flatMap((item) => stream.leg(item) ?? []);
            // A record still to settle is read again from its time on, unless it has waited a
            // week: then it no longer holds the list back (a late completion shows as a gap).
            for (const item of items) {
              const at = stream.pendingAt(item, start);
              if (at !== null && at >= now - PENDING_HOLD_MS) held = Math.min(held, at);
            }
            // The cursor never passes a record still to settle, nor the last hour.
            const next = Math.max(cursor.getTime(), Math.min(end, now - REREAD_MS, held));
            imported += await this.commit(account, stream.column, legs, new Date(next));
            account[stream.column] = new Date(next);
            if (end >= now) break;
            start = end;
          }
        } catch (error) {
          if (!(stream.earn && refused(error))) throw error;
          earn = await this.denyEarn(account);
        }
      }
      const balances = [
        ...(await call(() => this.client.balances(key, 'FUND'))),
        ...(await call(() => this.client.balances(key, 'UNIFIED'))),
      ];
      let holdings: EarnHolding[] | null = null;
      if (earn) {
        try {
          holdings = [
            ...(await call(() => this.client.earnPositions(key, 'FlexibleSaving'))).map((item) => ({
              ...item,
              product: 'flexible' as const,
            })),
            ...(await call(() => this.client.earnPositions(key, 'OnChain'))).map((item) => ({
              ...item,
              product: 'onchain' as const,
            })),
            ...(await call(() => this.client.fixedTermPositions(key))).map((item) => ({
              ...item,
              product: 'fixed' as const,
            })),
          ];
        } catch (error) {
          if (!refused(error)) throw error;
          await this.denyEarn(account);
        }
      }
      await this.complete(account, balances, holdings);
      return finish('complete', null);
    } catch (error) {
      if (error instanceof OutOfBudget) return finish('partial', null);
      if (error instanceof Failed) return finish('provider_error', error.reason, error.detail);
      if (error instanceof UnreadableAmount) return finish('provider_error', 'invalid_response');
      throw error;
    }
  }

  /**
   * BYBIT-EARN: stores the key's public facts as Bybit tells them now, its Earn permission
   * included; a yield list not read yet starts three months back, as far as Bybit keeps it.
   * Whether Earn is read on this pass.
   */
  private async keyFacts(account: AccountRow, info: BybitKeyInfo, now: number) {
    if (!info.earn) {
      await this.source.query(
        `UPDATE bybit_accounts SET "ipBound" = $2, "keyExpiresAt" = $3 WHERE "walletId" = $1`,
        [account.id, info.ipBound, info.expiresAt],
      );
      return this.denyEarn(account);
    }
    const from = new Date(now - EARN_HISTORY_DAYS * DAY_MS);
    await this.source.query(
      `UPDATE bybit_accounts SET "earnAllowed" = true, "ipBound" = $2, "keyExpiresAt" = $3,
          "flexibleReadTo" = coalesce("flexibleReadTo", $4),
          "onchainReadTo" = coalesce("onchainReadTo", $4)
        WHERE "walletId" = $1`,
      [account.id, info.ipBound, info.expiresAt, from],
    );
    const [row]: Pick<AccountRow, EarnColumn>[] = await this.source.query(
      `SELECT "flexibleReadTo", "onchainReadTo" FROM bybit_accounts WHERE "walletId" = $1`,
      [account.id],
    );
    if (!row?.flexibleReadTo || !row.onchainReadTo) return false;
    account.flexibleReadTo = row.flexibleReadTo;
    account.onchainReadTo = row.onchainReadTo;
    return true;
  }

  /** BYBIT-EARN: the key cannot read Earn; its positions are not counted until it can. */
  private async denyEarn(account: AccountRow) {
    await this.source.query(
      `UPDATE bybit_accounts SET "earnAllowed" = false, earn = NULL WHERE "walletId" = $1`,
      [account.id],
    );
    return false;
  }

  private async account(owner: string, id: string): Promise<AccountRow | null> {
    const [row]: AccountRow[] = await this.source.query(
      `SELECT w.id, w."ownerId", b.credentials, b."tradesReadTo", b."depositsReadTo",
          b."internalReadTo", b."withdrawalsReadTo", b."flexibleReadTo", b."onchainReadTo"
        FROM wallet_addresses w JOIN bybit_accounts b ON b."walletId" = w.id
        WHERE w."ownerId" = $1 AND w.id = $2 AND w.network = 'bybit'`,
      [owner, id],
    );
    return row ?? null;
  }

  /** Stores one window's legs and moves that list's cursor in one transaction. */
  private commit(expected: AccountRow, column: Column, legs: BybitLeg[], next: Date) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: Pick<AccountRow, Column>[] = await manager.query(
        `SELECT "${column}" FROM bybit_accounts WHERE "walletId" = $1 FOR UPDATE`,
        [expected.id],
      );
      if (!current || current[column]?.getTime() !== expected[column]?.getTime())
        throw new ConflictException('Another sync advanced this account');
      const inserted = await this.insert(manager, expected, legs);
      await manager.query(`UPDATE bybit_accounts SET "${column}" = $2 WHERE "walletId" = $1`, [
        expected.id,
        next,
      ]);
      return inserted;
    });
  }

  private async insert(manager: EntityManager, account: AccountRow, legs: BybitLeg[]) {
    if (legs.length === 0) return 0;
    const values: unknown[] = [];
    const rows = legs.map((leg) => {
      const base = values.length;
      values.push(
        account.ownerId,
        account.id,
        leg.txid,
        leg.blockTime,
        leg.receivedUnits.toString(),
        leg.sentUnits.toString(),
        leg.feeUnits.toString(),
        leg.direction,
        JSON.stringify(leg.raw),
        leg.asset,
      );
      const slot = (offset: number) => `$${base + offset}`;
      // Bybit's records have no block: height 0 and no block hash.
      return `(${slot(1)},${slot(2)},${slot(3)},0,NULL,${slot(4)},${slot(5)}::numeric,${slot(6)}::numeric,${slot(7)}::numeric,${slot(8)},${slot(9)}::jsonb,${slot(10)})`;
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
   * BYBIT-GAPS: what Bybit holds now in the funding and trading accounts and in Earn together,
   * every coin (the tracked ones are compared with the records). Coins in Earn stay the
   * account's (BYBIT-EARN); null when the key cannot read Earn. "completedAt" marks a history
   * read up to the last hour.
   */
  private async complete(
    account: AccountRow,
    balances: BybitBalance[],
    earn: EarnHolding[] | null,
  ) {
    const totals = new Map<string, bigint>();
    const scale = 10n ** 30n;
    const held = (earn ?? []).filter((item) => /[1-9]/.test(item.quantity));
    for (const { coin, quantity } of [...balances, ...held]) {
      const [whole, fraction = ''] = quantity.split('.');
      totals.set(
        coin,
        (totals.get(coin) ?? 0n) + BigInt(whole) * scale + BigInt(fraction.padEnd(30, '0')),
      );
    }
    for (const coin of bybitCoins) if (!totals.has(coin)) totals.set(coin, 0n);
    const format = (value: bigint) => {
      const fraction = (value % scale).toString().padStart(30, '0').replace(/0+$/, '');
      return `${value / scale}${fraction ? `.${fraction}` : ''}`;
    };
    const rows = [...totals]
      .filter(([coin, value]) => value > 0n || bybitCoins.includes(coin))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([coin, value]) => ({ coin, quantity: format(value) }));
    await this.source.transaction('READ COMMITTED', async (manager) => {
      await manager.query(
        `UPDATE bybit_accounts SET balances = $2::jsonb, earn = $3::jsonb,
            "balancesAt" = clock_timestamp()
          WHERE "walletId" = $1`,
        [account.id, JSON.stringify(rows), earn && JSON.stringify(held)],
      );
      await manager.query(
        `UPDATE wallet_addresses SET "completedAt" = clock_timestamp()
          WHERE "ownerId" = $1 AND id = $2`,
        [account.ownerId, account.id],
      );
    });
  }
}
