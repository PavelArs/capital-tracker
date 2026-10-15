import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { describe, expect, it } from 'vitest';
import { propertiesOf, propertyTotal } from './real-estate';

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
  it('classes-03 sums the part held in property accounts exactly, never rounded up', () => {
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
});
