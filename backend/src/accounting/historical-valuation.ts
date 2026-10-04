import type { HistoricalPosition } from './historical-accounting';
import {
  canonicalDecimalToAtoms,
  formatPercent,
  formatProduct,
  formatSignedProduct,
} from './money';

export interface ValuationPrice {
  instrumentId: string;
  priceUsd: string;
  observedAt: string;
  revision: number;
}

/** Prices are already effective exact-time points from the same database snapshot. */
export function projectValuation(
  positions: readonly HistoricalPosition[],
  prices: readonly ValuationPrice[],
) {
  const byInstrument = new Map(prices.map((price) => [price.instrumentId, price]));
  let subtotal = 0n;
  let missingPriceCount = 0;
  const items = positions.map((position) => {
    const price = byInstrument.get(position.instrumentId);
    if (!price) {
      missingPriceCount++;
      return { ...position, price: null, valueUsd: null };
    }
    const value =
      canonicalDecimalToAtoms(position.quantity) * canonicalDecimalToAtoms(price.priceUsd);
    subtotal += value;
    return {
      ...position,
      price: { priceUsd: price.priceUsd, observedAt: price.observedAt, revision: price.revision },
      valueUsd: formatProduct(value),
    };
  });
  const pricedSubtotalUsd = formatProduct(subtotal);
  return {
    completeness: missingPriceCount === 0 ? ('complete' as const) : ('incomplete' as const),
    missingPriceCount,
    pricedSubtotalUsd,
    totalValueUsd: missingPriceCount === 0 ? pricedSubtotalUsd : null,
    items,
  };
}

type ValuedPosition = ReturnType<typeof projectValuation>['items'][number];
const ATOM_SCALE = 10n ** 30n;

/** Value minus remaining FIFO cost; unknown price or basis stays null, never partial. */
export function projectUnrealized<T extends { items: readonly ValuedPosition[] }>(valuation: T) {
  let result = 0n;
  let cost = 0n;
  let unknownCostCount = 0;
  let complete = true;
  const items = valuation.items.map((item) => {
    if (item.costUsd === null) unknownCostCount++;
    if (item.price === null || item.costUsd === null) {
      complete = false;
      return { ...item, unrealizedPnlUsd: null, unrealizedReturnPercent: null };
    }
    // Same scale60 product as valueUsd; cost is lifted from scale30.
    const value =
      canonicalDecimalToAtoms(item.quantity) * canonicalDecimalToAtoms(item.price.priceUsd);
    const itemCost = canonicalDecimalToAtoms(item.costUsd) * ATOM_SCALE;
    const itemResult = value - itemCost;
    result += itemResult;
    cost += itemCost;
    return {
      ...item,
      unrealizedPnlUsd: formatSignedProduct(itemResult),
      unrealizedReturnPercent: itemCost === 0n ? null : formatPercent(itemResult, itemCost),
    };
  });
  return {
    ...valuation,
    unknownCostCount,
    unrealizedPnlUsd: complete ? formatSignedProduct(result) : null,
    unrealizedReturnPercent: complete && cost !== 0n ? formatPercent(result, cost) : null,
    items,
  };
}
