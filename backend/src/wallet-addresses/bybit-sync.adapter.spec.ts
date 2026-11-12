import type { DataSource } from 'typeorm';
import type { BybitClient, BybitConvert, BybitDeposit, BybitKeyInfo } from './bybit-client';
import type { BybitKeyBox } from './bybit-key-box';
import { BybitSyncAdapter, MAX_REQUESTS_PER_SYNC, REREAD_MS } from './bybit-sync.adapter';

// Synthetic account, key and records: how one pass reads an exchange account.
const NOW = Date.UTC(2026, 9, 20, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const key = { apiKey: 'synthetic-key', apiSecret: 'synthetic-secret' };

const keyInfo = (changes: Partial<BybitKeyInfo> = {}): BybitKeyInfo => ({
  userId: '1',
  readOnly: true,
  canWithdraw: false,
  unified: true,
  master: true,
  ipBound: true,
  expiresAt: null,
  earn: false,
  convert: false,
  ...changes,
});
const ok = <T>(value: T) => ({ ok: true, value });
const page = <T>(items: T[], cursor: string | null = null) => ok({ items, cursor });
const deposit = (id: string, state: BybitDeposit['state'], time: number | null, amount = '5') =>
  ({
    internal: true,
    id,
    coin: 'USDT',
    chain: '',
    amount,
    txID: '',
    state,
    time,
    raw: { id },
  }) satisfies BybitDeposit;
const convert = (id: string, time: number): BybitConvert => ({
  id,
  fromCoin: 'USDT',
  fromAmount: '100',
  toCoin: 'BTC',
  toAmount: '0.001',
  state: 'done',
  time,
  raw: { id },
});

type Client = Partial<Record<keyof BybitClient, unknown>>;

/** BYBIT-GAPS: the stored balances, every tracked coin shown, in coin order. */
const totals = (held: Record<string, string>) =>
  ['BTC', 'ETH', 'SOL', 'USDC', 'USDT'].map((coin) => ({ coin, quantity: held[coin] ?? '0' }));

function harness(
  client: Client,
  options: { account?: Record<string, unknown> | null; opened?: boolean; earnFrom?: Date } = {},
) {
  const events: unknown[][] = [];
  const cursor = new Date(NOW - 2 * HOUR);
  const row =
    options.account === null
      ? null
      : {
          id: 'w',
          ownerId: 'o',
          credentials: { sealed: true },
          tradesReadTo: cursor,
          depositsReadTo: cursor,
          internalReadTo: cursor,
          withdrawalsReadTo: cursor,
          flexibleReadTo: null,
          onchainReadTo: null,
          historyFrom: new Date(NOW - 729 * DAY),
          everyCoinAt: new Date(NOW - 30 * DAY),
          ...options.account,
        };
  const columns: Record<string, unknown> = row ? { ...row } : {};
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM wallet_addresses w JOIN bybit_accounts')) return row ? [row] : [];
    if (sql.includes('SELECT "everyCoinAt"')) return [{ everyCoinAt: null }];
    if (sql.includes("raw->>'kind' = 'trade'")) return [];
    if (sql.includes('"tradesReadTo" = "historyFrom"')) {
      for (const name of ['tradesReadTo', 'depositsReadTo', 'internalReadTo', 'withdrawalsReadTo'])
        columns[name] = columns.historyFrom;
      columns.flexibleReadTo = null;
      columns.onchainReadTo = null;
      events.push(['every coin']);
      return [];
    }
    if (sql.includes("credentials = '{}'")) {
      events.push(['key deleted']);
      return [];
    }
    if (sql.includes('"earnAllowed" = false')) {
      events.push(['earn denied']);
      return [];
    }
    if (sql.includes('"earnAllowed" = true')) {
      events.push(['facts', 'earn', args[1], args[4]]);
      return [];
    }
    if (sql.includes('SET "ipBound"')) {
      events.push(['facts', 'no earn', args[1], args[3]]);
      return [];
    }
    if (sql.includes('SELECT "flexibleReadTo", "onchainReadTo"')) {
      const from = options.earnFrom ?? null;
      columns.flexibleReadTo = from;
      columns.onchainReadTo = from;
      return [{ flexibleReadTo: from, onchainReadTo: from }];
    }
    if (sql.includes('"convertAllowed" = false')) {
      events.push(['convert denied']);
      return [];
    }
    const column = /SELECT "(\w+)" FROM bybit_accounts WHERE "walletId" = \$1 FOR UPDATE/.exec(sql);
    if (column) return [{ [column[1]]: columns[column[1]] }];
    if (sql.includes("raw->>'balanceGap' = 'true'")) return [];
    if (sql.includes('INSERT INTO wallet_address_transactions')) {
      const txids = args.filter((_, index) => index % 10 === 2);
      events.push(['insert', ...txids]);
      return txids.map((txid) => ({ txid }));
    }
    const moved = /UPDATE bybit_accounts SET "(\w+)" = \$2 WHERE/.exec(sql);
    if (moved) {
      columns[moved[1]] = args[1] as Date;
      events.push(['cursor', moved[1], (args[1] as Date).getTime() - NOW]);
      return [];
    }
    if (sql.includes('SET balances')) {
      events.push([
        'balances',
        JSON.parse(args[1] as string),
        args[2] && JSON.parse(args[2] as string),
      ]);
      return [];
    }
    if (sql.includes('SET "completedAt"')) {
      events.push(['complete']);
      return [];
    }
    throw new Error(sql);
  });
  const source = {
    query,
    transaction: async (_level: string, run: (manager: unknown) => unknown) => run({ query }),
  };
  const empty = async () => page([]);
  const bybit = {
    keyInfo: jest.fn(async () => ok(keyInfo())),
    executions: jest.fn(empty),
    deposits: jest.fn(empty),
    internalDeposits: jest.fn(empty),
    withdrawals: jest.fn(empty),
    earnYield: jest.fn(empty),
    convertHistory: jest.fn(async () => ok([])),
    coinExchanges: jest.fn(empty),
    balances: jest.fn(async () => ok([])),
    earnPositions: jest.fn(async () => ok([])),
    fixedTermPositions: jest.fn(async () => ok([])),
    ...client,
  };
  const box = { open: jest.fn(() => (options.opened === false ? null : key)) };
  const adapter = new BybitSyncAdapter(
    source as unknown as DataSource,
    bybit as unknown as BybitClient,
    box as unknown as BybitKeyBox,
  );
  return { adapter, events, bybit, box };
}

