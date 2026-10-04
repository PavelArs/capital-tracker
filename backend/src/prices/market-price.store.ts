import type { EntityManager } from 'typeorm';
import { QUOTE_CURRENCY } from './price-catalog';

export interface LatestMarketPrice {
  asset: string;
  price: string;
  observedAt: string;
  source: string;
}
interface LatestRow {
  asset: string;
  price: string;
  observedAt: Date;
  source: string;
}

// numeric(78,30) text without trailing zeros.
const exact = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

/** Valuation rule: the latest observation at or before the instant, from any source. */
export async function latestMarketPrices(
  manager: EntityManager,
  codes: readonly string[],
  at: Date,
): Promise<LatestMarketPrice[]> {
  if (codes.length === 0) return [];
  const rows: LatestRow[] = await manager.query(
    `SELECT DISTINCT ON (asset) asset, price::text AS price, "observedAt", source
     FROM price_observations
     WHERE asset = ANY($1) AND "quoteCurrency" = $2 AND "observedAt" <= $3
     ORDER BY asset, "observedAt" DESC, kind DESC, source`,
    [codes, QUOTE_CURRENCY, at],
  );
  return rows.map((row) => ({
    asset: row.asset,
    price: exact(row.price),
    observedAt: row.observedAt.toISOString(),
    source: row.source,
  }));
}
