import type { BybitDeposit, BybitEarnYield, BybitExecution, BybitWithdrawal } from './bybit-client';
import {
  chainTxid,
  depositLeg,
  earnLeg,
  splitSymbol,
  toUnits,
  tradeLeg,
  UnreadableAmount,
  withdrawalLeg,
} from './bybit-records';

// Synthetic fills, hashes and amounts only (sync-bybit-account, M22).
const E18 = 10n ** 18n;
const fill = (overrides: Partial<BybitExecution> = {}): BybitExecution => ({
  execId: 'exec-1',
  orderId: 'order-1',
  symbol: 'BTCUSDT',
  side: 'Buy',
  execPrice: '65000',
  execQty: '0.01',
  execValue: '650',
  execFee: '0.00001',
  feeCurrency: 'BTC',
  execTime: Date.UTC(2026, 0, 2, 3, 4, 5),
  raw: {},
  ...overrides,
});

describe('Bybit amounts', () => {
  it('keeps every decimal Bybit sends, up to 18', () => {
    expect(toUnits('0.01')).toBe(E18 / 100n);
    expect(toUnits('-0.5')).toBe(-E18 / 2n);
    expect(toUnits('1.000000000000000001')).toBe(E18 + 1n);
    expect(() => toUnits('0.0000000000000000001')).toThrow(UnreadableAmount);
    expect(() => toUnits('1e5')).toThrow(UnreadableAmount);
  });

  it('splits a spot pair into its base and quote coin', () => {
    expect(splitSymbol('BTCUSDT')).toEqual({ base: 'BTC', quote: 'USDT' });
    expect(splitSymbol('SOLUSDC')).toEqual({ base: 'SOL', quote: 'USDC' });
    expect(splitSymbol('ETHBTC')).toEqual({ base: 'ETH', quote: 'BTC' });
    expect(splitSymbol('USDCUSDT')).toEqual({ base: 'USDC', quote: 'USDT' });
    expect(splitSymbol('USDT')).toBeNull();
  });
});

describe('BYBIT-TRADES: a spot fill as a leg of the account', () => {
  it('a buy of 0.01 BTC for 650 USDT with a 0.00001 BTC fee adds 0.00999 BTC and spends 650 USDT', () => {
    const leg = tradeLeg(fill());
    expect(leg).toMatchObject({
      txid: 'bybit-trade-exec-1',
      kind: 'trade',
      asset: 'BTC',
      blockTime: '2026-01-02T03:04:05.000Z',
      receivedUnits: (999n * E18) / 100000n,
      sentUnits: 0n,
      feeUnits: 0n,
      direction: 'in',
    });
    expect(leg?.raw).toMatchObject({
      kind: 'trade',
      txid: 'bybit-trade-exec-1',
      quoteAsset: 'USDT',
      quoteUnits: (-650n * E18).toString(),
      trade: { side: 'buy', base: 'BTC', quote: 'USDT', price: '65000', fee: '0.00001' },
    });
  });

  it('a sale with the fee in the quote coin sends the base coin and receives the rest', () => {
    const leg = tradeLeg(
      fill({
        side: 'Sell',
        execQty: '0.5',
        execValue: '50',
        execFee: '0.05',
        feeCurrency: 'USDT',
        symbol: 'SOLUSDT',
        execPrice: '100',
      }),
    );
    expect(leg).toMatchObject({ asset: 'SOL', sentUnits: E18 / 2n, direction: 'out' });
    expect(leg?.raw.quoteUnits).toBe(((4995n * E18) / 100n).toString());
  });

  it('a pair whose base coin is not tracked moves only the quote coin; one of neither is left out', () => {
    const leg = tradeLeg(fill({ symbol: 'XRPUSDT', execFee: '0.1', feeCurrency: 'XRP' }));
    expect(leg).toMatchObject({ asset: 'USDT', sentUnits: 650n * E18, direction: 'out' });
    expect(leg?.raw.quoteAsset).toBeUndefined();
    expect(tradeLeg(fill({ symbol: 'XRPEUR' }))).toBeNull();
  });
});

