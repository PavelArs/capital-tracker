import type { HistoricalPosition } from './historical-accounting';
import { projectValuation, type ValuationPrice } from './historical-valuation';

export function projectValuationSeries(
  snapshots: readonly { at: string; positions: readonly HistoricalPosition[] }[],
  prices: readonly ValuationPrice[],
) {
  const byInstant = new Map<string, ValuationPrice[]>();
  for (const price of prices) {
    const points = byInstant.get(price.observedAt) ?? [];
    points.push(price);
    byInstant.set(price.observedAt, points);
  }
  return snapshots.map(({ at, positions }) => {
    const { items: _items, ...valuation } = projectValuation(positions, byInstant.get(at) ?? []);
    return { at, ...valuation };
  });
}
