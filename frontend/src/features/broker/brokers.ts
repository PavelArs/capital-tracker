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
  /** What the priced positions are worth, exactly. */
  value: string;
  /** Positions without a price, left out of the value. */
  unpriced: number;
  /** Positions with a price but no exchange rate to the shown currency, left out too. */
  unrated: number;
}

const SCALE = 30;
const units = (value: string) => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[-+]/, '').split('.');
  const scaled = BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -scaled : scaled;
};

/** The exact sum of decimal strings, without binary floating point. */
export function sumDecimals(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + units(value), 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return `${total < 0n ? '-' : ''}${digits.slice(0, -SCALE)}${fraction ? `.${fraction}` : ''}`;
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
