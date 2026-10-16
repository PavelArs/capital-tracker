import type { PortfolioValuation } from '@api/portfolio-valuation.api';

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
