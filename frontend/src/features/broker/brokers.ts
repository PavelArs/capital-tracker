import type { AccountSummary } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { sumDecimals } from '@/utils/decimal';

export interface BrokerPosition {
  asset: AssetValuation;
  /** What this account holds of the asset. */
  quantity: string;
  value: string | null;
}

export interface BrokerAccount {
  id: string;
  name: string;
  /** Securities first, most valuable first, then the cash. */
  positions: BrokerPosition[];
  /** What the priced positions are worth, exactly. */
  value: string;
  /** Positions without a price, left out of the value. */
  unpriced: number;
  /** Positions with a price but no exchange rate to the shown currency, left out too. */
  unrated: number;
}

const unrated = (position: BrokerPosition) => position.asset.missingPrice === 'no-rate';

const byValue = (left: BrokerPosition, right: BrokerPosition) =>
  Number(right.value ?? 0) - Number(left.value ?? 0) ||
  left.asset.name.localeCompare(right.asset.name, 'en');

/** The owner's broker accounts (v8) with what each holds, most valuable first. */
export function brokerAccountsOf(
  portfolio: PortfolioValuation,
  accounts: readonly AccountSummary[],
): BrokerAccount[] {
  return accounts
    .filter((account) => account.assetClass === 'broker')
    .map((account) => {
      const positions = portfolio.assets.flatMap((asset) =>
        asset.holdings
          .filter((holding) => holding.accountId === account.id && Number(holding.quantity) > 0)
          .map((holding) => ({ asset, quantity: holding.quantity, value: holding.value })),
      );
      const cash = (position: BrokerPosition) => position.asset.assetType === 'fiat';
      return {
        id: account.id,
        name: account.name,
        positions: [
          ...positions.filter((position) => !cash(position)).sort(byValue),
          ...positions.filter(cash).sort(byValue),
        ],
        value: sumDecimals(positions.flatMap(({ value }) => (value === null ? [] : [value]))),
        unpriced: positions.filter((position) => position.value === null && !unrated(position))
          .length,
        unrated: positions.filter((position) => position.value === null && unrated(position))
          .length,
      };
    })
    .sort(
      (left, right) =>
        Number(right.value) - Number(left.value) || left.name.localeCompare(right.name, 'en'),
    );
}

/** The share of net worth held at brokers, or null while the net worth is unknown. */
export function brokerShare(total: string, portfolio: PortfolioValuation): number | null {
  const worth = Number(portfolio.totalValue ?? Number.NaN);
  return worth > 0 ? (Number(total) / worth) * 100 : null;
}

/** "1 position", "2 positions". */
export const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** What a total at brokers leaves out: positions without a price, then without a rate. */
export function leftOut(unpriced: number, unrated: number): string | null {
  const parts = [
    unpriced > 0 && `${plural(unpriced, 'position')} without a price left out.`,
    unrated > 0 && `${plural(unrated, 'position')} without an exchange rate left out.`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}
