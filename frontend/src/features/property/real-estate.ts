import type { AccountClass } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';

export interface Property {
  asset: AssetValuation;
  /** The owner's share in percent: the quantity held in property accounts, times 100. */
  share: number;
}

/** The assets held in property accounts (v8), most valuable first. */
export function propertiesOf(
  portfolio: PortfolioValuation,
  classes: Readonly<Record<string, AccountClass | null | undefined>>,
): Property[] {
  return portfolio.assets
    .flatMap((asset) => {
      const held = asset.holdings.filter((holding) => classes[holding.accountId] === 'property');
      if (!held.length) return [];
      const quantity = held.reduce((sum, holding) => sum + Number(holding.quantity), 0);
      return [{ asset, share: Math.round(quantity * 10_000) / 100 }];
    })
    .filter((property) => property.share > 0)
    .sort(
      (left, right) =>
        Number(right.asset.value ?? 0) - Number(left.asset.value ?? 0) ||
        left.asset.name.localeCompare(right.asset.name, 'en'),
    );
}

/** "50% yours", "33.33% yours", "Fully yours". */
export const shareText = (share: number) =>
  share >= 100 ? 'Fully yours' : `${new Intl.NumberFormat('en-US').format(share)}% yours`;
