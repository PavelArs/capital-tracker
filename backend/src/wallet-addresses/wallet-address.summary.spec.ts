import type { DataSource } from 'typeorm';
import { forgetTokens, rememberTokens } from './chain-assets';
import { WalletAddressService } from './wallet-address.service';
import type { WalletSyncService } from './wallet-sync.service';

// Synthetic ids, addresses and amounts only: what `list` makes of the stored rows is under test.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date('2026-11-01T12:00:00.000Z');

const base = (id: string, network: string, address: string) => ({
  id,
  ownerId: owner,
  network,
  address,
  accountId: null,
  label: null,
  scannedBlock: null,
  tokenBackfillTo: null,
  hiddenTokens: [],
  shownTokens: [],
  walkTopTxid: null,
  walkCursorTxid: null,
  completedTopTxid: null,
  completedAt: null,
  syncDisabledAt: null,
  syncDisabledReason: null,
  syncFailures: 0,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  transactionCount: 0,
  balances: [],
  stake: [],
  pools: [],
  derived: null,
  exchange: null,
  tron: null,
  stellar: null,
  source: null,
});
const done = new Date('2026-10-30T00:00:00.000Z');
const shown = `0x${'51'.repeat(20)}`;
const negative = `0x${'4e'.repeat(20)}`;
const hiddenByOwner = `0x${'0d'.repeat(20)}`;
const token = (contract: string, symbol: string, decimals: number) => ({
  network: 'ethereum' as const,
  token: contract,
  symbol,
  name: `Synthetic ${symbol}`,
  decimals,
  contract,
  listed: true,
});
const rows = [
  {
    ...base('10000000-0000-4000-8000-000000000001', 'bitcoin', 'bc1qsynthetic'),
    completedAt: done,
    transactionCount: 2,
    balances: [{ asset: null, units: '150000000' }],
    syncDisabledAt: new Date('2026-10-31T00:00:00.000Z'),
    syncDisabledReason: 'failures',
    source: {
      state: 'failed',
      lastAttemptAt: '2026-11-01T11:00:00.000Z',
      lastSuccessAt: '2026-10-30T00:00:00.000Z',
      nextRunAt: null,
      errorCode: 'unavailable',
      errorMessage: 'The source did not answer.',
    },
  },
  {
    ...base('10000000-0000-4000-8000-000000000002', 'bitcoin', 'bc1qwalking'),
    walkTopTxid: 'a'.repeat(64),
  },
  {
    ...base('10000000-0000-4000-8000-000000000003', 'bitcoin', 'xpubsynthetic'),
    derived: { derived: 20, used: 3, walking: false, alsoTracked: [] },
  },
  {
    ...base('10000000-0000-4000-8000-000000000004', 'bitcoin', 'zpubsynthetic'),
    completedAt: done,
    derived: { derived: 40, used: 5, walking: true, alsoTracked: [] },
  },
  {
    ...base('10000000-0000-4000-8000-000000000005', 'bybit', 'bybit-account'),
    completedAt: done,
    exchange: {
      keyHint: 'WXYZ',
      ipBound: true,
      keyExpiresAt: '2027-01-01T00:00:00+00:00',
      balances: [
        { coin: 'BTC', quantity: '0.5' },
        { coin: 'DOGE', quantity: '12' },
        { coin: 'ZERO', quantity: '0' },
        { coin: 'usd', quantity: '3' },
      ],
      balancesAt: '2026-10-30T00:00:00+00:00',
      historyFrom: '2025-11-01T00:00:00+00:00',
      readFrom: '2026-10-30T00:00:00+00:00',
      earnAllowed: true,
      earn: [
        { coin: 'BTC', quantity: '0.1', product: 'flexible' },
        { coin: 'eur', quantity: '1', product: 'fixed' },
      ],
      convertAllowed: false,
      hiddenLegs: [
        { coin: 'BTC', units: '1000' },
        { coin: 'USDT', units: '0' },
      ],
    },
  },
  {
    ...base('10000000-0000-4000-8000-000000000006', 'bybit', 'bybit-new'),
    exchange: {
      keyHint: 'ABCD',
      ipBound: false,
      keyExpiresAt: null,
      balances: null,
      balancesAt: null,
      historyFrom: '2025-11-01T00:00:00+00:00',
      readFrom: '2025-11-01T00:00:00+00:00',
      earnAllowed: null,
      earn: null,
      convertAllowed: null,
      hiddenLegs: [],
    },
  },
  {
    ...base('10000000-0000-4000-8000-000000000007', 'tron', 'TSyntheticReported'),
    completedAt: done,
    balances: [
      { asset: null, units: '9000000' },
      { asset: 'USDT', units: '2500000' },
    ],
    tron: {
      staked: '4000000',
      rewarded: '120000',
      reported: {
        balance: '5000000',
        energy: '3000000',
        bandwidth: '0',
        unstaking: [{ units: '1500000', availableAt: '2026-11-10T00:00:00.000Z' }],
        unclaimed: '7000',
      },
    },
  },
  {
    ...base('10000000-0000-4000-8000-000000000008', 'tron', 'TSyntheticHistory'),
    completedAt: done,
    balances: [{ asset: null, units: '2000000' }],
    tron: { staked: '1000000', rewarded: '0', reported: null },
  },
  {
    ...base('10000000-0000-4000-8000-000000000009', 'stellar', 'GSYNTHETIC'),
    completedAt: done,
    balances: [{ asset: null, units: '25000000' }],
    stellar: { reportedUnits: '30000000' },
  },
  {
    ...base('10000000-0000-4000-8000-00000000000a', 'stellar', 'GSYNTHETICSAME'),
    completedAt: done,
    balances: [{ asset: null, units: '25000000' }],
    stellar: { reportedUnits: '25000000' },
  },
  {
    ...base('10000000-0000-4000-8000-00000000000b', 'solana', 'SoLSynthetic'),
    completedAt: done,
    balances: [
      { asset: null, units: '3000000000' },
      { asset: 'USDC', units: '1000000' },
    ],
    stake: [
      {
        account: 'StakeOne',
        validator: 'VoteOne',
        pool: null,
        state: 'active',
        units: '2000000000',
        rewardUnits: '5000000',
      },
      {
        account: 'StakeClosed',
        validator: null,
        pool: null,
        state: 'closed',
        units: '0',
        rewardUnits: '0',
      },
    ],
    pools: [
      { asset: null, units: '100000000' },
      { asset: 'USDT', units: '0' },
    ],
  },
  {
    ...base('10000000-0000-4000-8000-00000000000c', 'ethereum', '0xsynthetic'),
    scannedBlock: 1200,
    balances: [{ asset: null, units: '1000000000000000000' }],
  },
  {
    ...base('10000000-0000-4000-8000-00000000000d', 'ethereum', '0xbackfill'),
    completedAt: done,
    tokenBackfillTo: 900,
    balances: [{ asset: null, units: '1000000000000000000' }],
  },
  base('10000000-0000-4000-8000-00000000000e', 'bitcoin', 'bc1qnever'),
  {
    ...base('10000000-0000-4000-8000-00000000000f', 'bitcoin', 'ypubcomplete'),
    completedAt: done,
    balances: [{ asset: null, units: '1' }],
    derived: {
      derived: 10,
      used: 1,
      walking: false,
      alsoTracked: [
        { id: '20000000-0000-4000-8000-000000000001', address: 'bc1qalso', label: 'Also' },
      ],
    },
  },
  {
    ...base('10000000-0000-4000-8000-000000000010', 'bitcoin', 'xpubnever'),
    derived: { derived: 0, used: 0, walking: false, alsoTracked: [] },
  },
  {
    ...base('10000000-0000-4000-8000-000000000011', 'bybit', 'bybit-reading'),
    exchange: {
      keyHint: 'EFGH',
      ipBound: true,
      keyExpiresAt: null,
      balances: [{ coin: 'ETH', quantity: '2' }],
      balancesAt: '2026-10-30T00:00:00+00:00',
      historyFrom: '2025-11-01T00:00:00+00:00',
      readFrom: '2026-03-01T00:00:00+00:00',
      earnAllowed: false,
      earn: null,
      convertAllowed: true,
      hiddenLegs: [{ coin: 'ETH', units: '5' }],
    },
  },
  base('10000000-0000-4000-8000-000000000012', 'ethereum', '0xnever'),
  {
    ...base('10000000-0000-4000-8000-000000000013', 'ethereum', '0xtokens'),
    completedAt: done,
    hiddenTokens: [hiddenByOwner],
    balances: [
      { asset: null, units: '2000000000000000000' },
      { asset: 'USDT', units: '7000000' },
      { asset: shown, units: '1500' },
      { asset: negative, units: '-10' },
      { asset: hiddenByOwner, units: '4' },
    ],
    pools: [{ asset: shown, units: '500' }],
  },
  {
    ...base('10000000-0000-4000-8000-000000000014', 'tron', 'TSyntheticZero'),
    completedAt: done,
    balances: [{ asset: null, units: '1000000' }],
    tron: {
      staked: '0',
      rewarded: '0',
      reported: { balance: '1000000', energy: '0', bandwidth: '0', unstaking: [], unclaimed: '0' },
    },
  },
];

