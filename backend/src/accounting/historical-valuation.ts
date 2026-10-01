import type { HistoricalPosition } from './historical-accounting';
import { canonicalDecimalToAtoms, formatProduct } from './money';

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
