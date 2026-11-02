import type { PortfolioValuation } from '@api/portfolio-valuation.api';

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/**
 * Why the net worth, and so a share of it (at brokers, in deposits), is unknown or cannot carry
 * a share; null when it is known and above zero. Comparing with zero is display only.
 */
export function netWorthUnknown(portfolio: PortfolioValuation): string | null {
  if (portfolio.totalValue !== null) {
    // A net worth that is a floor for want of an account's interest overstates every share of it.
    const floor = portfolio.interestMissingDepositCount ?? 0;
    if (floor > 0) {
      return `Net worth is a floor: ${plural(floor, 'account')} without an interest rate.`;
    }
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
      `${plural(portfolio.unavailableAccountCount, 'account')} whose history starts later`,
  ].filter(Boolean);
  return reasons.length ? `Net worth unknown: ${reasons.join(', ')}.` : 'Net worth unknown.';
}

/** "≈" before a share worked out against a net worth that leaves something out. */
export const estimateMark = (estimated: string | null | undefined) => (estimated ? '≈' : '');

/**
 * NW-SHARE-ESTIMATE: what a share of net worth is taken of, display only. While net worth leaves
 * something out (a price, a rate, an account, or interest), a share is of its known part and is
 * an estimate, said in `estimated`; null when that part is not above zero.
 */
export function shareBase(
  portfolio: PortfolioValuation,
): { value: number; estimated: string | null } | null {
  const value = Number(portfolio.totalValue ?? portfolio.pricedSubtotal ?? Number.NaN);
  if (!(value > 0)) return null;
  const unknown = portfolio.totalValue === null;
  const interest = portfolio.interestMissingDepositCount ?? 0;
  const reasons = [
    unknown &&
      portfolio.missingPriceCount > 0 &&
      `${plural(portfolio.missingPriceCount, 'asset')} without a price or exchange rate`,
    unknown &&
      portfolio.unratedDepositCount > 0 &&
      `${plural(portfolio.unratedDepositCount, 'deposit')} without an exchange rate`,
    unknown &&
      portfolio.unavailableAccountCount > 0 &&
      `${plural(portfolio.unavailableAccountCount, 'account')} whose history starts later`,
    interest > 0 && `interest on ${plural(interest, 'account')} without an interest rate`,
  ].filter(Boolean);
  const estimated =
    reasons.length > 0
      ? `Estimated against the known net worth, which leaves out ${reasons.join(', ')}.`
      : unknown
        ? 'Estimated against the known net worth.'
        : null;
  return { value, estimated };
}
