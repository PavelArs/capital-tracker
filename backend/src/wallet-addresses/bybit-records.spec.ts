import { chainTxid as chainTxidPattern } from '../accounting/chain-classification';
import type {
  BybitConvert,
  BybitDeposit,
  BybitEarnYield,
  BybitExecution,
  BybitWithdrawal,
} from './bybit-client';
import {
  chainFacts,
  chainTxid,
  completedTradeLeg,
  convertLeg,
  depositLeg,
  earnLeg,
  gapLeg,
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

  it('BYBIT-ANY-COIN: a fill of any coin moves that coin and records its quote side', () => {
    const fee = { execQty: '1000', execFee: '0.1', feeCurrency: 'XRP' };
    expect(tradeLeg(fill({ symbol: 'XRPUSDT', ...fee }))).toMatchObject({
      asset: 'XRP',
      receivedUnits: 1000n * E18 - E18 / 10n,
      direction: 'in',
    });
    expect(tradeLeg(fill({ symbol: 'XRPUSDT', execFee: '0' }))?.raw).toMatchObject({
      quoteAsset: 'USDT',
      quoteUnits: (-650n * E18).toString(),
    });
    // Fiat is money, not a coin of the account.
    expect(tradeLeg(fill({ symbol: 'XRPEUR' }))?.raw).not.toHaveProperty('quoteAsset');
  });

  it('a pair whose base ticker cannot be recorded moves only the quote coin; one of neither is left out', () => {
    const leg = tradeLeg(fill({ symbol: 'SUSDT', execFee: '0.1', feeCurrency: 'S' }));
    expect(leg).toMatchObject({ asset: 'USDT', sentUnits: 650n * E18, direction: 'out' });
    expect(leg?.raw.quoteAsset).toBeUndefined();
    expect(tradeLeg(fill({ symbol: 'SEUR' }))).toBeNull();
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
    expect(depositLeg(deposit({ coin: 'S' }))).toBeNull();
    expect(depositLeg(deposit({ coin: 'EUR' }))).toBeNull();
    // BYBIT-ANY-COIN: any other coin is a record of the account.
    expect(depositLeg(deposit({ coin: 'XRP', chain: 'XRP' }))).toMatchObject({
      asset: 'XRP',
      receivedUnits: E18 / 2n,
    });
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
    expect(earnLeg(paid({ coin: 'S' }), 'FlexibleSaving')).toBeNull();
    expect(earnLeg(paid({ coin: 'MNT' }), 'FlexibleSaving')).toMatchObject({ asset: 'MNT' });
  });
});

describe('BYBIT-CONVERT: a convert as a trade of the account', () => {
  const convert = (overrides: Partial<BybitConvert> = {}): BybitConvert => ({
    id: '10100108106409343501030232064',
    fromCoin: 'BTC',
    fromAmount: '0.01',
    toCoin: 'USDT',
    toAmount: '650.5',
    state: 'done',
    time: Date.UTC(2026, 6, 4, 5, 44, 59),
    raw: { accountType: 'funding' },
    ...overrides,
  });

  it('a convert into USDT sells the coin given, at the quoted price and no fee', () => {
    expect(convertLeg(convert(), 'convert')).toEqual({
      txid: 'bybit-trade-convert-10100108106409343501030232064',
      kind: 'trade',
      asset: 'BTC',
      blockTime: '2026-07-04T05:44:59.000Z',
      receivedUnits: 0n,
      sentUnits: E18 / 100n,
      feeUnits: 0n,
      direction: 'out',
      raw: {
        kind: 'trade',
        trade: {
          side: 'sell',
          base: 'BTC',
          quote: 'USDT',
          price: '65050',
          quantity: '0.01',
          value: '650.5',
          fee: '0',
          feeCoin: '',
        },
        quoteAsset: 'USDT',
        quoteUnits: ((6505n * E18) / 10n).toString(),
        convert: 'convert',
        record: { accountType: 'funding' },
        txid: 'bybit-trade-convert-10100108106409343501030232064',
      },
    });
  });

  it('a convert from USDT buys the coin received; BTC is the quote of a convert with SOL', () => {
    const buy = convertLeg(
      convert({ fromCoin: 'USDT', fromAmount: '100', toCoin: 'SOL', toAmount: '0.6' }),
      'exchange',
    );
    expect(buy).toMatchObject({ asset: 'SOL', direction: 'in', receivedUnits: (6n * E18) / 10n });
    expect(buy?.raw).toMatchObject({
      trade: { side: 'buy', base: 'SOL', quote: 'USDT', price: '166.666666666666666667' },
      quoteUnits: (-100n * E18).toString(),
      convert: 'exchange',
    });
    const swap = convertLeg(convert({ fromCoin: 'SOL', toCoin: 'BTC' }), 'convert');
    expect(swap?.raw).toMatchObject({ trade: { side: 'sell', base: 'SOL', quote: 'BTC' } });
    expect(swap).toMatchObject({ asset: 'SOL', direction: 'out' });
  });

  it('BYBIT-ANY-COIN: a convert of any two coins moves the base and records the quote', () => {
    const sold = convertLeg(convert({ fromCoin: 'XRP', fromAmount: '1000' }), 'convert');
    expect(sold).toMatchObject({ asset: 'XRP', direction: 'out', sentUnits: 1000n * E18 });
    expect(sold?.raw).toMatchObject({
      quoteAsset: 'USDT',
      quoteUnits: ((6505n * E18) / 10n).toString(),
    });
    expect(convertLeg(convert({ fromCoin: 'XRP', toCoin: 'MNT' }), 'convert')).toMatchObject({
      asset: 'XRP',
      raw: { quoteAsset: 'MNT' },
    });
  });

  it('a ticker the app cannot record moves only the other side; neither is left out', () => {
    const sold = convertLeg(convert({ fromCoin: 'S', fromAmount: '1000' }), 'convert');
    expect(sold).toMatchObject({
      asset: 'USDT',
      direction: 'in',
      receivedUnits: (6505n * E18) / 10n,
    });
    expect(sold?.raw).not.toHaveProperty('quoteAsset');
    expect(convertLeg(convert({ fromCoin: 'S', toCoin: 'EUR' }), 'convert')).toBeNull();
  });

  it('leaves out a convert still processing, failed or of nothing', () => {
    expect(convertLeg(convert({ state: 'pending' }), 'convert')).toBeNull();
    expect(convertLeg(convert({ state: 'failed' }), 'convert')).toBeNull();
    expect(convertLeg(convert({ toAmount: '0' }), 'convert')).toBeNull();
    expect(convertLeg(convert({ fromAmount: '0' }), 'convert')).toBeNull();
  });
});

