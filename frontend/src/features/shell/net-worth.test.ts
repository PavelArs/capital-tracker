import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { describe, expect, it } from 'vitest';
import { shareFigure, shareOfNetWorth } from './net-worth';

// Synthetic amounts only.
const portfolio = (totalValue: string | null) =>
  ({
    totalValue,
    missingPriceCount: 1,
    unratedDepositCount: 0,
    unavailableAccountCount: 0,
  }) as unknown as PortfolioValuation;

describe('SECTION-SHARE: the share of net worth in a section’s totals card', () => {
  it('SECTION-SHARE-ROUND-DOWN never shows a share better than the real one', () => {
    expect(shareFigure('1296', portfolio('10000')).value).toBe('12.9%');
    expect(shareFigure('5000', portfolio('10000')).value).toBe('50%');
    expect(shareFigure('3', portfolio('10000')).value).toBe('0.0%');
  });

  it('SECTION-SHARE-UNKNOWN-WORTH shows a dash and why while the net worth is unknown', () => {
    const figure = shareFigure('5000', portfolio(null));
    expect(figure.value).toBe('—');
    expect(figure.note).toBe('Net worth unknown: 1 asset without a price or exchange rate.');
    expect(shareOfNetWorth('5000', portfolio(null))).toBeNull();
  });

  it('SECTION-SHARE-UNKNOWN-PART shows a dash and says the total itself is unknown', () => {
    const figure = shareFigure(null, portfolio('10000'));
    expect(figure.value).toBe('—');
    expect(figure.note).toBe('The total is unknown.');
  });
});
