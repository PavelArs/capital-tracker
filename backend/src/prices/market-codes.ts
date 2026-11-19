import type { EntityManager } from 'typeorm';
import { MARKET_ASSETS } from './price-catalog';

/** The tickers price_observations can store. */
const storable = /^[A-Z0-9]{2,15}$/;

const catalogCodes = MARKET_ASSETS.map(({ code }) => {
  if (!storable.test(code)) throw new Error('A catalog code is a ticker');
  return `'${code}'`;
}).join(',');

/**
 * TOKEN-TICKER (Codex Security #6): SQL that is true when the stored price `alias` (a row of
 * price_observations) is a price of the asset its ticker names now. CoinGecko prices the catalog
 * coins, and the tokens of wallets by contract under their tickers. A token that gave its ticker
 * up to an exchange coin (separateTokenTickers) leaves its CoinGecko prices under the old one:
 * history of the token, stored again under its new ticker, never a price of the coin.
 */
export const namesItsAsset = (alias: string): string =>
  `(${alias}.source <> 'coingecko' OR ${alias}.asset IN (${catalogCodes})
    OR EXISTS (SELECT 1 FROM chain_tokens named WHERE named.ticker = ${alias}.asset))`;

/**
 * BYBIT-ANY-COIN: the tickers of market-priced crypto assets the price catalog does not list
 * (coins first met in a Bybit account, say), which Kraken and CoinGecko are never asked for.
 * TOKEN-ANY-PRICE: not the tokens of Ethereum and Solana wallets, whose ticker is the owner's
 * own name for a contract and may be another coin's on Bybit; CoinGecko prices those by contract.
 */
export async function extraMarketCodes(manager: Pick<EntityManager, 'query'>): Promise<string[]> {
  const rows: { code: string }[] = await manager.query(
    `SELECT DISTINCT upper(symbol) AS code FROM accounting_instruments
      WHERE "assetType" = 'crypto' AND "priceSource" = 'market' AND symbol IS NOT NULL
        AND upper(symbol) NOT IN (SELECT ticker FROM chain_tokens)
      ORDER BY 1`,
  );
  const catalog = new Set(MARKET_ASSETS.map(({ code }) => code));
  return rows.map(({ code }) => code).filter((code) => storable.test(code) && !catalog.has(code));
}
