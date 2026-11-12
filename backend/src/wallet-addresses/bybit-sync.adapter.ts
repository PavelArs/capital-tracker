import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  type BybitBalance,
  BybitClient,
  type BybitConvert,
  type BybitCredentials,
  type BybitDeposit,
  type BybitEarnYield,
  type BybitExecution,
  type BybitKeyInfo,
  type BybitPage,
  type BybitResult,
  type BybitWithdrawal,
  CONVERT_PAGE,
} from './bybit-client';
import { BybitKeyBox } from './bybit-key-box';
import {
  type BybitLeg,
  bybitTotals,
  completedTradeLeg,
  convertLeg,
  depositLeg,
  earnLeg,
  formerEarnTxid,
  type StoredLeg,
  tradeLeg,
  UnreadableAmount,
  withdrawalLeg,
  withoutCountedLegs,
  withoutStoredYields,
} from './bybit-records';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { jsonbText } from './jsonb-text';
import { insertTransactions } from './wallet-transactions';

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
/** BYBIT-CONVERT: pages of each convert list read on a pass (newest first, all every pass). */
export const MAX_CONVERT_PAGES = 20;
/**
 * Bybit lists converts made on its website in the convert history from 10 September 2025 on;
 * older ones are read from the coin exchange records, newer ones there would come twice.
 */
export const CONVERTS_LISTED_FROM = Date.UTC(2025, 8, 10);

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
  historyFrom: Date;
  /** BYBIT-ANY-COIN: when the account began counting every coin; null: not yet. */
  everyCoinAt: Date | null;
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

/** How a pass an error stopped ends: out of budget, refused, or with an amount it cannot read. */
function stopped(error: unknown): {
  outcome: StepResult['outcome'];
  reason: StepFailure | null;
  detail: string | null;
} {
  if (error instanceof OutOfBudget) return { outcome: 'partial', reason: null, detail: null };
  if (error instanceof Failed)
    return { outcome: 'provider_error', reason: error.reason, detail: error.detail };
  if (error instanceof UnreadableAmount)
    return { outcome: 'provider_error', reason: 'invalid_response', detail: null };
  throw error;
}

/** One request within the pass's budget; a refusal is thrown as Failed. */
type Call = <T>(request: () => Promise<BybitResult<T>>) => Promise<T>;

/** The requests of one pass that began at `started`: past the budget, OutOfBudget is thrown. */
function budgeted(started: number): Call {
  let requests = 0;
  return async <T>(request: () => Promise<BybitResult<T>>): Promise<T> => {
    if (requests >= MAX_REQUESTS_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS)
      throw new OutOfBudget();
    requests += 1;
    const result = await request();
    if (!result.ok) throw new Failed(result.reason, result.detail);
    return result.value;
  };
}

/** Every page of one window of a list; a window that never ends its pages is refused. */
async function readWindow(
  key: BybitCredentials,
  stream: Stream<unknown>,
  start: number,
  end: number,
  call: Call,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let page: string | null = null;
  for (let pages = 0; ; pages++) {
    if (pages >= MAX_PAGES_PER_WINDOW) throw new Failed('invalid_response', null);
    const at = page;
    const read: BybitPage<unknown> = await call(() => stream.read(key, start, end, at));
    items.push(...read.items);
    page = read.cursor;
    if (page === null || read.items.length === 0) break;
  }
  return items;
}

/**
 * The earliest time a record still to settle holds the list back: it is read again from its
 * time on, unless it has waited a week (then a late completion shows as a gap).
 */
function holdFrom(stream: Stream<unknown>, items: readonly unknown[], start: number, now: number) {
  let held = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const at = stream.pendingAt(item, start);
    if (at !== null && at >= now - PENDING_HOLD_MS) held = Math.min(held, at);
  }
  return held;
}

