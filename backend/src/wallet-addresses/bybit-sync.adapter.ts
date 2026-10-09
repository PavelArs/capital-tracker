import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  type BybitBalance,
  BybitClient,
  type BybitCredentials,
  type BybitDeposit,
  type BybitExecution,
  type BybitPage,
  type BybitResult,
  type BybitWithdrawal,
} from './bybit-client';
import { BybitKeyBox } from './bybit-key-box';
import {
  type BybitLeg,
  bybitCoins,
  depositLeg,
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

type Column = 'tradesReadTo' | 'depositsReadTo' | 'internalReadTo' | 'withdrawalsReadTo';

interface AccountRow {
  id: string;
  ownerId: string;
  credentials: unknown;
  tradesReadTo: Date;
  depositsReadTo: Date;
  internalReadTo: Date;
  withdrawalsReadTo: Date;
}

/** One of Bybit's record lists, read window by window from where the last pass stopped. */
interface Stream<T> {
  column: Column;
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
      for (const stream of this.streams) {
        let start = account[stream.column].getTime();
        let held = Number.POSITIVE_INFINITY;
        for (;;) {
          const end = Math.min(start + stream.window, now);
          const items: unknown[] = [];
          let cursor: string | null = null;
          for (let pages = 0; ; pages++) {
            if (pages >= MAX_PAGES_PER_WINDOW) throw new Failed('invalid_response', null);
            const from = start;
            const page: BybitPage<unknown> = await call(() => stream.read(key, from, end, cursor));
            items.push(...page.items);
            cursor = page.cursor;
            if (cursor === null || page.items.length === 0) break;
          }
          const legs = items.flatMap((item) => stream.leg(item) ?? []);
          // A record still to settle is read again from its time on, unless it has waited a
          // week: then it no longer holds the list back (a late completion shows as a gap).
          for (const item of items) {
            const at = stream.pendingAt(item, start);
            if (at !== null && at >= now - PENDING_HOLD_MS) held = Math.min(held, at);
          }
          // The cursor never passes a record still to settle, nor the last hour.
          const next = Math.max(
            account[stream.column].getTime(),
            Math.min(end, now - REREAD_MS, held),
          );
          imported += await this.commit(account, stream.column, legs, new Date(next));
          account[stream.column] = new Date(next);
          if (end >= now) break;
          start = end;
        }
      }
      const balances = [
        ...(await call(() => this.client.balances(key, 'FUND'))),
        ...(await call(() => this.client.balances(key, 'UNIFIED'))),
      ];
      await this.complete(account, balances);
      return finish('complete', null);
    } catch (error) {
      if (error instanceof OutOfBudget) return finish('partial', null);
      if (error instanceof Failed) return finish('provider_error', error.reason, error.detail);
      if (error instanceof UnreadableAmount) return finish('provider_error', 'invalid_response');
      throw error;
    }
  }

  private async account(owner: string, id: string): Promise<AccountRow | null> {
    const [row]: AccountRow[] = await this.source.query(
      `SELECT w.id, w."ownerId", b.credentials, b."tradesReadTo", b."depositsReadTo",
          b."internalReadTo", b."withdrawalsReadTo"
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
      if (!current || current[column].getTime() !== expected[column].getTime())
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
   * BYBIT-GAPS: what Bybit holds now in the funding and trading accounts together, every coin
   * (the tracked ones are compared with the records). "completedAt" marks a history read up
   * to the last hour.
   */
  private async complete(account: AccountRow, balances: BybitBalance[]) {
    const totals = new Map<string, bigint>();
    const scale = 10n ** 30n;
    for (const { coin, quantity } of balances) {
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
        `UPDATE bybit_accounts SET balances = $2::jsonb, "balancesAt" = clock_timestamp()
          WHERE "walletId" = $1`,
        [account.id, JSON.stringify(rows)],
      );
      await manager.query(
        `UPDATE wallet_addresses SET "completedAt" = clock_timestamp()
          WHERE "ownerId" = $1 AND id = $2`,
        [account.ownerId, account.id],
      );
    });
  }
}
