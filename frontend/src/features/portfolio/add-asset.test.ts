import { describe, expect, it } from 'vitest';
import { purchasesByPoint } from './AssetChart';
import { type AssetEntry, assetBody, assetProblems, balanceInstant, unitPrice } from './add-asset';

const entry: AssetEntry = {
  kind: 'deposit',
  name: 'Deposit',
  ticker: '',
  amount: '150000',
  value: '',
  currency: 'RUB',
  accountId: 'account',
  notes: '',
};

describe('ADD-ASSET-BALANCE the Add asset window rules', () => {
  it('stores each kind with its type, ticker and currency', () => {
    expect(assetBody(entry)).toEqual({
      name: 'Deposit',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
    expect(assetBody({ ...entry, kind: 'other', ticker: ' gold ' })).toEqual({
      name: 'Deposit',
      assetType: 'manual',
      symbol: 'GOLD',
      valuationCurrency: 'RUB',
    });
    expect(assetBody({ ...entry, kind: 'cash', ticker: 'ignored' })).toEqual({
      name: 'Deposit',
      assetType: 'fiat',
      symbol: 'RUB',
    });
    expect(assetBody({ ...entry, kind: 'crypto', ticker: 'btc' })).toEqual({
      name: 'Deposit',
      assetType: 'crypto',
      symbol: 'BTC',
    });
  });

  it('needs an amount and an account except for a coin added without a balance', () => {
    expect([...assetProblems(entry, 1)]).toEqual([]);
    expect([...assetProblems({ ...entry, amount: '' }, 1)]).toEqual(['amount']);
    expect([...assetProblems({ ...entry, value: 'ten' }, 1)]).toEqual(['value']);
    expect([...assetProblems({ ...entry, accountId: '' }, 1)]).toEqual(['account']);
    expect([...assetProblems(entry, 0)]).toEqual(['no-accounts']);
    const coin = { ...entry, kind: 'crypto' as const, ticker: 'TON', amount: '' };
    expect([...assetProblems(coin, 0)]).toEqual([]);
    expect([...assetProblems({ ...coin, amount: '2' }, 1)]).toEqual(['value']);
    expect([...assetProblems({ ...coin, ticker: ' ', name: '' }, 1)]).toEqual(['name', 'ticker']);
    expect([...assetProblems({ ...entry, notes: 'x'.repeat(501) }, 1)]).toEqual(['notes']);
  });

  it('divides exactly and records the balance at a whole minute', () => {
    expect(unitPrice('1500', '150000')).toBe('0.01');
    expect(unitPrice('100', '3')).toBe('33.333333333333333333');
    expect(unitPrice('2', '3')).toBe('0.666666666666666667');
    expect(unitPrice('0.5', '0.25')).toBe('2');
    expect(balanceInstant(new Date('2026-10-05T10:15:42.123Z'))).toBe('2026-10-05T10:15:00.000Z');
  });
});

describe('ASSET-CHART purchases on the chart', () => {
  const point = (at: string) => ({
    at,
    quantity: '1',
    value: '1',
    complete: true,
    cost: '1',
    costComplete: true,
  });
  it('puts each purchase on the first point at or after it, never before the period', () => {
    const points = [
      point('2026-09-01T00:00:00.000Z'),
      point('2026-09-02T00:00:00.000Z'),
      point('2026-09-03T00:00:00.000Z'),
    ];
    const byPoint = purchasesByPoint(points, [
      { at: '2026-08-31T10:00:00.000Z', quantity: '1' },
      { at: '2026-09-01T00:00:00.000Z', quantity: '2' },
      { at: '2026-09-01T10:00:00.000Z', quantity: '3' },
      { at: '2026-09-02T00:00:00.000Z', quantity: '4' },
      { at: '2026-09-04T00:00:00.000Z', quantity: '5' },
    ]);
    expect(
      [...byPoint.entries()].map(([index, list]) => [index, list.map((p) => p.quantity)]),
    ).toEqual([
      [0, ['2']],
      [1, ['3', '4']],
    ]);
  });
});
