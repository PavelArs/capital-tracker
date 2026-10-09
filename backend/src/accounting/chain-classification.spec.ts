import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  type ChainLeg,
  chainCoin,
  chainTxid,
  classificationPayload,
  exchangeTrade,
  fitsDirection,
  legMovement,
  parseClassification,
  planOperation,
} from './chain-classification';

// Synthetic amounts only (classify-chain-transactions, CLS-*).
const requestId = '00000000-0000-4000-8000-000000000001';
const receipt: ChainLeg = {
  network: 'bitcoin',
  asset: null,
  blockTime: '2025-06-20T08:00:00.000Z',
  receivedUnits: '918359',
  sentUnits: '0',
};
const payment: ChainLeg = { ...receipt, receivedUnits: '5700', sentUnits: '66000' };
const parse = (body: Record<string, unknown>) =>
  parseClassification({ requestId, expectedVersion: 0, hidden: false, ...body });

/** The entry a classification produces; every type but an outgoing Other has one. */
const plan = (...args: Parameters<typeof planOperation>) => {
  const planned = planOperation(...args);
  if (planned.journal === 'none') throw new Error('No entry planned');
  return planned;
};

describe('classify-chain-transactions input and plan', () => {
  it('CLS-BUY: a receipt bought for 1000 USDT is a buy of the whole amount settled in USDT', () => {
    const input = parse({
      classification: { type: 'buy', currency: 'USDT', amount: '1000' },
      comment: '  From the exchange ',
    });
    expect(input).toEqual({
      requestId,
      expectedVersion: 0,
      hidden: false,
      classification: { type: 'buy', currency: 'USDT', amount: '1000' },
      comment: 'From the exchange',
    });
    expect(planOperation(receipt, input.classification!, input.comment)).toEqual({
      journal: 'trade',
      fields: {
        occurredAt: '2025-06-20T08:00:00.000Z',
        quantity: '0.00918359',
        side: 'buy',
        grossUsd: '1000',
        feeUsd: '0',
        settlementCurrency: 'USDT',
        comment: 'From the exchange',
      },
    });
  });

  it('CLS-BUY: a purchase paid in rubles keeps the rubles and the rate given', () => {
    const value = parse({
      classification: { type: 'buy', currency: 'RUB', amount: '83000', perUsd: '79' },
    }).classification!;
    expect(plan(receipt, value, undefined).fields).toMatchObject({
      paid: { currency: 'RUB', gross: '83000', fee: '0', perUsd: '79' },
      settlementCurrency: 'RUB',
    });
    expect(plan(receipt, value, undefined).fields).not.toHaveProperty('grossUsd');
  });

  it('a payment moves what left the address, the network fee included', () => {
    expect(legMovement(payment)).toEqual({ inbound: false, quantity: '0.000603' });
    const sale = plan(payment, { type: 'sell', currency: 'USD', amount: '50' }, undefined);
    expect(sale.fields).toMatchObject({ side: 'sell', quantity: '0.000603', grossUsd: '50' });
    expect(plan(payment, { type: 'gift', valueUsd: '40' }, undefined).fields).toMatchObject({
      side: 'sell',
      purpose: 'gift-sent',
      grossUsd: '40',
      feeUsd: '0',
    });
    expect(plan(payment, { type: 'fee', valueUsd: '40' }, undefined).fields).toMatchObject({
      side: 'sell',
      purpose: 'fee',
      grossUsd: '40',
      feeUsd: '40',
    });
  });

  it('ETH-IDENTITY: an Ethereum leg moves its own asset at its own precision (M14)', () => {
    const ethereum = { ...receipt, network: 'ethereum' as const };
    expect(legMovement({ ...ethereum, receivedUnits: '1500000000000000000' })).toEqual({
      inbound: true,
      quantity: '1.5',
    });
    expect(
      legMovement({ ...ethereum, asset: 'USDC', receivedUnits: '0', sentUnits: '250000001' }),
    ).toEqual({ inbound: false, quantity: '250.000001' });
    expect(chainCoin({ network: 'ethereum', asset: 'USDT' })).toEqual({
      assetType: 'crypto',
      symbol: 'USDT',
      name: 'Tether',
    });
    expect(chainCoin(receipt)).toEqual({ assetType: 'crypto', symbol: 'BTC', name: 'Bitcoin' });
    expect(() => legMovement({ ...ethereum, asset: 'DAI' })).toThrow('Unknown chain asset');
  });

  it('SOL-IDENTITY: a Solana leg moves SOL at 9 decimals or an SPL token at 6 (M15)', () => {
    const solana = { ...receipt, network: 'solana' as const };
    expect(legMovement({ ...solana, receivedUnits: '1250000000' })).toEqual({
      inbound: true,
      quantity: '1.25',
    });
    expect(
      legMovement({ ...solana, asset: 'USDC', receivedUnits: '0', sentUnits: '25000000' }),
    ).toEqual({ inbound: false, quantity: '25' });
    expect(chainCoin({ network: 'solana', asset: null })).toEqual({
      assetType: 'crypto',
      symbol: 'SOL',
      name: 'Solana',
    });
  });

  it('income, gift and rewards carry their value; a reward may have none', () => {
    expect(plan(receipt, { type: 'income', valueUsd: '700' }, 'Salary').fields).toEqual({
      occurredAt: receipt.blockTime,
      quantity: '0.00918359',
      side: 'buy',
      grossUsd: '700',
      feeUsd: '0',
      purpose: 'income',
      comment: 'Salary',
    });
    expect(plan(receipt, { type: 'gift', valueUsd: '700' }, undefined).fields).toMatchObject({
      purpose: 'gift-received',
    });
    expect(plan(receipt, { type: 'airdrop', valueUsd: null }, 'Ignored').fields).toEqual({
      occurredAt: receipt.blockTime,
      quantity: '0.00918359',
      assertReward: true,
      category: 'airdrop',
      acquisitionBasisUsd: null,
      incomeValueUsd: null,
    });
    expect(
      plan(receipt, { type: 'staking-reward', valueUsd: '5' }, undefined).fields,
    ).toMatchObject({ category: 'staking', acquisitionBasisUsd: '5', incomeValueUsd: '5' });
  });

  it('FEE-VALUE: a fee may come without a value; the service prices it before the plan', () => {
    expect(parse({ classification: { type: 'fee', valueUsd: null } }).classification).toEqual({
      type: 'fee',
      valueUsd: null,
    });
    expect(parse({ classification: { type: 'fee', valueUsd: '12.5' } }).classification).toEqual({
      type: 'fee',
      valueUsd: '12.5',
    });
    expect(plan(payment, { type: 'fee', valueUsd: '12.5' }, undefined).fields).toEqual({
      occurredAt: payment.blockTime,
      quantity: '0.000603',
      side: 'sell',
      grossUsd: '12.5',
      feeUsd: '12.5',
      purpose: 'fee',
    });
    expect(() => planOperation(payment, { type: 'fee', valueUsd: null }, undefined)).toThrow(
      'A fee without a value takes its stored price',
    );
  });

  it('CLS-OTHER: a receipt nobody can name counts without a purchase price and no deposit', () => {
    const input = parse({ classification: { type: 'other' }, comment: 'Found on an old card' });
    expect(input.classification).toEqual({ type: 'other' });
    expect(planOperation(receipt, input.classification!, input.comment)).toEqual({
      journal: 'reward',
      fields: {
        occurredAt: receipt.blockTime,
        quantity: '0.00918359',
        assertReward: true,
        category: 'unclassified',
        acquisitionBasisUsd: null,
        incomeValueUsd: null,
      },
    });
    // What left without a name produces no entry: it leaves as an unanswered payment does.
    expect(planOperation(payment, { type: 'other' }, undefined)).toEqual({ journal: 'none' });
  });

  it('a type must fit the direction: nothing is guessed', () => {
    const misfit = (leg: ChainLeg, type: string) =>
      expect(() =>
        plan(leg, parse({ classification: { type, valueUsd: '1' } }).classification!, undefined),
      ).toThrow(UnprocessableEntityException);
    misfit(receipt, 'expense');
    misfit(receipt, 'fee');
    misfit(payment, 'income');
    misfit(payment, 'reward');
    expect(() =>
      planOperation(payment, { type: 'buy', currency: 'USD', amount: '1' }, undefined),
    ).toThrow(UnprocessableEntityException);
    const nothing = { ...receipt, receivedUnits: '0' };
    expect(() => planOperation(nothing, { type: 'income', valueUsd: '1' }, undefined)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('XFER-MANUAL: a transfer names the other account and fits either direction', () => {
    const accountId = '00000000-0000-4000-8000-000000000010';
    const value = parse({ classification: { type: 'transfer', accountId } }).classification!;
    expect(value).toEqual({ type: 'transfer', accountId });
    expect(fitsDirection(receipt, 'transfer')).toBe(true);
    expect(fitsDirection(payment, 'transfer')).toBe(true);
    expect(fitsDirection(receipt, 'sell')).toBe(false);
    expect(() => planOperation(receipt, value, undefined)).toThrow(
      'A transfer records an owned transfer instead',
    );
    const refused = (classification: unknown) =>
      expect(() => parse({ classification })).toThrow(BadRequestException);
    refused({ type: 'transfer', accountId: 'bybit' });
    refused({ type: 'transfer', accountId, valueUsd: '1' });
  });

  it('POOL-*: a pool deposit records nothing, a pool reward is income, a withdrawal names its deposit', () => {
    const deposit = parse({ classification: { type: 'pool-deposit' } }).classification!;
    expect(deposit).toEqual({ type: 'pool-deposit' });
    expect(planOperation(payment, deposit, 'Uniswap')).toEqual({ journal: 'none' });
    expect(fitsDirection(receipt, 'pool-deposit')).toBe(false);
    expect(plan(receipt, { type: 'pool-reward', valueUsd: '25' }, undefined).fields).toMatchObject({
      category: 'other',
      acquisitionBasisUsd: '25',
      incomeValueUsd: '25',
    });
    expect(fitsDirection(payment, 'pool-reward')).toBe(false);
    const addressId = '00000000-0000-4000-8000-000000000010';
    const txid = 'd'.repeat(64);
    const withdrawal = parse({
      classification: { type: 'pool-withdrawal', deposit: { addressId, txid }, valueUsd: null },
    }).classification!;
    expect(withdrawal).toEqual({
      type: 'pool-withdrawal',
      deposit: { addressId, txid },
      valueUsd: null,
    });
    expect(fitsDirection(receipt, 'pool-withdrawal')).toBe(true);
    expect(fitsDirection(payment, 'pool-withdrawal')).toBe(false);
    expect(() => planOperation(receipt, withdrawal, undefined)).toThrow(
      'A pool withdrawal records the gain over its deposit instead',
    );
    // POOL-INVALID: an exchange account's records are no pool moves of the owner's.
    const exchange: ChainLeg = { ...payment, network: 'bybit', asset: 'USDC' };
    expect(fitsDirection(exchange, 'pool-deposit')).toBe(false);
    expect(fitsDirection({ ...exchange, sentUnits: '0' }, 'pool-withdrawal')).toBe(false);
    const refused = (classification: unknown) =>
      expect(() => parse({ classification })).toThrow(BadRequestException);
    refused({ type: 'pool-deposit', valueUsd: '1' });
    refused({ type: 'pool-withdrawal', deposit: { addressId }, valueUsd: null });
    refused({ type: 'pool-withdrawal', deposit: { addressId, txid: 'x' }, valueUsd: null });
    refused({ type: 'pool-withdrawal', deposit: { addressId, txid }, valueUsd: '0' });
  });

  it('CLS-RECORDED: a movement added by hand names its trade or swap and records nothing', () => {
    const id = '00000000-0000-4000-8000-0000000000AB';
    const recorded = parse({
      classification: { type: 'recorded', operation: { kind: 'trade', id } },
    }).classification!;
    expect(recorded).toEqual({
      type: 'recorded',
      operation: { kind: 'trade', id: id.toLowerCase() },
    });
    expect(planOperation(payment, recorded, undefined)).toEqual({ journal: 'none' });
    expect(planOperation(receipt, recorded, undefined)).toEqual({ journal: 'none' });
    expect(fitsDirection({ ...payment, network: 'bybit', asset: 'USDT' }, 'recorded')).toBe(true);
    const refused = (classification: unknown) =>
      expect(() => parse({ classification })).toThrow(BadRequestException);
    refused({ type: 'recorded' });
    refused({ type: 'recorded', operation: { kind: 'reward', id } });
    refused({ type: 'recorded', operation: { kind: 'trade', id: 'x' } });
    refused({ type: 'recorded', operation: { kind: 'swap', id }, valueUsd: '1' });
  });

  it('CLS-HIDE: hiding or resetting needs no type; the answer is kept while hidden', () => {
    expect(parse({ hidden: true, classification: null })).toMatchObject({
      hidden: true,
      classification: null,
    });
    expect(
      parse({ hidden: true, classification: { type: 'income', valueUsd: '1' } }).classification,
    ).toEqual({ type: 'income', valueUsd: '1' });
  });

  it('refuses malformed requests', () => {
    const refused = (body: unknown) =>
      expect(() => parseClassification(body)).toThrow(BadRequestException);
    refused(null);
    refused([]);
    refused({ requestId, expectedVersion: 0, hidden: false });
    refused({ requestId, expectedVersion: -1, hidden: false, classification: null });
    refused({ requestId, expectedVersion: 0, hidden: 'no', classification: null });
    refused({ requestId: 'x', expectedVersion: 0, hidden: false, classification: null });
    refused({ requestId, expectedVersion: 0, hidden: false, classification: null, extra: 1 });
    const body = (classification: unknown) => ({
      requestId,
      expectedVersion: 0,
      hidden: false,
      classification,
    });
    refused(body({ type: 'transfer' }));
    refused(body({ type: 'buy', currency: 'GBP', amount: '1' }));
    refused(body({ type: 'buy', currency: 'USD', amount: '0' }));
    refused(body({ type: 'buy', currency: 'USD', amount: '1', perUsd: '1' }));
    refused(body({ type: 'income', valueUsd: '0' }));
    refused(body({ type: 'income', valueUsd: null }));
    refused(body({ type: 'fee', valueUsd: '0' }));
    refused(body({ type: 'fee' }));
    refused(body({ type: 'income', valueUsd: '1', currency: 'USD' }));
    refused(body({ type: 'other', valueUsd: '1' }));
    refused({ ...body(null), comment: 'x'.repeat(501) });
  });

  it('the stored payload names the transaction and the whole answer', () => {
    const input = parse({ classification: { type: 'income', valueUsd: '700' } });
    expect(JSON.parse(classificationPayload('a', 'b', input))).toEqual({
      addressId: 'a',
      txid: 'b',
      expectedVersion: 0,
      hidden: false,
      classification: { type: 'income', valueUsd: '700' },
    });
  });
});

describe('BYBIT-TRADES: a Bybit spot fill as a Buy or Sell (M22)', () => {
  const trade = (overrides: Record<string, string> = {}) => ({
    kind: 'trade',
    trade: {
      side: 'buy',
      base: 'BTC',
      quote: 'USDT',
      price: '65000',
      quantity: '0.01',
      value: '650',
      fee: '0.00001',
      feeCoin: 'BTC',
      ...overrides,
    },
  });

  it('0.01 BTC for 650 USDT with a 0.00001 BTC fee: 649.35 USDT for 0.00999 BTC plus a 0.65 USDT fee', () => {
    expect(exchangeTrade(trade())).toEqual({
      type: 'buy',
      currency: 'USDT',
      amount: '649.35',
      fee: '0.65',
    });
    const leg: ChainLeg = {
      network: 'bybit',
      asset: 'BTC',
      blockTime: '2026-01-02T03:04:05.000Z',
      receivedUnits: '9990000000000000',
      sentUnits: '0',
    };
    const value = exchangeTrade(trade());
    if (!value) throw new Error('No trade');
    expect(plan(leg, value, undefined)).toMatchObject({
      journal: 'trade',
      fields: {
        side: 'buy',
        quantity: '0.00999',
        grossUsd: '649.35',
        feeUsd: '0.65',
        settlementCurrency: 'USDT',
      },
    });
  });

  it('a fee in the quote coin is the fee as charged; a sale keeps its value less the fee', () => {
    expect(exchangeTrade(trade({ fee: '0.65', feeCoin: 'USDT' }))).toMatchObject({
      amount: '650',
      fee: '0.65',
    });
    expect(exchangeTrade(trade({ side: 'sell', fee: '0.65', feeCoin: 'USDT' }))).toMatchObject({
      type: 'sell',
      amount: '650',
      fee: '0.65',
    });
    // A sale charged in the base coin sold the fee too: 0.01001 BTC for 650.65 less 0.65.
    expect(exchangeTrade(trade({ side: 'sell' }))).toMatchObject({ amount: '650.65', fee: '0.65' });
  });

  it('anything less plain stays to classify', () => {
    expect(exchangeTrade(trade({ quote: 'BTC', base: 'ETH' }))).toBeNull();
    expect(exchangeTrade(trade({ feeCoin: 'MNT' }))).toBeNull();
    expect(exchangeTrade(trade({ fee: '-0.01', feeCoin: 'USDT' }))).toBeNull();
    expect(exchangeTrade({ kind: 'deposit' })).toBeNull();
    expect(exchangeTrade(null)).toBeNull();
  });
});

describe('Bybit record ids (M22, BYBIT-EARN)', () => {
  it('names trades, deposits, withdrawals and paid Earn yield', () => {
    for (const txid of [
      'bybit-trade-2100000000000000001',
      'bybit-deposit-internal-9000001',
      'bybit-withdrawal-7000001',
      'bybit-earn-flexible-1002096',
      'bybit-earn-onchain-1002097',
    ])
      expect(chainTxid.test(txid)).toBe(true);
    expect(chainTxid.test('bybit-earn-fixed-1')).toBe(false);
    expect(chainTxid.test('bybit-loan-1')).toBe(false);
  });
});
