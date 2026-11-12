import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { tronHex } from './tron-address';
import { tronTokenContracts } from './tron-legs';
import { MAX_INFO_PER_SYNC, TronSyncAdapter } from './tron-sync.adapter';
import type {
  TronGridClient,
  TronTokenTransfer,
  TronTransaction,
  TronTransactionInfo,
} from './trongrid-client';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
function base58check(payload: Buffer): string {
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic accounts, hashes and amounts only, never a real wallet.
const account = (label: string) =>
  base58check(
    Buffer.concat([
      Buffer.from([0x41]),
      createHash('sha256').update(`ct-test-tron-sync:${label}`).digest().subarray(0, 20),
    ]),
  );
const wallet = account('wallet');
const other = account('other');
const walletHex = tronHex(wallet) as string;
const otherHex = tronHex(other) as string;
const [USDT] = tronTokenContracts;
const T0 = 1_760_000_000_000;
const TIP = { number: 70_000_100, timestamp: T0 + 100_000 };
const id = (label: string) => createHash('sha256').update(label).digest('hex');

/** A TRX transfer listed for the account; `signed` when the wallet signed and paid for it. */
const transfer = (label: string, timestamp: number, signed: boolean): TronTransaction => ({
  kind: 'transaction',
  txid: id(label),
  blockNumber: 70_000_000 + (timestamp - T0) / 1000,
  timestamp,
  success: true,
  contractType: 'TransferContract',
  owner: signed ? walletHex : otherHex,
  parameter: {
    owner_address: signed ? walletHex : otherHex,
    to_address: signed ? otherHex : walletHex,
    amount: signed ? 1_000_000 : 5_000_000,
  },
  raw: { txID: id(label) },
});
const info = (label: string, timestamp: number, changes: Partial<TronTransactionInfo> = {}) => ({
  ok: true,
  info: {
    txid: id(label),
    blockNumber: 70_000_000 + (timestamp - T0) / 1000,
    timestamp,
    fee: 100_000n,
    failed: false,
    withdrawAmount: 0n,
    unfreezeAmount: 0n,
    withdrawExpireAmount: 0n,
    internal: [],
    raw: { id: id(label) },
    ...changes,
  } satisfies TronTransactionInfo,
});
const usdt = (label: string, timestamp: number, value: bigint): TronTokenTransfer => ({
  txid: id(label),
  timestamp,
  contract: USDT,
  from: other,
  to: wallet,
  value,
  raw: { transaction_id: id(label) },
});

type Client = Partial<Record<keyof TronGridClient, unknown>>;

function harness(client: Client, readTo: Date | null = null) {
  const stored = { readTo, events: [] as unknown[][] };
  const row = () => ({ id: 'a', ownerId: 'o', address: wallet, readTo: stored.readTo });
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('INSERT INTO wallet_tron_accounts')) return [];
    if (sql.startsWith('SELECT txid FROM wallet_address_transactions')) {
      stored.events.push(['stored?', ...(args[1] as string[])]);
      return (args[1] as string[]).filter((txid) => txid === id('known')).map((txid) => ({ txid }));
    }
    if (sql.includes('INSERT INTO wallet_address_transactions')) {
      const legs = [];
      for (let index = 0; index < args.length; index += 11)
        legs.push([args[index + 2], args[index + 5], args[index + 6], args[index + 7]]);
      stored.events.push(['insert', ...legs]);
      return legs.map(([txid]) => ({ txid }));
    }
    if (sql.includes('INSERT INTO wallet_tron_stake_moves')) {
      stored.events.push(['stake', args[2], args[5]]);
      return [];
    }
    if (sql.includes('SET "readTo"')) {
      stored.readTo = args[1] as Date;
      stored.events.push(['readTo', (args[1] as Date).getTime()]);
      return [];
    }
    if (sql.includes('SET reported')) {
      stored.events.push(['reported', JSON.parse(args[1] as string)]);
      return [];
    }
    if (sql.includes('UPDATE wallet_addresses')) {
      stored.events.push(['address', args[2], args[3]]);
      return [];
    }
    if (sql.includes('FROM wallet_addresses a')) return [row()];
    throw new Error(sql);
  });
  const source = {
    query,
    transaction: async (_level: string, run: (manager: unknown) => unknown) => run({ query }),
  };
  const grid = {
    tip: async () => ({ ok: true, tip: TIP }),
    transactions: async () => ({ ok: true, items: [], next: null }),
    tokenTransfers: async () => ({ ok: true, items: [], next: null }),
    info: jest.fn(async () => ({ ok: false, reason: 'unavailable' })),
    internalTransfers: async () => ({ ok: true, items: [] }),
    account: async () => ({
      ok: true,
      account: { balance: 9_000_000n, energy: 0n, bandwidth: 0n, unstaking: [] },
    }),
    reward: jest.fn(async () => ({ ok: true, units: 0n })),
    ...client,
  };
  const adapter = new TronSyncAdapter(
    source as unknown as DataSource,
    grid as unknown as TronGridClient,
  );
  return { adapter, stored, grid };
}