describe('BYBIT-ANY-COIN: a stored trade that moved only its quote coin', () => {
  const stored = (leg: ReturnType<typeof tradeLeg>) => JSON.parse(JSON.stringify(leg?.raw));
  const time = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

  it('becomes the leg of the coin it bought, with the quote side recorded', () => {
    const fee = { symbol: 'XRPUSDT', execQty: '1000', execFee: '0.1', feeCurrency: 'XRP' };
    // What an account stored before any coin was tracked: USDT out, the fill kept in raw.
    const before = {
      kind: 'trade',
      trade: {
        side: 'buy',
        base: 'XRP',
        quote: 'USDT',
        price: '65000',
        quantity: '1000',
        value: '650',
        fee: '0.1',
        feeCoin: 'XRP',
      },
      record: { symbol: 'XRPUSDT' },
      txid: 'bybit-trade-exec-1',
    };
    const leg = completedTradeLeg(before, time);
    expect(leg).toEqual({
      ...tradeLeg(fill({ ...fee, raw: { symbol: 'XRPUSDT' } })),
      raw: {
        kind: 'trade',
        trade: before.trade,
        quoteAsset: 'USDT',
        quoteUnits: (-650n * E18).toString(),
        record: { symbol: 'XRPUSDT' },
        txid: 'bybit-trade-exec-1',
      },
    });
    expect(leg?.blockTime).toBe(time.toISOString());
  });

  it('leaves a full leg, a ticker still not recorded and anything else as it is', () => {
    expect(completedTradeLeg(stored(tradeLeg(fill())), time)).toBeNull();
    const quoteOnly = stored(tradeLeg(fill({ symbol: 'SUSDT' })));
    expect(quoteOnly.trade.base).toBe('S');
    expect(completedTradeLeg(quoteOnly, time)).toBeNull();
    expect(completedTradeLeg({ kind: 'deposit', txid: 'bybit-deposit-1' }, time)).toBeNull();
    expect(completedTradeLeg({ kind: 'trade', txid: 'x', trade: null }, time)).toBeNull();
  });
});

describe('BYBIT-COUNT-GAP: a difference the owner counts as a record', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa';
  const at = new Date('2026-10-09T21:30:00Z');

  it('is a deposit of the coin when Bybit holds more than the records', () => {
    expect(gapLeg({ requestId, coin: 'BTC', direction: 'in', quantity: '0.0384' }, at)).toEqual({
      txid: `bybit-deposit-gap-${requestId}`,
      kind: 'deposit',
      asset: 'BTC',
      blockTime: at.toISOString(),
      receivedUnits: 384n * 10n ** 14n,
      sentUnits: 0n,
      feeUnits: 0n,
      direction: 'in',
      raw: {
        kind: 'deposit',
        internal: false,
        balanceGap: true,
        txid: `bybit-deposit-gap-${requestId}`,
      },
    });
  });

  it('is a withdrawal of the coin when the records hold more, and its txid is accepted', () => {
    const leg = gapLeg({ requestId, coin: 'SOL', direction: 'out', quantity: '0.525' }, at);
    expect([leg.kind, leg.direction, leg.sentUnits, leg.receivedUnits]).toEqual([
      'withdrawal',
      'out',
      525n * 10n ** 15n,
      0n,
    ]);
    expect(chainTxidPattern.test(leg.txid)).toBe(true);
  });
});

describe('BYBIT-CHAIN-FACTS: the chain, address and hash Bybit recorded', () => {
  const record = {
    kind: 'withdrawal',
    chain: 'ARBI',
    toAddress: '0xSyntheticAddress000000000000000000000001',
    txID: `0x${'c'.repeat(64)}`,
  };

  it('names the chain Bybit gives and the network the app opens it on', () => {
    expect(chainFacts(record)).toEqual({
      kind: 'withdrawal',
      chain: 'ARBI',
      network: 'arbitrum',
      address: '0xSyntheticAddress000000000000000000000001',
      fromAddress: null,
      hash: `0x${'c'.repeat(64)}`,
    });
    expect(chainFacts({ ...record, chain: 'ETH' })?.network).toBe('ethereum');
    expect(chainFacts({ ...record, chain: 'XRP' })).toMatchObject({ chain: 'XRP', network: null });
  });

  it('has no hash until a withdrawal is sent, and shows nothing that does not look right', () => {
    expect(chainFacts({ ...record, txID: '' })?.hash).toBeNull();
    expect(chainFacts({ ...record, toAddress: '<script>' })?.address).toBeNull();
    expect(chainFacts({ ...record, chain: '' })).toBeNull();
    expect(chainFacts({ ...record, kind: 'trade' })).toBeNull();
    expect(chainFacts(null)).toBeNull();
  });
});