describe('WALLET-SUMMARY: what the wallet list makes of each stored address', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now });
    rememberTokens([
      token(shown, 'SHW', 2),
      token(negative, 'NEG', 0),
      token(hiddenByOwner, 'HID', 0),
    ]);
  });
  afterEach(() => {
    jest.useRealTimers();
    forgetTokens();
  });

  it('WALLET-SUMMARY shows balances, staking, pools, exchange facts and sync state as stored', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM wallet_addresses a')) return rows;
      // No dust threshold and no stored prices: only the token rules decide.
      return [];
    });
    const manager = { query };
    const source = {
      transaction: async (_level: string, work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
    };
    const service = new WalletAddressService(
      source as unknown as DataSource,
      {} as unknown as WalletSyncService,
    );
    const result = await service.list(owner);
    // The same keys in the same order: the API's JSON as it was.
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
    expect(result).toStrictEqual(expected);
  });
});

const sync = (state: string, completedAt: string | null = null) => ({
  state,
  completedAt,
  status: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  errorMessage: null,
});
const completed = sync('complete', '2026-10-30T00:00:00.000Z');
/** One summary with every key in its place; `parts` names what differs from an empty one. */
const summaryOf = (index: number, parts: Record<string, unknown> = {}) => ({
  id: rows[index].id,
  network: rows[index].network,
  address: rows[index].address,
  accountId: null,
  label: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: rows[index].transactionCount,
  chainBalance: null,
  balances: null,
  ...('hiddenTokens' in parts ? { hiddenTokens: null } : {}),
  staking: null,
  pools: null,
  reportedBalance: null,
  exchange: null,
  accountKey: null,
  sync: sync('never'),
  ...parts,
});
const trx = (quantity: string) => ({ symbol: 'TRX', quantity });
const zeroTokens = [
  { symbol: 'USDT', quantity: '0.000000' },
  { symbol: 'USDC', quantity: '0.000000' },
];
const position = (
  account: string,
  kind: string | null,
  state: string | null,
  quantity: string,
  availableAt: string | null = null,
) => ({
  account,
  kind,
  validator: null,
  pool: null,
  state,
  quantity,
  rewards: '0.000000',
  availableAt,
});
const exchange = (parts: Record<string, unknown>) => ({
  keyHint: null,
  ipBound: null,
  keyExpiresAt: null,
  reportedAt: null,
  untracked: [],
  historyFrom: '2025-11-01T00:00:00.000Z',
  earnAllowed: null,
  convertAllowed: null,
  hidden: [],
  earn: null,
  ...parts,
});