/** The account's lists as TronGrid pages them: block times in [from, to], one page each. */
const lists = (transactions: TronTransaction[], tokens: TronTokenTransfer[]): Client => ({
  transactions: async (_address: string, from: number, to: number) => ({
    ok: true,
    items: transactions.filter((item) => item.timestamp >= from && item.timestamp <= to),
    next: null,
  }),
  tokenTransfers: async (_address: string, contract: string, from: number, to: number) => ({
    ok: true,
    items: tokens.filter(
      (item) => item.contract === contract && item.timestamp >= from && item.timestamp <= to,
    ),
    next: null,
  }),
});
const reported = {
  balance: '9000000',
  energy: '0',
  bandwidth: '0',
  unstaking: [],
  unclaimed: '0',
};

describe('TRON-SYNC: one pass reads whole block times up to the confirmed tip', () => {
  it('TRON-SYNC fails the pass when the tip cannot be read', async () => {
    const { adapter, stored } = harness({
      tip: async () => ({ ok: false, reason: 'rate_limited' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
    });
    expect(stored.events).toEqual([]);
  });

  it('TRON-SYNC fails the pass when a list fails, storing nothing', async () => {
    const { adapter, stored } = harness({
      transactions: async () => ({ ok: false, reason: 'unavailable' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 0,
    });
    expect(stored.events).toEqual([]);
  });

  it('TRON-SYNC stores each block time with its record, stake and tokens, then reads the state', async () => {
    const received = transfer('received', T0 + 1000, false);
    const sent = transfer('sent', T0 + 2000, true);
    const staking: TronTransaction = {
      ...transfer('stake', T0 + 3000, true),
      contractType: 'FreezeBalanceV2Contract',
      parameter: { owner_address: walletHex, frozen_balance: 2_000_000 },
    };
    const info = jest.fn(async (txid: string) =>
      txid === sent.txid ? infoOf('sent', T0 + 2000) : infoOf('stake', T0 + 3000),
    );
    const { adapter, stored } = harness({
      ...lists(
        [received, sent, staking, transfer('later', TIP.timestamp + 1000, false)],
        [usdt('received', T0 + 1000, 2_500_000n), usdt('poison', T0 + 1500, 0n)],
      ),
      info,
      account: async () => ({
        ok: true,
        account: { balance: 1n, energy: 2_000_000n, bandwidth: 0n, unstaking: [] },
      }),
      reward: async () => ({ ok: true, units: 7n }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 4,
    });
    expect(info.mock.calls.map(([txid]) => txid)).toEqual([sent.txid, staking.txid]);
    expect(stored.events).toEqual([
      [
        'insert',
        [received.txid, '5000000', '0', '0'],
        [`${received.txid}-1`, '2500000', '0', '0'],
        [sent.txid, '0', '1100000', '100000'],
        [staking.txid, '0', '2100000', '100000'],
      ],
      ['stake', staking.txid, '2000000'],
      ['readTo', TIP.timestamp],
      ['address', TIP.number, true],
      [
        'reported',
        { balance: '1', energy: '2000000', bandwidth: '0', unstaking: [], unclaimed: '7' },
      ],
    ]);
  });

  it('TRON-SYNC stores the block times before a record that cannot be read', async () => {
    const received = transfer('received', T0 + 1000, false);
    const sent = transfer('sent', T0 + 2000, true);
    const { adapter, stored } = harness({
      ...lists([received, sent], []),
      info: async () => ({ ok: false, reason: 'rate_limited' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 1,
    });
    expect(stored.events).toEqual([
      ['insert', [received.txid, '5000000', '0', '0']],
      ['readTo', T0 + 1000],
      ['address', TIP.number, false],
    ]);
  });

  it('TRON-SYNC refuses a record of another block time and stores nothing before it', async () => {
    const sent = transfer('sent', T0 + 2000, true);
    const { adapter, stored } = harness({
      ...lists([sent], []),
      info: async () => infoOf('sent', T0 + 9000),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
    });
    expect(stored.events).toEqual([]);
  });

  it('TRON-SYNC ends partial after its share of records, keeping whole block times', async () => {
    const signed = Array.from({ length: MAX_INFO_PER_SYNC + 1 }, (_, index) =>
      transfer(`sent-${index}`, T0 + 1000 * (index + 1), true),
    );
    const info = jest.fn(async (txid: string) => {
      const index = signed.findIndex((item) => item.txid === txid);
      return infoOf(`sent-${index}`, T0 + 1000 * (index + 1));
    });
    const { adapter, stored } = harness({ ...lists(signed, []), info });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: MAX_INFO_PER_SYNC,
    });
    expect(info).toHaveBeenCalledTimes(MAX_INFO_PER_SYNC);
    expect(stored.readTo?.getTime()).toBe(T0 + 1000 * MAX_INFO_PER_SYNC);
  });

  it('TRON-SYNC takes the first block time, then ends partial when the time is used up', async () => {
    const first = transfer('first', T0 + 1000, false);
    const second = transfer('second', T0 + 2000, false);
    const { adapter, stored } = harness(lists([first, second], []));
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 1,
      });
    } finally {
      now.mockRestore();
    }
    expect(stored.readTo?.getTime()).toBe(T0 + 1000);
  });

  it('TRON-STAKE-STATE fails a read history when the chain state cannot be read', async () => {
    const { adapter } = harness({
      ...lists([transfer('received', T0 + 1000, false)], []),
      account: async () => ({ ok: false, reason: 'unavailable' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 1,
    });
  });

  it('TRON-STAKE-STATE fails when the unclaimed rewards of a staked wallet cannot be read', async () => {
    const { adapter } = harness({
      account: async () => ({
        ok: true,
        account: {
          balance: 0n,
          energy: 0n,
          bandwidth: 0n,
          unstaking: [{ units: 3n, availableAt: '2026-11-10T00:00:00.000Z' }],
        },
      }),
      reward: async () => ({ ok: false, reason: 'rate_limited' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
    });
  });
});

describe('TRON-INTERNAL: TRX contracts sent inside other accounts’ transactions', () => {
  const readTo = new Date(TIP.timestamp);
  const internal = (label: string, timestamp: number, to = walletHex) => ({
    txid: id(label),
    timestamp,
    to,
  });

  it('TRON-INTERNAL stores the missing payouts of read block times once the history is read', async () => {
    const internalTransfers = jest.fn(async (_address: string, start: number) => ({
      ok: true,
      items:
        start === 0
          ? [
              internal('payout', T0 + 5000),
              internal('known', T0 + 6000),
              internal('elsewhere', T0 + 7000, otherHex),
              internal('future', TIP.timestamp + 1000),
              ...Array.from({ length: 6 }, (_, index) =>
                internal(`late-${index}`, T0 + 8000 + index, walletHex),
              ),
            ]
          : [internal('second-page', T0 + 9000)],
    }));
    const info = jest.fn(async (txid: string) => {
      const moved = (label: string, timestamp: number) =>
        infoOf(label, timestamp, {
          internal: [
            {
              kind: 'internal',
              txid: id(label),
              timestamp,
              from: otherHex,
              to: walletHex,
              units: 4_000_000n,
              rejected: false,
              raw: { hash: id(label) },
            },
          ],
        });
      if (txid === id('payout')) return moved('payout', T0 + 5000);
      if (txid === id('second-page')) return moved('second-page', T0 + 9000);
      if (txid === id('late-0')) return infoOf('late-0', TIP.timestamp + 5000);
      return { ok: false, reason: 'unavailable' };
    });
    const { adapter, stored } = harness({ internalTransfers, info }, readTo);
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 1,
    });
    expect(internalTransfers.mock.calls.map(([, start]) => start)).toEqual([0, 10]);
    expect(info.mock.calls.map(([txid]) => txid)).toEqual([
      id('payout'),
      id('late-0'),
      id('late-1'),
    ]);
    expect(stored.events).toEqual([
      ['readTo', TIP.timestamp],
      ['address', TIP.number, true],
      [
        'stored?',
        id('payout'),
        id('known'),
        ...Array.from({ length: 6 }, (_, index) => id(`late-${index}`)),
        id('second-page'),
      ],
      ['insert', [id('payout'), '4000000', '0', '0']],
      ['reported', reported],
    ]);
  });

  it('TRON-INTERNAL leaves the history as it is when Tronscan cannot be read', async () => {
    const { adapter, stored } = harness(
      { internalTransfers: async () => ({ ok: false, reason: 'unavailable' }) },
      readTo,
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(stored.events).toEqual([
      ['readTo', TIP.timestamp],
      ['address', TIP.number, true],
      ['reported', reported],
    ]);
  });
});

function infoOf(label: string, timestamp: number, changes: Partial<TronTransactionInfo> = {}) {
  return info(label, timestamp, changes);
}
