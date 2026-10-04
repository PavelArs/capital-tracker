// MVP market assets (owner decision Q7: tokens are USDT and USDC only), quoted in USD.
// Kraken pairs and CoinGecko ids follow the providers' published identifiers.
export interface MarketAsset {
  code: string;
  krakenPair: string;
  coingeckoId: string;
}

export const QUOTE_CURRENCY = 'USD';

export const MARKET_ASSETS: readonly MarketAsset[] = [
  { code: 'BTC', krakenPair: 'XBTUSD', coingeckoId: 'bitcoin' },
  { code: 'ETH', krakenPair: 'ETHUSD', coingeckoId: 'ethereum' },
  { code: 'SOL', krakenPair: 'SOLUSD', coingeckoId: 'solana' },
  { code: 'ZEC', krakenPair: 'ZECUSD', coingeckoId: 'zcash' },
  { code: 'TRX', krakenPair: 'TRXUSD', coingeckoId: 'tron' },
  { code: 'XLM', krakenPair: 'XLMUSD', coingeckoId: 'stellar' },
  { code: 'USDT', krakenPair: 'USDTUSD', coingeckoId: 'tether' },
  { code: 'USDC', krakenPair: 'USDCUSD', coingeckoId: 'usd-coin' },
];
