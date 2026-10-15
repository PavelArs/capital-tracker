import type { AccountClass } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { sumDecimals } from '@/utils/decimal';

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

// Exact, so a part never shows a cent more than it is worth; any part without a value leaves it unknown.
const sumOf = (values: readonly (string | null)[]): string | null =>
  values.every((value) => value !== null) ? sumDecimals(values as string[]) : null;

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
      // Whatever is still held counts, however small; only the shown share is rounded.
      if (!(quantity > 0)) return [];
      const whole = held.length === asset.holdings.length;
      return [
        {
          asset,
          // Rounded only past what the share can be entered with, to drop float noise.
          share: Math.round(quantity * 1e8) / 1e6,
          value: whole ? asset.value : sumOf(held.map((holding) => holding.value)),
          costBasis: whole ? asset.costBasis : null,
          unrealizedPnl: whole ? asset.unrealizedPnl : null,
          unrealizedReturnPercent: whole ? asset.unrealizedReturnPercent : null,
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.value ?? 0) - Number(left.value ?? 0) ||
        left.asset.name.localeCompare(right.asset.name, 'en'),
    );
}

/** "50% yours", "33.33% yours", "Fully yours", "Less than 0.01% yours". */
export function shareText(share: number): string {
  if (share >= 100) return 'Fully yours';
  const shown = Math.min(Math.round(share * 100) / 100, 99.99);
  return shown < 0.01
    ? 'Less than 0.01% yours'
    : `${new Intl.NumberFormat('en-US').format(shown)}% yours`;
}

/** What the properties with a value come to, exactly; those without one are left out. */
export const propertyTotal = (properties: readonly Pick<Property, 'value'>[]) =>
  sumDecimals(properties.flatMap(({ value }) => (value === null ? [] : [value])));
