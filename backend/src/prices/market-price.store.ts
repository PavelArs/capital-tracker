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

/** EST-AT-TIME: how old a stored price may be and still value a transaction at its time. */
export const STORED_PRICE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

export interface PriceRequest {
  asset: string;
  at: string;
}

/**
 * EST-AT-TIME: for each asset and instant, the latest observation at or before it and at most
 * STORED_PRICE_MAX_AGE_MS older, from any source; none when nothing that recent is stored.
 */
export async function marketPricesAt(
  manager: EntityManager,
  requests: readonly PriceRequest[],
): Promise<LatestMarketPrice[]> {
  const unique = [...new Map(requests.map((r) => [`${r.asset}@${r.at}`, r])).values()];
  if (unique.length === 0) return [];
  const rows: LatestRow[] = await manager.query(
    `SELECT DISTINCT p.asset, p.price, p."observedAt", p.source
     FROM unnest($1::text[], $2::timestamptz[]) AS r(asset, at)
     CROSS JOIN LATERAL (
       SELECT asset, price::text AS price, "observedAt", source
       FROM price_observations
       WHERE asset = r.asset AND "quoteCurrency" = $3 AND "observedAt" <= r.at
         AND "observedAt" >= r.at - make_interval(secs => $4)
       ORDER BY "observedAt" DESC, kind DESC, source
       LIMIT 1
     ) p`,
    [
      unique.map((r) => r.asset),
      unique.map((r) => r.at),
      QUOTE_CURRENCY,
      STORED_PRICE_MAX_AGE_MS / 1000,
    ],
  );
  return rows.map((row) => ({
    asset: row.asset,
    price: exact(row.price),
    observedAt: row.observedAt.toISOString(),
    source: row.source,
  }));
}

/** EST-AT-TIME: the prices that value each asset at each instant, by asset, for priceAt. */
export async function storedPricesAt(
  manager: EntityManager,
  requests: readonly PriceRequest[],
): Promise<Map<string, { priceUsd: string; observedAt: string; source: string }[]>> {
  const byAsset = new Map<string, { priceUsd: string; observedAt: string; source: string }[]>();
  for (const row of await marketPricesAt(manager, requests)) {
    const list = byAsset.get(row.asset) ?? [];
    list.push({ priceUsd: row.price, observedAt: row.observedAt, source: row.source });
    byAsset.set(row.asset, list);
  }
  return byAsset;
}

/**
 * EST-AT-TIME: of an asset's stored prices, the one that values an instant: the latest at or
 * before it, at most STORED_PRICE_MAX_AGE_MS older; undefined when none is.
 */
export function priceAt<T extends { observedAt: string }>(
  prices: readonly T[] | undefined,
  at: string,
): T | undefined {
  const instant = Date.parse(at);
  let found: T | undefined;
  for (const price of prices ?? []) {
    const observed = Date.parse(price.observedAt);
    if (observed > instant || instant - observed > STORED_PRICE_MAX_AGE_MS) continue;
    if (!found || observed > Date.parse(found.observedAt)) found = price;
  }
  return found;
}
