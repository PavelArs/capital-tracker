import type { AccountClass } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';

export interface Property {
  asset: AssetValuation;
  /** The owner's share in percent: the quantity held in property accounts, times 100. */
  share: number;
  /** What is held in property accounts is worth; the asset's own figures when nothing is held elsewhere. */
  value: string | null;
  /** Paid and gain are only known for the whole asset, so they show when all of it is property. */
  costBasis: string | null;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
}

const sumOf = (values: readonly (string | null)[]): string | null =>
  values.some((value) => value === null)
    ? null
    : values.reduce((sum, value) => sum + Number(value), 0).toFixed(2);

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
      const whole = held.length === asset.holdings.length;
      return [
        {
          asset,
          share: Math.round(quantity * 10_000) / 100,
          value: whole ? asset.value : sumOf(held.map((holding) => holding.value)),
          costBasis: whole ? asset.costBasis : null,
          unrealizedPnl: whole ? asset.unrealizedPnl : null,
          unrealizedReturnPercent: whole ? asset.unrealizedReturnPercent : null,
        },
      ];
    })
    .filter((property) => property.share > 0)
    .sort(
      (left, right) =>
        Number(right.value ?? 0) - Number(left.value ?? 0) ||
        left.asset.name.localeCompare(right.asset.name, 'en'),
    );
}

/** "50% yours", "33.33% yours", "Fully yours". */
export const shareText = (share: number) =>
  share >= 100 ? 'Fully yours' : `${new Intl.NumberFormat('en-US').format(share)}% yours`;