const expected = [
  summaryOf(0, {
    transactionCount: 2,
    chainBalance: '1.50000000',
    balances: [{ symbol: 'BTC', quantity: '1.50000000' }],
    sync: {
      state: 'complete',
      completedAt: '2026-10-30T00:00:00.000Z',
      status: 'failed',
      lastAttemptAt: '2026-11-01T11:00:00.000Z',
      lastSuccessAt: '2026-10-30T00:00:00.000Z',
      nextRunAt: null,
      errorMessage: 'The source did not answer.',
      off: { reason: 'failures', at: '2026-10-31T00:00:00.000Z' },
    },
  }),
  summaryOf(1, { sync: sync('partial') }),
  summaryOf(2, {
    accountKey: { prefix: 'xpub', derivedAddresses: 20, usedAddresses: 3, alsoTracked: [] },
    sync: sync('partial'),
  }),
  summaryOf(3, {
    accountKey: { prefix: 'zpub', derivedAddresses: 40, usedAddresses: 5, alsoTracked: [] },
    sync: sync('partial'),
  }),
  summaryOf(4, {
    chainBalance: '0.5',
    balances: [
      { symbol: 'BTC', quantity: '0.5' },
      { symbol: 'ETH', quantity: '0' },
      { symbol: 'SOL', quantity: '0' },
      { symbol: 'USDT', quantity: '0' },
      { symbol: 'USDC', quantity: '0' },
      { symbol: 'DOGE', quantity: '12' },
    ],
    exchange: exchange({
      keyHint: 'WXYZ',
      ipBound: true,
      keyExpiresAt: '2027-01-01T00:00:00.000Z',
      reportedAt: '2026-10-30T00:00:00.000Z',
      untracked: [{ symbol: 'usd', quantity: '3' }],
      earnAllowed: true,
      convertAllowed: false,
      hidden: [{ symbol: 'BTC', quantity: '0.000000000000001000' }],
      earn: [{ symbol: 'BTC', quantity: '0.1', product: 'flexible' }],
    }),
    sync: completed,
  }),
  summaryOf(5, { exchange: exchange({ keyHint: 'ABCD', ipBound: false }) }),
  summaryOf(6, {
    chainBalance: '9.000000',
    balances: [
      trx('9.000000'),
      { symbol: 'USDT', quantity: '2.500000' },
      { symbol: 'USDC', quantity: '0.000000' },
    ],
    staking: {
      symbol: 'TRX',
      quantity: '4.000000',
      rewards: '0.120000',
      accounts: [
        position('energy', 'energy', 'active', '3.000000'),
        position(
          'unstaking-1',
          'unstaking',
          'deactivating',
          '1.500000',
          '2026-11-10T00:00:00.000Z',
        ),
      ],
      reportedQuantity: '4.500000',
      unclaimedRewards: '0.007000',
    },
    reportedBalance: '9.500000',
    sync: completed,
  }),
  summaryOf(7, {
    chainBalance: '2.000000',
    balances: [trx('2.000000'), ...zeroTokens],
    staking: {
      symbol: 'TRX',
      quantity: '1.000000',
      rewards: '0.000000',
      accounts: [position('tron', null, null, '1.000000')],
      reportedQuantity: null,
      unclaimedRewards: null,
    },
    sync: completed,
  }),
  summaryOf(8, {
    chainBalance: '2.5000000',
    balances: [{ symbol: 'XLM', quantity: '2.5000000' }],
    reportedBalance: '3.0000000',
    sync: completed,
  }),
  summaryOf(9, {
    chainBalance: '2.5000000',
    balances: [{ symbol: 'XLM', quantity: '2.5000000' }],
    sync: completed,
  }),
  summaryOf(10, {
    chainBalance: '3.000000000',
    balances: [
      { symbol: 'SOL', quantity: '3.000000000' },
      { symbol: 'USDT', quantity: '0.000000' },
      { symbol: 'USDC', quantity: '1.000000' },
    ],
    hiddenTokens: [],
    staking: {
      symbol: 'SOL',
      quantity: '2.000000000',
      rewards: '0.005000000',
      accounts: [
        {
          account: 'StakeOne',
          validator: 'VoteOne',
          pool: null,
          state: 'active',
          quantity: '2.000000000',
          rewards: '0.005000000',
        },
      ],
    },
    pools: [{ symbol: 'SOL', quantity: '0.100000000' }],
    sync: completed,
  }),
  summaryOf(11, { hiddenTokens: null, sync: sync('partial') }),
  summaryOf(12, {
    chainBalance: '1.000000000000000000',
    balances: [{ symbol: 'ETH', quantity: '1.000000000000000000' }, ...zeroTokens],
    hiddenTokens: [],
    sync: completed,
  }),
  summaryOf(13),
  summaryOf(14, {
    chainBalance: '0.00000001',
    balances: [{ symbol: 'BTC', quantity: '0.00000001' }],
    accountKey: {
      prefix: 'ypub',
      derivedAddresses: 10,
      usedAddresses: 1,
      alsoTracked: [
        { id: '20000000-0000-4000-8000-000000000001', address: 'bc1qalso', label: 'Also' },
      ],
    },
    sync: completed,
  }),
  summaryOf(15, {
    accountKey: { prefix: 'xpub', derivedAddresses: 0, usedAddresses: 0, alsoTracked: [] },
  }),
  summaryOf(16, {
    exchange: exchange({
      keyHint: 'EFGH',
      ipBound: true,
      earnAllowed: false,
      convertAllowed: true,
    }),
    sync: sync('partial'),
  }),
  summaryOf(17, { hiddenTokens: null }),
  summaryOf(18, {
    chainBalance: '2.000000000000000000',
    balances: [
      { symbol: 'ETH', quantity: '2.000000000000000000' },
      { symbol: 'USDT', quantity: '7.000000' },
      { symbol: 'USDC', quantity: '0.000000' },
      { symbol: 'SHW', quantity: '15.00', name: 'Synthetic SHW', listed: true },
    ],
    hiddenTokens: [
      { symbol: 'HID', name: 'Synthetic HID', quantity: '4.0', reason: 'owner' },
      { symbol: 'NEG', name: 'Synthetic NEG', quantity: '-10.0', reason: 'negative' },
    ],
    pools: [{ symbol: 'SHW', quantity: '5.00' }],
    sync: completed,
  }),
  summaryOf(19, {
    chainBalance: '1.000000',
    balances: [trx('1.000000'), ...zeroTokens],
    sync: completed,
  }),
];
