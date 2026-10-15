import type { AssetLots, AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { describe, expect, it } from 'vitest';
import { estimateOverdue, firstBought, propertiesOf, propertyTotal } from './real-estate';

// Synthetic names, ids and amounts only.
const house = '00000000-0000-4000-8000-000000000011';
const safe = '00000000-0000-4000-8000-000000000012';
const asset = (holdings: AssetValuation['holdings']) =>
  ({
    instrumentId: '00000000-0000-4000-8000-000000000001',
    name: 'Garage',
    value: null,
    costBasis: null,
    unrealizedPnl: null,
    unrealizedReturnPercent: null,
    holdings,
  }) as unknown as AssetValuation;
const portfolio = (assets: AssetValuation[]) => ({ assets }) as unknown as PortfolioValuation;
const classes = { [house]: 'property', [safe]: null } as const;
const holding = (accountId: string, value: string | null) => ({
  accountId,
  accountName: 'Synthetic',
  quantity: '0.5',
  value,
});

describe('PROPERTY-LIST real estate figures', () => {
  it('classes-03 sums the part held in property accounts exactly; only the display rounds', () => {
    const value = (values: (string | null)[]) =>
      propertiesOf(
        portfolio([asset([...values.map((item) => holding(house, item)), holding(safe, '7')])]),
        classes,
      )[0].value;
    expect(value(['10.125'])).toBe('10.125');
    expect(value(['9007199254740993', '1'])).toBe('9007199254740994');
    expect(value(['0.1', '0.2'])).toBe('0.3');
    expect(value(['0.1', null])).toBeNull();
  });

  it('classes-03 totals the properties exactly and leaves out those without an estimate', () => {
    const shares = (values: (string | null)[]) =>
      values.map((value) => ({ value })) as Parameters<typeof propertyTotal>[0];
    expect(propertyTotal(shares(['0.1', '0.2']))).toBe('0.3');
    expect(propertyTotal(shares(['9007199254740993', '1', null]))).toBe('9007199254740994');
    expect(propertyTotal(shares([]))).toBe('0');
  });

  it('classes-17 counts the age of an estimate in Moscow days, across a month end', () => {
    // Aug 1, 00:30 in Moscow.
    const set = '2026-07-31T21:30:00.000Z';
    expect(estimateOverdue(set, new Date('2026-09-30T20:59:59Z'))).toBe(false);
    expect(estimateOverdue(set, new Date('2026-09-30T21:00:00Z'))).toBe(true);
    expect(estimateOverdue('2026-08-01T00:00:00.000Z', new Date('2026-09-30T23:59:59Z'))).toBe(
      true,
    );
  });

  it('classes-23 takes the first purchase held in property accounts, as a Moscow day', () => {
    const lots = (complete: boolean, ...held: [string, string][]) =>
      ({
        instrumentId: 'synthetic',
        currency: 'USD',
        complete,
        lots: held.map(([accountId, acquiredAt]) => ({ accountId, acquiredAt })),
      }) as unknown as AssetLots;
    expect(
      firstBought(
        lots(true, [house, '2026-10-15T22:30:00.000Z'], [safe, '2025-01-01T00:00:00.000Z']),
        classes,
      ),
    ).toBe('2026-10-16');
    expect(firstBought(lots(false, [house, '2025-09-01T00:00:00.000Z']), classes)).toBeNull();
    expect(firstBought(lots(true, [safe, '2025-09-01T00:00:00.000Z']), classes)).toBeNull();
    expect(firstBought(null, classes)).toBeNull();
  });
});