// sync-bybit-account (M22, PR-EXC-1): the account's spot trades, deposits, withdrawals, Earn
// yield and converts as raw legs, then the balances Bybit reports, all read with the owner's
// read-only key.
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
    const pass = { imported: 0 };
    const finish = (
      outcome: StepResult['outcome'],
      reason: StepFailure | null,
      detail: string | null = null,
    ): StepResult => ({ outcome, reason, imported: pass.imported, detail });
    const account = await this.account(ownerId, addressId);
    const key = account && this.box.open(account.credentials, ownerId, addressId);
    if (!account || !key) return finish('provider_error', 'not_configured');
    if (account.everyCoinAt === null) await this.countEveryCoin(account);
    const now = Date.now();
    const call = budgeted(now);
    try {
      // BYBIT-EARN: whether the key may read Earn now, asked on every pass, so turning the
      // permission on in Bybit counts from the next sync without adding the account again.
      const info = await call(() => this.client.keyInfo(key));
      // BYBIT-KEY: a key the owner later lets trade or withdraw in Bybit is deleted before
      // anything else is asked; the account then waits for a read-only key again.
      if (!info.readOnly || info.canWithdraw) {
        await this.source.query(
          `UPDATE bybit_accounts SET credentials = '{}'::jsonb WHERE "walletId" = $1`,
          [account.id],
        );
        return finish(
          'provider_error',
          'key_rejected',
          'The key can now trade or withdraw, so the app deleted it',
        );
      }
      const allowed = await this.keyFacts(account, info, now);
      const earn = await this.readStreams(account, key, allowed, now, call, pass);
      // BYBIT-CONVERT: every convert again on each pass: the lists have no time range to resume.
      if (info.convert) await this.readConverts(account, key, call, pass);
      const balances = [
        ...(await call(() => this.client.balances(key, 'FUND'))),
        ...(await call(() => this.client.balances(key, 'UNIFIED'))),
      ];
      const holdings = earn ? await this.earnHoldings(account, key, call) : null;
      await this.complete(account, balances, holdings);
      return finish('complete', null);
    } catch (error) {
      const end = stopped(error);
      return finish(end.outcome, end.reason, end.detail);
    }
  }

  /** Each record list in turn; whether Earn may still be read once they are read. */
  private async readStreams(
    account: AccountRow,
    key: BybitCredentials,
    earn: boolean,
    now: number,
    call: Call,
    pass: { imported: number },
  ): Promise<boolean> {
    let allowed = earn;
    for (const stream of this.streams) {
      if (stream.earn && !allowed) continue;
      const cursor = account[stream.column];
      if (cursor === null) continue;
      try {
        await this.readStream(account, key, stream, cursor, now, call, pass);
      } catch (error) {
        if (!(stream.earn && refused(error))) throw error;
        allowed = await this.denyEarn(account);
      }
    }
    return allowed;
  }

  /** One record list from `cursor` to now, window by window, each committed with its cursor. */
  private async readStream(
    account: AccountRow,
    key: BybitCredentials,
    stream: Stream<unknown>,
    cursor: Date,
    now: number,
    call: Call,
    pass: { imported: number },
  ) {
    // Bybit lists the last three months of yield only.
    let start = stream.earn
      ? Math.max(cursor.getTime(), now - EARN_HISTORY_DAYS * DAY_MS)
      : cursor.getTime();
    let held = Number.POSITIVE_INFINITY;
    for (;;) {
      const end = Math.min(start + stream.window, now);
      const items = await readWindow(key, stream, start, end, call);
      const legs = items.flatMap((item) => stream.leg(item) ?? []);
      held = Math.min(held, holdFrom(stream, items, start, now));
      // The cursor never passes a record still to settle, nor the last hour.
      const next = Math.max(cursor.getTime(), Math.min(end, now - REREAD_MS, held));
      pass.imported += await this.commit(account, stream.column, legs, new Date(next));
      account[stream.column] = new Date(next);
      if (end >= now) break;
      start = end;
    }
  }

  /** BYBIT-CONVERT: stores the converts; a key refused them marks converts unreadable. */
  private async readConverts(
    account: AccountRow,
    key: BybitCredentials,
    call: Call,
    pass: { imported: number },
  ) {
    try {
      pass.imported += await this.insertConverts(account, await this.converts(key, call));
    } catch (error) {
      if (!refused(error)) throw error;
      await this.source.query(
        `UPDATE bybit_accounts SET "convertAllowed" = false WHERE "walletId" = $1`,
        [account.id],
      );
    }
  }

  /** BYBIT-EARN: what each Earn product holds; null when Bybit refuses the key Earn now. */
  private async earnHoldings(
    account: AccountRow,
    key: BybitCredentials,
    call: Call,
  ): Promise<EarnHolding[] | null> {
    try {
      return [
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
      return null;
    }
  }

  /**
   * BYBIT-CONVERT: the converts in Bybit's convert history and the older coin exchanges. A key
   * refused the older list still reads the newer one.
   */
  private async converts(
    key: BybitCredentials,
    call: <T>(request: () => Promise<BybitResult<T>>) => Promise<T>,
  ): Promise<BybitLeg[]> {
    const legs: BybitLeg[] = [];
    for (let index = 1; index <= MAX_CONVERT_PAGES; index++) {
      const page: BybitConvert[] = await call(() => this.client.convertHistory(key, index));
      legs.push(...page.flatMap((item) => convertLeg(item, 'convert') ?? []));
      if (page.length < CONVERT_PAGE) break;
    }
    try {
      let cursor: string | null = null;
      for (let pages = 0; pages < MAX_CONVERT_PAGES; pages++) {
        const at = cursor;
        const page: BybitPage<BybitConvert> = await call(() => this.client.coinExchanges(key, at));
        legs.push(
          ...page.items
            .filter((item) => item.time < CONVERTS_LISTED_FROM)
            .flatMap((item) => convertLeg(item, 'exchange') ?? []),
        );
        cursor = page.cursor;
        if (cursor === null || page.items.length === 0) break;
      }
    } catch (error) {
      if (!refused(error)) throw error;
    }
    return legs;
  }

  private insertConverts(account: AccountRow, legs: BybitLeg[]) {
    return this.source.transaction('READ COMMITTED', (manager) =>
      this.insert(manager, account, legs),
    );
  }

  /**
   * BYBIT-EARN, BYBIT-CONVERT: stores the key's public facts as Bybit tells them now, its Earn
   * and Exchange permissions included; a yield list not read yet starts three months back, as far as Bybit keeps it.
   * Whether Earn is read on this pass.
   */
  private async keyFacts(account: AccountRow, info: BybitKeyInfo, now: number) {
    if (!info.earn) {
      await this.source.query(
        `UPDATE bybit_accounts SET "ipBound" = $2, "keyExpiresAt" = $3, "convertAllowed" = $4
          WHERE "walletId" = $1`,
        [account.id, info.ipBound, info.expiresAt, info.convert],
      );
      return this.denyEarn(account);
    }
    const from = new Date(now - EARN_HISTORY_DAYS * DAY_MS);
    await this.source.query(
      `UPDATE bybit_accounts SET "earnAllowed" = true, "ipBound" = $2, "keyExpiresAt" = $3,
          "flexibleReadTo" = coalesce("flexibleReadTo", $4),
          "onchainReadTo" = coalesce("onchainReadTo", $4), "convertAllowed" = $5
        WHERE "walletId" = $1`,
      [account.id, info.ipBound, info.expiresAt, from, info.convert],
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

  /**
   * BYBIT-ANY-COIN, once per account: an account read while it tracked only BTC, ETH, SOL, USDT
   * and USDC left the other coins out. Its trades that moved only USDT or USDC for another coin
   * now move that coin too, unless the owner already answered them, and every list is read again
   * from the start of its history; stored records are never written twice.
   */
  private async countEveryCoin(account: AccountRow) {
    const reset = await this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: { everyCoinAt: Date | null }[] = await manager.query(
        `SELECT "everyCoinAt" FROM bybit_accounts WHERE "walletId" = $1 FOR UPDATE`,
        [account.id],
      );
      if (!current || current.everyCoinAt !== null) return false;
      const trades: { txid: string; blockTime: Date; raw: Record<string, unknown> }[] =
        await manager.query(
          `SELECT t.txid, t."blockTime", t.raw FROM wallet_address_transactions t
            WHERE t."addressId" = $1 AND t.raw->>'kind' = 'trade' AND NOT t.raw ? 'quoteAsset'
              AND t.asset = t.raw->'trade'->>'quote'
              AND NOT EXISTS (SELECT 1 FROM chain_transaction_classifications h
                WHERE h."addressId" = t."addressId" AND h.txid = t.txid)
            ORDER BY t."blockTime", t.txid`,
          [account.id],
        );
      for (const trade of trades) {
        let leg: BybitLeg | null;
        try {
          leg = completedTradeLeg(trade.raw, trade.blockTime);
        } catch (error) {
          // A stored amount that cannot be read again stays the leg it was.
          if (!(error instanceof UnreadableAmount)) throw error;
          leg = null;
        }
        if (!leg) continue;
        await manager.query(
          `UPDATE wallet_address_transactions SET asset = $3, "receivedUnits" = $4::numeric,
              "sentUnits" = $5::numeric, direction = $6, raw = $7::jsonb
            WHERE "addressId" = $1 AND txid = $2`,
          [
            account.id,
            leg.txid,
            leg.asset,
            leg.receivedUnits.toString(),
            leg.sentUnits.toString(),
            leg.direction,
            jsonbText(leg.raw),
          ],
        );
      }
      // Earn yield is listed for three months only: its lists start there again (keyFacts).
      await manager.query(
        `UPDATE bybit_accounts SET "tradesReadTo" = "historyFrom", "depositsReadTo" = "historyFrom",
            "internalReadTo" = "historyFrom", "withdrawalsReadTo" = "historyFrom",
            "flexibleReadTo" = NULL, "onchainReadTo" = NULL, "everyCoinAt" = clock_timestamp()
          WHERE "walletId" = $1`,
        [account.id],
      );
      return true;
    });
    if (!reset) return;
    account.tradesReadTo = account.historyFrom;
    account.depositsReadTo = account.historyFrom;
    account.internalReadTo = account.historyFrom;
    account.withdrawalsReadTo = account.historyFrom;
    account.flexibleReadTo = null;
    account.onchainReadTo = null;
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
          b."internalReadTo", b."withdrawalsReadTo", b."flexibleReadTo", b."onchainReadTo",
          b."historyFrom", b."everyCoinAt"
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

  private async insert(manager: EntityManager, account: AccountRow, read: BybitLeg[]) {
    // BYBIT-EARN-ID: a yield stored under Bybit's id before yields without one were named by
    // their facts is the same record; it is not written again under its new name.
    const former = read.flatMap((leg) => formerEarnTxid(leg) ?? []);
    const stored: StoredLeg[] =
      former.length === 0
        ? []
        : await manager.query(
            `SELECT txid, asset, "blockTime", "receivedUnits"::text AS "receivedUnits"
              FROM wallet_address_transactions WHERE "addressId" = $1 AND txid = ANY($2::text[])`,
            [account.id, former],
          );
    // BYBIT-GAP-COVERED: of each coin, when Bybit reported the balance of the latest counted
    // difference the owner has not deleted (a difference counted before that was stored: then).
    const counted: { asset: string; countedAt: Date }[] =
      read.length === 0
        ? []
        : await manager.query(
            `SELECT t.asset,
                max(coalesce((t.raw->>'coveredTo')::timestamptz, t."blockTime")) AS "countedAt"
              FROM wallet_address_transactions t
              WHERE t."addressId" = $1 AND t.raw->>'balanceGap' = 'true'
                AND NOT EXISTS (SELECT 1 FROM chain_transaction_classifications h
                  JOIN chain_transaction_classification_versions v ON v."addressId" = h."addressId"
                    AND v.txid = h.txid AND v.version = h."currentVersion"
                  WHERE h."addressId" = t."addressId" AND h.txid = t.txid AND v.status = 'deleted')
              GROUP BY t.asset`,
            [account.id],
          );
    const legs = withoutCountedLegs(
      withoutStoredYields(read, stored),
      new Map(counted.map((row) => [row.asset, row.countedAt.getTime()])),
    );
    // Bybit's records have no block: height 0 and no block hash.
    return insertTransactions(manager, account, legs, { blockHeight: '0', blockHash: 'NULL' });
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
    const held = (earn ?? []).filter((item) => /[1-9]/.test(item.quantity));
    const rows = bybitTotals([...balances, ...held]);
    await this.source.transaction('READ COMMITTED', async (manager) => {
      await manager.query(
        `UPDATE bybit_accounts SET balances = $2::jsonb, earn = $3::jsonb,
            "balancesAt" = clock_timestamp()
          WHERE "walletId" = $1`,
        [account.id, jsonbText(rows), earn && jsonbText(held)],
      );
      await manager.query(
        `UPDATE wallet_addresses SET "completedAt" = clock_timestamp()
          WHERE "ownerId" = $1 AND id = $2`,
        [account.ownerId, account.id],
      );
    });
  }
}
