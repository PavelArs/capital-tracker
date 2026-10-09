import type { EntityManager } from 'typeorm';
import { MARKET_ASSETS } from './price-catalog';

/** The tickers price_observations can store. */
const storable = /^[A-Z0-9]{2,15}$/;

/**
 * BYBIT-ANY-COIN: the tickers of market-priced crypto assets the price catalog does not list
 * (coins first met in a Bybit account, say), which Kraken and CoinGecko are never asked for.
 */
export async function extraMarketCodes(manager: Pick<EntityManager, 'query'>): Promise<string[]> {
  const rows: { code: string }[] = await manager.query(
    `SELECT DISTINCT upper(symbol) AS code FROM accounting_instruments
      WHERE "assetType" = 'crypto' AND "priceSource" = 'market' AND symbol IS NOT NULL
      ORDER BY 1`,
  );
  const catalog = new Set(MARKET_ASSETS.map(({ code }) => code));
  return rows.map(({ code }) => code).filter((code) => storable.test(code) && !catalog.has(code));
}
