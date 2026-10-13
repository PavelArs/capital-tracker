import type { AccountSummary } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';

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
  /** What the priced positions are worth. */
  value: number;
  /** Positions without a price, left out of the value. */
  unpriced: number;
}

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
        value: positions.reduce((sum, position) => sum + Number(position.value ?? 0), 0),
        unpriced: positions.filter((position) => position.value === null).length,
      };
    })
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, 'en'));
}

/** The share of net worth held at brokers, or null while the net worth is unknown. */
export function brokerShare(total: number, portfolio: PortfolioValuation): number | null {
  const worth = Number(portfolio.totalValue ?? Number.NaN);
  return worth > 0 ? (total / worth) * 100 : null;
}
