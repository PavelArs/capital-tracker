import type { MarketAsset } from './price-catalog';

export type ProviderSource = 'kraken' | 'coingecko';
export type PriceFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
export type QuoteKind = 'hourly-close' | 'spot' | 'daily-close';
export interface Quote {
  asset: string;
  price: string;
  observedAt: string;
  kind: QuoteKind;
  source: ProviderSource;
}
export type QuoteResult =
  | { ok: true; quotes: Quote[]; missing: string[] }
  | { ok: false; reason: PriceFailure };
export type HistoryResult = { ok: true; quotes: Quote[] } | { ok: false; reason: PriceFailure };
export interface PriceProvider {
  readonly source: ProviderSource;
  latest(assets: readonly MarketAsset[], now: Date): Promise<QuoteResult>;
}

export class KrakenClient implements PriceProvider {
  readonly source = 'kraken' as const;
  constructor(_options: { baseUrl?: string; timeoutMs?: number; pauseMs?: number } = {}) {}
  async latest(_assets: readonly MarketAsset[], _now: Date): Promise<QuoteResult> {
    return { ok: true, quotes: [], missing: [] };
  }
  async daily(_asset: MarketAsset, _from: Date, _now: Date): Promise<HistoryResult> {
    return { ok: true, quotes: [] };
  }
}

export class CoinGeckoClient implements PriceProvider {
  readonly source = 'coingecko' as const;
  constructor(_options: { baseUrl?: string; timeoutMs?: number; demoKey?: string } = {}) {}
  async latest(_assets: readonly MarketAsset[], _now: Date): Promise<QuoteResult> {
    return { ok: true, quotes: [], missing: [] };
  }
}