describe('BYBIT-SYNC: one pass reads the record lists, then the balances', () => {
  let now: jest.SpyInstance;
  beforeEach(() => {
    now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => now.mockRestore());

  it.each([
    ['no account', { account: null }],
    ['a key that cannot be opened', { opened: false }],
  ])('BYBIT-SYNC reports %s as not configured', async (_name, options) => {
    const { adapter, bybit } = harness({}, options);
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'not_configured',
      imported: 0,
      detail: null,
    });
    expect(bybit.keyInfo).not.toHaveBeenCalled();
  });

  it('BYBIT-KEY deletes a key that can now trade or withdraw before reading anything', async () => {
    const { adapter, events, bybit } = harness({
      keyInfo: async () => ok(keyInfo({ canWithdraw: true })),
    });
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'key_rejected',
      imported: 0,
      detail: 'The key can now trade or withdraw, so the app deleted it',
    });
    expect(events).toEqual([['key deleted']]);
    expect(bybit.executions).not.toHaveBeenCalled();
  });

  it('BYBIT-SYNC stores each list window, holds a pending record and stores the balances', async () => {
    const deposits = jest.fn(async () =>
      page([
        deposit('done-1', 'done', NOW - 90 * 60_000),
        deposit('wait-1', 'pending', NOW - 3 * HOUR),
      ]),
    );
    const { adapter, events, bybit } = harness({
      deposits,
      balances: jest.fn(async (_key: unknown, type: string) =>
        ok(
          type === 'FUND'
            ? [{ coin: 'BTC', quantity: '0.5' }]
            : [{ coin: 'BTC', quantity: '0.25' }],
        ),
      ),
    });
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 1,
      detail: null,
    });
    expect(deposits).toHaveBeenCalledWith(key, NOW - 2 * HOUR, NOW, null);
    expect(bybit.earnYield).not.toHaveBeenCalled();
    expect(bybit.convertHistory).not.toHaveBeenCalled();
    expect(events).toEqual([
      ['facts', 'no earn', true, false],
      ['earn denied'],
      ['cursor', 'tradesReadTo', -REREAD_MS],
      ['insert', 'bybit-deposit-internal-done-1'],
      // The pending deposit holds the list where its cursor stood.
      ['cursor', 'depositsReadTo', -2 * HOUR],
      ['cursor', 'internalReadTo', -REREAD_MS],
      ['cursor', 'withdrawalsReadTo', -REREAD_MS],
      ['balances', totals({ BTC: '0.75' }), null],
      ['complete'],
    ]);
  });

  it('BYBIT-SYNC reads a window page by page through its cursors', async () => {
    const executions = jest.fn(
      async (_key: unknown, _start: number, _end: number, at: string | null) =>
        page([], at === null ? 'next' : null),
    );
    const { adapter } = harness({ executions });
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(executions.mock.calls.map(([, , , at]) => at)).toEqual([null]);
    const listed = jest.fn(
      async (_key: unknown, _start: number, _end: number, at: string | null) =>
        at === null ? page([deposit('d', 'failed', NOW - HOUR * 1.5)], 'two') : page([]),
    );
    const second = harness({ deposits: listed });
    await expect(second.adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(listed.mock.calls.map(([, , , at]) => at)).toEqual([null, 'two']);
  });

  it('BYBIT-SYNC refuses a window that never ends its pages', async () => {
    const { adapter } = harness({
      executions: async () => page([deposit('x', 'failed', NOW)], 'again'),
    });
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
      detail: null,
    });
  });

  it("BYBIT-SYNC passes on Bybit's words and keeps what earlier lists stored", async () => {
    const { adapter, events } = harness({
      deposits: async () => page([deposit('done-1', 'done', NOW - 90 * 60_000)]),
      internalDeposits: async () => ({
        ok: false,
        reason: 'rate_limited',
        detail: 'Too many visits',
      }),
    });
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 1,
      detail: 'Too many visits',
    });
    expect(events.at(-1)).toEqual(['cursor', 'depositsReadTo', -REREAD_MS]);
  });

  it('BYBIT-SYNC refuses a record amount it cannot read exactly', async () => {
    const { adapter } = harness({
      deposits: async () =>
        page([deposit('odd', 'done', NOW - 90 * 60_000, '0.0000000000000000001')]),
    });
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
      detail: null,
    });
  });

  it('BYBIT-ANY-COIN reads every list again from the start, window by window, within the budget', async () => {
    const executions = jest.fn(
      async (_key: unknown, _start: number, _end: number, _at: string | null) => page([]),
    );
    const { adapter, events, bybit } = harness({ executions }, { account: { everyCoinAt: null } });
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: 0,
      detail: null,
    });
    expect(events[0]).toEqual(['every coin']);
    // The key's facts take one request; each trade window one more.
    expect(bybit.executions).toHaveBeenCalledTimes(MAX_REQUESTS_PER_SYNC - 1);
    expect(executions.mock.calls[0][1]).toBe(NOW - 729 * DAY);
    expect(bybit.deposits).not.toHaveBeenCalled();
  });

  it('BYBIT-SYNC ends partial when the time is used up', async () => {
    let clock = NOW;
    now.mockImplementation(() => (clock += 30_000));
    const { adapter, bybit } = harness({});
    await expect(adapter.step('o', 'w')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: 0,
      detail: null,
    });
    expect(bybit.keyInfo).not.toHaveBeenCalled();
  });

  it('BYBIT-EARN reads the yield lists and the Earn holdings of a key that may', async () => {
    const earnFrom = new Date(NOW - 2 * HOUR);
    const earnYield = jest.fn(
      async (_key: unknown, _category: string, _start: number, _end: number, _at: unknown) =>
        page([]),
    );
    const { adapter, events } = harness(
      {
        keyInfo: async () => ok(keyInfo({ earn: true })),
        earnYield,
        earnPositions: async (_key: unknown, category: string) =>
          ok(category === 'FlexibleSaving' ? [{ coin: 'USDT', quantity: '10' }] : []),
        fixedTermPositions: async () => ok([{ coin: 'BTC', quantity: '0' }]),
      },
      { earnFrom },
    );
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(earnYield.mock.calls.map(([, category, start]) => [category, start])).toEqual([
      ['FlexibleSaving', earnFrom.getTime()],
      ['OnChain', earnFrom.getTime()],
    ]);
    expect(events).toContainEqual(['cursor', 'flexibleReadTo', -REREAD_MS]);
    expect(events).toContainEqual([
      'balances',
      totals({ USDT: '10' }),
      // A position that holds nothing is left out.
      [{ coin: 'USDT', quantity: '10', product: 'flexible' }],
    ]);
  });

  it('BYBIT-EARN stops reading Earn when Bybit refuses its yield, and counts no holdings', async () => {
    const earnPositions = jest.fn();
    const { adapter, events } = harness(
      {
        keyInfo: async () => ok(keyInfo({ earn: true })),
        earnYield: async () => ({ ok: false, reason: 'key_rejected', detail: null }),
        earnPositions,
      },
      { earnFrom: new Date(NOW - 2 * HOUR) },
    );
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(events.filter(([kind]) => kind === 'earn denied')).toHaveLength(1);
    expect(earnPositions).not.toHaveBeenCalled();
    expect(events).toContainEqual(['balances', totals({}), null]);
  });

  it('BYBIT-EARN counts no holdings when Bybit refuses the positions', async () => {
    const { adapter, events } = harness(
      {
        keyInfo: async () => ok(keyInfo({ earn: true })),
        fixedTermPositions: async () => ({ ok: false, reason: 'key_rejected', detail: null }),
      },
      { earnFrom: new Date(NOW - 2 * HOUR) },
    );
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(events).toContainEqual(['earn denied']);
    expect(events).toContainEqual(['balances', totals({}), null]);
  });

  it('BYBIT-EARN leaves the yield lists unread until both have a start', async () => {
    const earnYield = jest.fn();
    const { adapter } = harness({ keyInfo: async () => ok(keyInfo({ earn: true })), earnYield });
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(earnYield).not.toHaveBeenCalled();
  });

  it('BYBIT-CONVERT stores the converts of both lists, the older one only before it moved', async () => {
    const { adapter, events } = harness({
      keyInfo: async () => ok(keyInfo({ convert: true })),
      convertHistory: async () => ok([convert('new-1', Date.UTC(2025, 10, 1))]),
      coinExchanges: async () =>
        page([convert('old-1', Date.UTC(2025, 5, 1)), convert('late-1', Date.UTC(2025, 9, 1))]),
    });
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({
      outcome: 'complete',
      imported: 2,
    });
    expect(events).toContainEqual([
      'insert',
      'bybit-trade-convert-new-1',
      'bybit-trade-convert-old-1',
    ]);
  });

  it('BYBIT-CONVERT marks converts unreadable when Bybit refuses the convert history', async () => {
    const { adapter, events } = harness({
      keyInfo: async () => ok(keyInfo({ convert: true })),
      convertHistory: async () => ({ ok: false, reason: 'key_rejected', detail: null }),
    });
    await expect(adapter.step('o', 'w')).resolves.toMatchObject({ outcome: 'complete' });
    expect(events).toContainEqual(['convert denied']);
  });
});
