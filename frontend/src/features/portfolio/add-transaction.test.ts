import type { Operation } from '@api/operations.api';
import { describe, expect, it } from 'vitest';
import {
  ambiguousComma,
  decimal,
  entryFromOperation,
  numberProblem,
  rateDate,
} from './add-transaction';

describe('NUM-COMMA a comma is a decimal point unless it could be a thousands separator', () => {
  it('reads a comma followed by one, two or four digits as a decimal point', () => {
    expect(decimal('1,5')).toBe('1.5');
    expect(decimal('0,25')).toBe('0.25');
    expect(decimal('1 000,50')).toBe('1000.50');
    expect(decimal('1,2345')).toBe('1.2345');
  });

  it('keeps reading a leading zero before a comma and three digits as a decimal', () => {
    expect(decimal('0,125')).toBe('0.125');
  });

  it('refuses "1,500" instead of saving 1.5', () => {
    for (const text of ['1,500', '12,345', '999,999', ' 1,500 ']) {
      expect(ambiguousComma(text)).toBe(true);
      expect(decimal(text)).toBeNull();
    }
  });

  it('leaves plain numbers and the other separators as they were', () => {
    expect(decimal('1500')).toBe('1500');
    expect(decimal('1.500')).toBe('1.500');
    expect(decimal('1,500.25')).toBeNull();
    expect(decimal('')).toBeNull();
  });

  it('words the refusal for the comma case only', () => {
    expect(numberProblem('1,500', 'Enter an amount greater than 0')).toBe(
      'Write it without a comma between thousands: 1500, or 1.5',
    );
    expect(numberProblem('abc', 'Enter an amount greater than 0')).toBe(
      'Enter an amount greater than 0',
    );
  });
});

describe('RATE-DATE the pre-filled Bank of Russia rate follows the Moscow date', () => {
  const entry = (date: string, time: string) => ({ date, time });
  const now = new Date('2026-10-09T22:30:00.000Z');

  it('moves to the next Moscow day from 21:00 UTC', () => {
    expect(rateDate(entry('2026-10-09', '21:00'), now, true)).toBe('2026-10-10');
    expect(rateDate(entry('2026-10-09', '20:59'), now, true)).toBe('2026-10-09');
  });

  it('keeps the typed date for an entry without a time on an earlier day', () => {
    expect(rateDate(entry('2026-10-01', ''), now)).toBe('2026-10-01');
  });

  it('uses the current minute for a new entry dated today (UTC) without a time', () => {
    expect(rateDate(entry('2026-10-09', ''), now)).toBe('2026-10-10');
  });

  it('keeps the recorded instant of an edited entry', () => {
    expect(rateDate(entry('2026-10-09', ''), now, true)).toBe('2026-10-09');
  });
});

// Characterization of how a recorded operation opens for editing, before it was split up.
describe('OPS-EDIT-ENTRY a recorded operation as the window shows it', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const recorded: Operation = {
    id: `trade:${id(30)}`,
    kind: 'trade',
    type: 'buy',
    direction: 'in',
    occurredAt: '2025-06-13T00:00:00.000Z',
    orderWithinTimestamp: 2,
    asset: { instrumentId: id(1), symbol: 'BTC', name: 'Bitcoin' },
    quantity: '0.01',
    counterAsset: null,
    counterQuantity: null,
    valueUsd: '1000',
    estimatedValueUsd: null,
    costBasisUsd: null,
    feeUsd: '0',
    fee: null,
    paid: null,
    settlement: null,
    comment: 'First buy',
    classification: null,
    account: { id: id(11), name: 'Hardware wallet' },
    counterAccount: null,
    wallet: null,
    counterWallet: null,
    chain: null,
    status: 'recorded',
    source: 'manual',
    version: 1,
    value: '1000',
    estimatedValue: null,
    costBasis: null,
    feeValue: '0',
  };

  it('OPS-EDIT-ENTRY keeps a payment in rubles at the rate the owner typed, and its fee', () => {
    expect(
      entryFromOperation({
        ...recorded,
        direction: 'out',
        type: 'sell',
        occurredAt: '2025-06-13T14:30:15.000Z',
        asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
        comment: null,
        paid: {
          currency: 'RUB',
          gross: '80000',
          fee: '50',
          rateDate: '2025-06-13',
          perUsd: '79.5',
          rateSource: 'owner',
        },
      }),
    ).toEqual({
      side: 'sell',
      instrumentId: '',
      amount: '0.01',
      date: '2025-06-13',
      time: '14:30',
      total: '80000',
      currency: 'RUB',
      rate: '79.5',
      rateEdited: true,
      fee: '50',
      comment: '',
    });
  });

  it('OPS-EDIT-ENTRY leaves the Bank of Russia rate to the date', () => {
    expect(
      entryFromOperation({
        ...recorded,
        paid: {
          currency: 'EUR',
          gross: '900',
          fee: '0',
          rateDate: '2025-06-13',
          perUsd: '0.9',
          rateSource: 'bank-of-russia',
        },
      }),
    ).toMatchObject({ total: '900', currency: 'EUR', rate: '', rateEdited: false, fee: '' });
  });

  it('OPS-EDIT-ENTRY keeps a USDT settlement and a time a second past midnight', () => {
    expect(
      entryFromOperation({
        ...recorded,
        occurredAt: '2025-06-13T00:00:30.000Z',
        valueUsd: null,
        feeUsd: null,
        settlement: {
          asset: { instrumentId: id(4), symbol: 'usdt', name: 'Tether' },
          quantity: '1000',
        },
      }),
    ).toMatchObject({ time: '00:00', total: '', currency: 'USDT', fee: '' });
  });

  it("OPS-EDIT-ENTRY shows a transfer's fee in the coin moved and no fee on a fee", () => {
    const transfer = { ...recorded, kind: 'transfer', type: 'transfer' } as const;
    expect(
      entryFromOperation({
        ...transfer,
        fee: { asset: recorded.asset, quantity: '0.0001' },
      }).fee,
    ).toBe('0.0001');
    expect(entryFromOperation(transfer).fee).toBe('');
    expect(entryFromOperation({ ...recorded, type: 'fee', feeUsd: '5' }).fee).toBe('');
    expect(entryFromOperation({ ...recorded, feeUsd: '1.5' }).fee).toBe('1.5');
  });
});
