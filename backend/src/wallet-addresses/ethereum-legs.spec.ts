import { ethereumLegs, ethereumTokenFacts, rangeEnd } from './ethereum-legs';
import type { InternalTransfer, NormalTransaction, TokenTransfer } from './etherscan-client';
import { ETHERSCAN_PAGE_SIZE } from './etherscan-client';

// Synthetic addresses, hashes and amounts only (track-ethereum-wallets).
const owned = `0x${'a1'.repeat(20)}`;
const other = `0x${'b2'.repeat(20)}`;
const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const unknownToken = `0x${'c3'.repeat(20)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const ether = (value: string) => BigInt(value) * 10n ** 18n;
const at = 1_720_000_000;

const tx = (overrides: Partial<NormalTransaction>): NormalTransaction => ({
  hash: hash('1'),
  blockNumber: 20_000_001,
  timeStamp: at,
  blockHash: hash('b'),
  from: other,
  to: owned,
  value: 0n,
  fee: 0n,
  failed: false,
  raw: { synthetic: true },
  ...overrides,
});
const token = (overrides: Partial<TokenTransfer>): TokenTransfer => ({
  hash: hash('1'),
  blockNumber: 20_000_001,
  timeStamp: at,
  blockHash: hash('b'),
  logIndex: 5,
  contract: usdc,
  from: other,
  to: owned,
  value: 1_000_000n,
  raw: { synthetic: true },
  ...overrides,
});
const inner = (overrides: Partial<InternalTransfer>): InternalTransfer => ({
  hash: hash('4'),
  blockNumber: 20_000_004,
  timeStamp: at + 48,
  from: other,
  to: owned,
  value: ether('2'),
  failed: false,
  raw: { synthetic: true },
  ...overrides,
});
const pick = (legs: ReturnType<typeof ethereumLegs>) =>
  legs.map(({ txid, asset, receivedUnits, sentUnits, feeUnits, direction }) => ({
    txid,
    asset,
    received: receivedUnits,
    sent: sentUnits,
    fee: feeUnits,
    direction,
  }));

describe('ETH-IDENTITY: legs of an Ethereum address', () => {
  it('splits one hash that moves ETH and USDC into two legs', () => {
    const legs = ethereumLegs(
      owned,
      [tx({ value: ether('1') })],
      [],
      [token({ value: 250_000_000n, logIndex: 7 })],
    );
    expect(pick(legs)).toEqual([
      {
        txid: '1'.repeat(64),
        asset: null,
        received: ether('1'),
        sent: 0n,
        fee: 0n,
        direction: 'in',
      },
      {
        txid: `${'1'.repeat(64)}-7`,
        asset: 'USDC',
        received: 250_000_000n,
        sent: 0n,
        fee: 0n,
        direction: 'in',
      },
    ]);
    expect(legs[0]).toMatchObject({
      blockHeight: 20_000_001,
      blockHash: 'b'.repeat(64),
      blockTime: '2024-07-03T09:46:40.000Z',
    });
    expect(legs[0].raw).toEqual({
      txid: '1'.repeat(64),
      hash: hash('1'),
      transaction: { synthetic: true },
      internal: [],
    });
    expect(legs[1].raw).toEqual({
      txid: `${'1'.repeat(64)}-7`,
      hash: hash('1'),
      transfer: { synthetic: true },
    });
  });

  it('charges the sender the fee in ether; a token send leaves a fee-only ether leg', () => {
    const fee = 420_000_000_000_000n;
    const legs = ethereumLegs(
      owned,
      [
        tx({ hash: hash('2'), from: owned, to: other, value: ether('1'), fee }),
        tx({ hash: hash('3'), from: owned, to: usdt, value: 0n, fee }),
      ],
      [],
      [token({ hash: hash('3'), contract: usdt, from: owned, to: other, value: 5_000_000n })],
    );
    expect(pick(legs)).toEqual([
      {
        txid: '2'.repeat(64),
        asset: null,
        received: 0n,
        sent: ether('1') + fee,
        fee,
        direction: 'out',
      },
      { txid: '3'.repeat(64), asset: null, received: 0n, sent: fee, fee, direction: 'out' },
      {
        txid: `${'3'.repeat(64)}-5`,
        asset: 'USDT',
        received: 0n,
        sent: 5_000_000n,
        fee: 0n,
        direction: 'out',
      },
    ]);
  });

  it('keeps only the fee of a reverted transaction and nothing of one someone else sent', () => {
    const fee = 100n;
    const legs = ethereumLegs(
      owned,
      [
        tx({ hash: hash('5'), from: owned, to: other, value: ether('1'), fee, failed: true }),
        tx({ hash: hash('6'), from: other, to: owned, value: ether('1'), fee, failed: true }),
        tx({ hash: hash('7'), from: other, to: owned, value: 0n, fee }),
      ],
      [],
      [],
    );
    expect(pick(legs)).toEqual([
      { txid: '5'.repeat(64), asset: null, received: 0n, sent: fee, fee, direction: 'out' },
    ]);
  });

  it('adds ether a contract moved inside a transaction to the same leg', () => {
    const fee = 300n;
    const legs = ethereumLegs(
      owned,
      [tx({ hash: hash('4'), blockNumber: 20_000_004, from: owned, to: other, value: 0n, fee })],
      [inner({}), inner({ value: ether('9'), failed: true })],
      [],
    );
    expect(pick(legs)).toEqual([
      {
        txid: '4'.repeat(64),
        asset: null,
        received: ether('2'),
        sent: fee,
        fee,
        direction: 'in',
      },
    ]);
  });

  it('stores an internal receipt alone without a block hash', () => {
    const [leg] = ethereumLegs(owned, [], [inner({})], []);
    expect(leg).toMatchObject({ txid: '4'.repeat(64), blockHash: null, direction: 'in' });
    expect(leg.raw).toEqual({
      txid: '4'.repeat(64),
      hash: hash('4'),
      transaction: null,
      internal: [{ synthetic: true }],
    });
  });

  it('marks a send to itself as a self transfer that costs only the fee', () => {
    const [leg] = ethereumLegs(
      owned,
      [tx({ from: owned, to: owned, value: ether('1'), fee: 50n })],
      [],
      [],
    );
    expect(leg).toMatchObject({
      receivedUnits: ether('1'),
      sentUnits: ether('1') + 50n,
      direction: 'self',
    });
  });

  it('ignores zero-value transfers and transfers of other addresses', () => {
    expect(
      ethereumLegs(
        owned,
        [],
        [],
        [
          token({ from: owned, to: other, value: 0n, logIndex: 1 }),
          token({ contract: unknownToken, from: owned, to: other, value: 0n, logIndex: 2 }),
          token({ from: other, to: `0x${'d4'.repeat(20)}`, logIndex: 3 }),
        ],
      ),
    ).toEqual([]);
  });

  it('TOKEN-ANY reads any other token, named by its contract', () => {
    const legs = ethereumLegs(
      owned,
      [],
      [],
      [token({ contract: unknownToken, value: 42n * 10n ** 18n, logIndex: 2 })],
    );
    expect(pick(legs)).toEqual([
      {
        txid: `${'1'.repeat(64)}-2`,
        asset: unknownToken,
        received: 42n * 10n ** 18n,
        sent: 0n,
        fee: 0n,
        direction: 'in',
      },
    ]);
  });

  it('TOKEN-ANY takes each other token’s symbol, name and decimals from its first transfer', () => {
    const other18 = `0x${'e5'.repeat(20)}`;
    const broken = `0x${'f6'.repeat(20)}`;
    expect(
      ethereumTokenFacts([
        token({ raw: { tokenSymbol: 'USDC', tokenName: 'USD Coin', tokenDecimal: '6' } }),
        token({
          contract: unknownToken,
          raw: { tokenSymbol: 'SYN', tokenName: 'Synthetic Token', tokenDecimal: '18' },
        }),
        token({
          contract: unknownToken,
          raw: { tokenSymbol: 'LATER', tokenName: 'Renamed', tokenDecimal: '9' },
        }),
        token({ contract: other18, raw: { tokenDecimal: '0' } }),
        token({ contract: broken, raw: { tokenSymbol: 'BAD', tokenDecimal: '' } }),
      ]),
    ).toEqual([
      {
        network: 'ethereum',
        contract: unknownToken,
        symbol: 'SYN',
        name: 'Synthetic Token',
        decimals: 18,
      },
      { network: 'ethereum', contract: other18, symbol: null, name: null, decimals: 0 },
      { network: 'ethereum', contract: broken, symbol: 'BAD', name: null, decimals: Number.NaN },
    ]);
  });

  it('numbers the transfers of a hash the same way on both sides without an event index', () => {
    const first = token({ logIndex: null, from: other, to: owned, value: 3_000_000n });
    const second = token({ logIndex: null, contract: usdt, from: other, to: owned, value: 1n });
    const receiver = ethereumLegs(owned, [], [], [second, first]).map((leg) => leg.txid);
    expect(receiver).toEqual([`${'1'.repeat(64)}-0`, `${'1'.repeat(64)}-1`]);
    expect(ethereumLegs(owned, [], [], [first, second]).map((leg) => leg.txid)).toEqual(receiver);
    // The sender sees the same single transfer as the first and only one.
    const sender = ethereumLegs(other, [], [], [token({ logIndex: null, from: other, to: owned })]);
    expect(sender.map((leg) => leg.txid)).toEqual([`${'1'.repeat(64)}-0`]);
  });

  it('stores each event once when the provider repeats it', () => {
    const repeated = token({ from: owned, to: owned, logIndex: 9 });
    const legs = ethereumLegs(owned, [], [], [repeated, repeated]);
    expect(pick(legs)).toEqual([
      {
        txid: `${'1'.repeat(64)}-9`,
        asset: 'USDC',
        received: 1_000_000n,
        sent: 1_000_000n,
        fee: 0n,
        direction: 'self',
      },
    ]);
  });
});

describe('ETH-SYNC: the part of a block range read in full', () => {
  const page = (lastBlock: number) =>
    Array.from({ length: ETHERSCAN_PAGE_SIZE }, (_value, index) => ({
      blockNumber: lastBlock - (index === ETHERSCAN_PAGE_SIZE - 1 ? 0 : 1),
    }));

  it('takes the whole range when no list filled its page', () => {
    expect(rangeEnd(100, 200, [[{ blockNumber: 150 }], [], []])).toBe(200);
  });

  it('stops before the last block of a full page', () => {
    expect(rangeEnd(100, 200, [page(180), [{ blockNumber: 190 }], page(170)])).toBe(169);
  });

  it('cannot split a single block that fills a page', () => {
    expect(rangeEnd(100, 200, [page(100)])).toBeNull();
  });
});