describe('BYBIT-DEPOSIT: deposits and withdrawals keep the chain hash', () => {
  const hash = 'A'.repeat(64);
  const deposit = (overrides: Partial<BybitDeposit> = {}): BybitDeposit => ({
    internal: false,
    id: hash,
    coin: 'BTC',
    chain: 'BTC',
    amount: '0.5',
    txID: hash,
    state: 'done',
    time: Date.UTC(2026, 0, 3),
    raw: {},
    ...overrides,
  });

  it('names a chain deposit by its hash as the wallet stores it', () => {
    expect(chainTxid('ETH', `0x${hash}`)).toBe('a'.repeat(64));
    expect(chainTxid('TRX', hash)).toBeNull();
    expect(depositLeg(deposit())).toMatchObject({
      txid: 'a'.repeat(64),
      asset: 'BTC',
      receivedUnits: E18 / 2n,
      direction: 'in',
    });
  });

  it('names a deposit on an untracked chain and an internal one by Bybit', () => {
    expect(depositLeg(deposit({ coin: 'USDT', chain: 'TRX', txID: 'c'.repeat(64) }))?.txid).toMatch(
      /^bybit-deposit-[0-9a-f]{40}$/,
    );
    expect(depositLeg(deposit({ internal: true, id: '9000001', chain: '' }))?.txid).toBe(
      'bybit-deposit-internal-9000001',
    );
  });

  it('leaves out a deposit not yet credited, failed, or of an untracked coin', () => {
    expect(depositLeg(deposit({ state: 'pending', time: null }))).toBeNull();
    expect(depositLeg(deposit({ state: 'failed' }))).toBeNull();
    expect(depositLeg(deposit({ coin: 'XRP' }))).toBeNull();
  });

  it('a withdrawal sends its amount plus the fee, as an own wallet sends amount plus fee', () => {
    const withdrawal: BybitWithdrawal = {
      withdrawId: '7000001',
      txID: hash,
      internal: false,
      coin: 'BTC',
      chain: 'BTC',
      amount: '0.2',
      withdrawFee: '0.0002',
      state: 'done',
      time: Date.UTC(2026, 0, 4),
      raw: {},
    };
    expect(withdrawalLeg(withdrawal)).toMatchObject({
      txid: 'a'.repeat(64),
      sentUnits: (2002n * E18) / 10000n,
      feeUnits: (2n * E18) / 10000n,
      direction: 'out',
    });
    expect(withdrawalLeg({ ...withdrawal, state: 'pending' })).toBeNull();
    expect(withdrawalLeg({ ...withdrawal, internal: true, txID: '' })?.txid).toBe(
      'bybit-withdrawal-7000001',
    );
  });
});

describe('BYBIT-EARN: Earn yield as records', () => {
  const paid = (overrides: Partial<BybitEarnYield> = {}): BybitEarnYield => ({
    id: '1002096',
    coin: 'USDT',
    amount: '0.0608',
    state: 'done',
    time: Date.UTC(2026, 8, 1, 0, 30),
    raw: { productId: '428' },
    ...overrides,
  });

  it('a paid yield adds its coin, named by its product kind and Bybit id', () => {
    expect(earnLeg(paid(), 'FlexibleSaving')).toEqual({
      txid: 'bybit-earn-flexible-1002096',
      kind: 'earn',
      asset: 'USDT',
      blockTime: '2026-09-01T00:30:00.000Z',
      receivedUnits: (608n * E18) / 10000n,
      sentUnits: 0n,
      feeUnits: 0n,
      direction: 'in',
      raw: {
        kind: 'earn',
        product: 'flexible',
        record: { productId: '428' },
        txid: 'bybit-earn-flexible-1002096',
      },
    });
    expect(earnLeg(paid({ coin: 'SOL' }), 'OnChain')?.txid).toBe('bybit-earn-onchain-1002096');
  });

  it('leaves out yield not paid yet, failed, zero, or of an untracked coin', () => {
    expect(earnLeg(paid({ state: 'pending' }), 'FlexibleSaving')).toBeNull();
    expect(earnLeg(paid({ state: 'failed' }), 'FlexibleSaving')).toBeNull();
    expect(earnLeg(paid({ amount: '0' }), 'FlexibleSaving')).toBeNull();
    expect(earnLeg(paid({ coin: 'MNT' }), 'FlexibleSaving')).toBeNull();
  });
});
