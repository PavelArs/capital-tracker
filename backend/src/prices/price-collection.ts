import type { MarketAsset } from './price-catalog';
import type { PriceFailure, PriceProvider, ProviderSource, Quote } from './price-providers';

export type SourceState = 'synced' | 'syncing' | 'delayed' | 'failed';
export interface SourceOutcome {
  state: SourceState;
  errorCode: string | null;
  errorMessage: string | null;
}
export type Freshness = 'fresh' | 'stale' | 'none';

const HOUR_MS = 3_600_000;
export const STALE_AFTER_MS = 2 * HOUR_MS;
export const RUN_OFFSET_MS = 5 * 60_000;

export const PROVIDER_NAMES: Record<ProviderSource, string> = {
  kraken: 'Kraken',
  coingecko: 'CoinGecko',
};
const FAILURE_TEXT: Record<PriceFailure, string> = {
  unavailable: 'did not answer',
  rate_limited: 'rate limit reached',
  invalid_response: 'sent an unreadable answer',
};
export const failureMessage = (source: ProviderSource, reason: PriceFailure) =>
  `${PROVIDER_NAMES[source]} ${FAILURE_TEXT[reason]}`;

const hourStart = (now: Date) => Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;

// Owner decision Q3: the two providers take turns; even UTC hours start with Kraken.
export function primaryProvider(now: Date): ProviderSource {
  return (hourStart(now) / HOUR_MS) % 2 === 0 ? 'kraken' : 'coingecko';
}

export function isDue(lastAttemptAt: Date | null, now: Date): boolean {
  return !lastAttemptAt || lastAttemptAt.getTime() < hourStart(now);
}

export function nextRunAt(now: Date): Date {
  return new Date(hourStart(now) + HOUR_MS + RUN_OFFSET_MS);
}

export function freshness(observedAt: string | null, now: Date): Freshness {
  if (!observedAt) return 'none';
  return now.getTime() - Date.parse(observedAt) <= STALE_AFTER_MS ? 'fresh' : 'stale';
}

// Ask the primary for every asset, then the other provider for whatever is still missing.
export async function gatherQuotes(
  now: Date,
  assets: readonly MarketAsset[],
  providers: Record<ProviderSource, PriceProvider>,
): Promise<{ quotes: Quote[]; outcomes: Partial<Record<ProviderSource, SourceOutcome>> }> {
  const primary = primaryProvider(now);
  const order: ProviderSource[] =
    primary === 'kraken' ? ['kraken', 'coingecko'] : ['coingecko', 'kraken'];
  const quotes: Quote[] = [];
  const outcomes: Partial<Record<ProviderSource, SourceOutcome>> = {};
  let pending = [...assets];
  for (const source of order) {
    if (!pending.length) break;
    const result = await providers[source].latest(pending, now);
    if (!result.ok) {
      outcomes[source] = {
        state: 'failed',
        errorCode: result.reason,
        errorMessage: failureMessage(source, result.reason),
      };
      continue;
    }
    quotes.push(...result.quotes);
    const delivered = new Set(result.quotes.map(({ asset }) => asset));
    pending = pending.filter(({ code }) => !delivered.has(code));
    outcomes[source] = pending.length
      ? {
          state: 'delayed',
          errorCode: 'missing_assets',
          errorMessage: `No price for ${pending.map(({ code }) => code).join(', ')}`,
        }
      : { state: 'synced', errorCode: null, errorMessage: null };
  }
  const position = new Map(assets.map(({ code }, index) => [code, index]));
  quotes.sort((a, b) => (position.get(a.asset) ?? 0) - (position.get(b.asset) ?? 0));
  return { quotes, outcomes };
}
