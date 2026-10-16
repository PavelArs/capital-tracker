import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { SummaryFigure } from '@/ui/SummaryCard';

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/**
 * Why the net worth, and so a share of it (at brokers, in deposits), is unknown or cannot carry
 * a share; null when it is known and above zero. Comparing with zero is display only.
 */
export function netWorthUnknown(portfolio: PortfolioValuation): string | null {
  if (portfolio.totalValue !== null) {
    const worth = Number(portfolio.totalValue);
    if (worth > 0) return null;
    return worth < 0 ? 'Net worth is below zero.' : 'Net worth is zero.';
  }
  const reasons = [
    portfolio.missingPriceCount > 0 &&
      `${plural(portfolio.missingPriceCount, 'asset')} without a price or exchange rate`,
    portfolio.unratedDepositCount > 0 &&
      `${plural(portfolio.unratedDepositCount, 'deposit')} without an exchange rate`,
    portfolio.unavailableAccountCount > 0 &&
      `${plural(portfolio.unavailableAccountCount, 'account')} that could not be read`,
  ].filter(Boolean);
  return reasons.length ? `Net worth unknown: ${reasons.join(', ')}.` : 'Net worth unknown.';
}

/**
 * A part of the net worth as a percentage, or null when the part or the net worth is unknown or
 * the net worth is not above zero. Display only: the share is never stored or summed.
 */
export function shareOfNetWorth(part: string | null, portfolio: PortfolioValuation): number | null {
  if (part === null) return null;
  const worth = Number(portfolio.totalValue ?? Number.NaN);
  return worth > 0 ? (Number(part) / worth) * 100 : null;
}

/** A share is rounded down to a tenth: a share is never shown larger than it is. */
const shareText = (share: number) =>
  `${new Intl.NumberFormat('en-US', { minimumFractionDigits: share % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 }).format(Math.floor(share * 10 + 1e-9) / 10)}%`;

/** The "Share of net worth" figure of a section's totals card: the number, or a dash and why. */
export function shareFigure(part: string | null, portfolio: PortfolioValuation): SummaryFigure {
  const share = shareOfNetWorth(part, portfolio);
  return {
    label: 'Share of net worth',
    value: share === null ? '—' : shareText(share),
    note:
      share !== null
        ? undefined
        : part === null
          ? 'The total is unknown.'
          : netWorthUnknown(portfolio),
  };
}
