import type { MarketAsset } from './price-catalog';
import type { PriceProvider, ProviderSource, Quote } from './price-providers';

export type SourceState = 'synced' | 'syncing' | 'delayed' | 'failed';
export interface SourceOutcome {
  state: SourceState;
  errorCode: string | null;
  errorMessage: string | null;
}
export type Freshness = 'fresh' | 'stale' | 'none';

export function primaryProvider(_now: Date): ProviderSource {
  return 'kraken';
}
export function isDue(_lastAttemptAt: Date | null, _now: Date): boolean {
  return false;
}
export function nextRunAt(now: Date): Date {
  return now;
}
export function freshness(_observedAt: string | null, _now: Date): Freshness {
  return 'none';
}
export async function gatherQuotes(
  _now: Date,
  _assets: readonly MarketAsset[],
  _providers: Record<ProviderSource, PriceProvider>,
): Promise<{ quotes: Quote[]; outcomes: Partial<Record<ProviderSource, SourceOutcome>> }> {
  return { quotes: [], outcomes: {} };
}
