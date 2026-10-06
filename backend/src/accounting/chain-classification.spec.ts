import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  type ChainLeg,
  chainCoin,
  classificationPayload,
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
    expect(planOperation(receipt, value, undefined).fields).toMatchObject({
      paid: { currency: 'RUB', gross: '83000', fee: '0', perUsd: '79' },
      settlementCurrency: 'RUB',
    });
    expect(planOperation(receipt, value, undefined).fields).not.toHaveProperty('grossUsd');
  });

  it('a payment moves what left the address, the network fee included', () => {
    expect(legMovement(payment)).toEqual({ inbound: false, quantity: '0.000603' });
    const sale = planOperation(payment, { type: 'sell', currency: 'USD', amount: '50' }, undefined);
    expect(sale.fields).toMatchObject({ side: 'sell', quantity: '0.000603', grossUsd: '50' });
    expect(
      planOperation(payment, { type: 'gift', valueUsd: '40' }, undefined).fields,
    ).toMatchObject({ side: 'sell', purpose: 'gift-sent', grossUsd: '40', feeUsd: '0' });
    expect(planOperation(payment, { type: 'fee', valueUsd: '40' }, undefined).fields).toMatchObject(
      { side: 'sell', purpose: 'fee', grossUsd: '40', feeUsd: '40' },
    );
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

  it('income, gift and rewards carry their value; a reward may have none', () => {
    expect(planOperation(receipt, { type: 'income', valueUsd: '700' }, 'Salary').fields).toEqual({
      occurredAt: receipt.blockTime,
      quantity: '0.00918359',
      side: 'buy',
      grossUsd: '700',
      feeUsd: '0',
      purpose: 'income',
      comment: 'Salary',
    });
    expect(
      planOperation(receipt, { type: 'gift', valueUsd: '700' }, undefined).fields,
    ).toMatchObject({ purpose: 'gift-received' });
    expect(planOperation(receipt, { type: 'airdrop', valueUsd: null }, 'Ignored').fields).toEqual({
      occurredAt: receipt.blockTime,
      quantity: '0.00918359',
      assertReward: true,
      category: 'airdrop',
      acquisitionBasisUsd: null,
      incomeValueUsd: null,
    });
    expect(
      planOperation(receipt, { type: 'staking-reward', valueUsd: '5' }, undefined).fields,
    ).toMatchObject({ category: 'staking', acquisitionBasisUsd: '5', incomeValueUsd: '5' });
  });

  it('a type must fit the direction: nothing is guessed', () => {
    const misfit = (leg: ChainLeg, type: string) =>
      expect(() =>
        planOperation(
          leg,
          parse({ classification: { type, valueUsd: '1' } }).classification!,
          undefined,
        ),
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
    refused(body({ type: 'income', valueUsd: '1', currency: 'USD' }));
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
