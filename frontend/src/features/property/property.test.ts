import { describe, expect, it } from 'vitest';
import {
  type PropertyEntry,
  propertyAsset,
  propertyName,
  propertyProblems,
  purchaseTrade,
  shareOf,
  shareQuantity,
} from './property';

// Synthetic amounts only.
const entry = (changes: Partial<PropertyEntry> = {}): PropertyEntry => ({
  kind: 'Apartment',
  name: '',
  currency: 'RUB',
  cost: '8500000',
  bought: '2025-09-01',
  estimate: '',
  share: '100',
  ...changes,
});
const today = '2026-10-12';
const identity = { requestId: '00000000-0000-4000-8000-000000000001', expectedJournalRevision: 0 };

describe('PROPERTY-ADD property entry', () => {
  it('names the property after its kind unless a name is given', () => {
    expect(propertyName(entry())).toBe('Apartment');
    expect(propertyName(entry({ kind: 'Parking', name: '  Garage  ' }))).toBe('Garage');
    expect(propertyAsset(entry({ currency: 'EUR' }))).toEqual({
      name: 'Apartment',
      assetType: 'manual',
      valuationCurrency: 'EUR',
    });
  });

  it('needs a price, a past date and a share from 0.01 to 100%', () => {
    expect([...propertyProblems(entry(), today)]).toEqual([]);
    expect([...propertyProblems(entry({ cost: '', share: '0' }), today)]).toEqual([
      'cost',
      'share',
    ]);
    expect([...propertyProblems(entry({ bought: '2026-10-13' }), today)]).toEqual(['bought']);
    expect([...propertyProblems(entry({ bought: today, share: '33.33' }), today)]).toEqual([]);
    expect([...propertyProblems(entry({ share: '100.01' }), today)]).toEqual(['share']);
    expect([...propertyProblems(entry({ share: '12.345' }), today)]).toEqual(['share']);
    expect([...propertyProblems(entry({ estimate: 'soon' }), today)]).toEqual(['estimate']);
    expect([...propertyProblems(entry({ name: 'x'.repeat(121) }), today)]).toEqual(['name']);
  });

  it('turns the share into a fraction and takes that part of the price exactly', () => {
    expect(shareQuantity('100')).toBe('1');
    expect(shareQuantity('50')).toBe('0.5');
    expect(shareQuantity('33.33')).toBe('0.3333');
    expect(shareOf('8500000', '100')).toBe('8500000');
    expect(shareOf('8500000', '50')).toBe('4250000');
    expect(shareOf('8500000.5', '33.33')).toBe('2833050.16665');
  });

  it('records a past purchase on its day as money put in, at the Bank of Russia rate', () => {
    const trade = purchaseTrade(
      entry({ share: '50' }),
      'instrument',
      new Date('2026-10-12T15:42:31Z'),
      identity,
    );
    expect(trade).toEqual({
      instrumentId: 'instrument',
      side: 'buy',
      occurredAt: '2025-09-01T00:00:00.000Z',
      quantity: '0.5',
      paid: { currency: 'RUB', gross: '4250000', fee: '0' },
      ...identity,
    });
    expect(trade).not.toHaveProperty('settlementCurrency');
  });

  it('records a purchase made today at the current minute, never in the future', () => {
    const trade = purchaseTrade(
      entry({ currency: 'USD', cost: '92000', bought: today }),
      'instrument',
      new Date('2026-10-12T15:42:31Z'),
      identity,
    );
    expect(trade).toMatchObject({
      occurredAt: '2026-10-12T15:42:00.000Z',
      quantity: '1',
      grossUsd: '92000',
      feeUsd: '0',
    });
  });

  it('classes-02 takes today as the Moscow day, from 21:00 UTC and across a month end', () => {
    const at = (instant: string, bought: string) =>
      purchaseTrade(entry({ bought }), 'instrument', new Date(instant), identity).occurredAt;
    // 22:30 UTC on Oct 15 is 01:30 on Oct 16 in Moscow: a purchase today is the current minute.
    expect(at('2026-10-15T22:30:10Z', '2026-10-16')).toBe('2026-10-15T22:30:00.000Z');
    expect(at('2026-10-15T22:30:10Z', '2026-10-15')).toBe('2026-10-15T00:00:00.000Z');
    expect(at('2026-10-31T20:59:59Z', '2026-10-31')).toBe('2026-10-31T20:59:00.000Z');
    expect(at('2026-10-31T21:00:00Z', '2026-11-01')).toBe('2026-10-31T21:00:00.000Z');
    expect(at('2026-10-31T23:59:59Z', '2026-10-31')).toBe('2026-10-31T00:00:00.000Z');
  });
});
