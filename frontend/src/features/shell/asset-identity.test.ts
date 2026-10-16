import { describe, expect, it } from 'vitest';
import { assetClassColors, assetIdentity } from './asset-identity';

describe('asset identity colours', () => {
  it('dashboard-13 gives a broker or property asset its class colour, not the Other grey', () => {
    const fund = { symbol: null, name: 'Sample index fund', assetType: 'manual' as const };
    expect(assetIdentity({ ...fund, assetClass: 'broker' }).color).toBe('var(--c-broker)');
    expect(assetIdentity({ ...fund, name: 'Studio', assetClass: 'property' }).color).toBe(
      'var(--c-prop)',
    );
    expect(assetIdentity(fund).color).toBe('var(--c-other)');
    expect(assetClassColors).toEqual({ broker: 'var(--c-broker)', property: 'var(--c-prop)' });
  });
});
