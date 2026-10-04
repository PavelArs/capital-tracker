import { MARKET_ASSETS, type MarketAsset } from './price-catalog';
import { freshness, gatherQuotes, isDue, nextRunAt, primaryProvider } from './price-collection';
import type { PriceProvider, ProviderSource, Quote, QuoteResult } from './price-providers';

const assets = MARKET_ASSETS.slice(0, 3); // BTC, ETH, SOL
const even = new Date('2026-10-04T14:05:00Z');
const odd = new Date('2026-10-04T15:05:00Z');

function quote(source: ProviderSource, code: string): Quote {
  return {
    asset: code,
    price: '1',
    observedAt: '2026-10-04T14:00:00.000Z',
    kind: source === 'kraken' ? 'hourly-close' : 'spot',
    source,
  };
}
function fake(
  source: ProviderSource,
  answer: (asked: readonly MarketAsset[]) => QuoteResult,
): PriceProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    source,
    calls,
    latest: async (asked) => {
      calls.push(asked.map(({ code }) => code));
      return answer(asked);
    },
  };
}
const healthy = (source: ProviderSource, omit: string[] = []) =>
  fake(source, (asked) => ({
    ok: true,
    quotes: asked.filter(({ code }) => !omit.includes(code)).map(({ code }) => quote(source, code)),
    missing: asked.filter(({ code }) => omit.includes(code)).map(({ code }) => code),
  }));
const failing = (source: ProviderSource, reason: 'rate_limited' | 'unavailable') =>
  fake(source, () => ({ ok: false, reason }));

describe('PRC-2 provider alternation and failover', () => {
  it('uses Kraken in even UTC hours and CoinGecko in odd UTC hours', () => {
    expect(primaryProvider(even)).toBe('kraken');
    expect(primaryProvider(odd)).toBe('coingecko');
    expect(primaryProvider(new Date('2026-10-04T00:00:00Z'))).toBe('kraken');
    expect(primaryProvider(new Date('2026-10-04T23:59:59Z'))).toBe('coingecko');
  });

  it('asks only the primary when it delivers every asset', async () => {
    const kraken = healthy('kraken');
    const coingecko = healthy('coingecko');
    const result = await gatherQuotes(even, assets, { kraken, coingecko });
    expect(kraken.calls).toEqual([['BTC', 'ETH', 'SOL']]);
    expect(coingecko.calls).toEqual([]);
    expect(result.quotes.map(({ asset, source }) => `${asset}:${source}`)).toEqual([
      'BTC:kraken',
      'ETH:kraken',
      'SOL:kraken',
    ]);
    expect(result.outcomes).toEqual({
      kraken: { state: 'synced', errorCode: null, errorMessage: null },
    });
  });

  it('PRC-FALLBACK asks CoinGecko when Kraken is due and fails', async () => {
    const kraken = failing('kraken', 'unavailable');
    const coingecko = healthy('coingecko');
    const result = await gatherQuotes(even, assets, { kraken, coingecko });
    expect(coingecko.calls).toEqual([['BTC', 'ETH', 'SOL']]);
    expect(result.quotes.every(({ source }) => source === 'coingecko')).toBe(true);
    expect(result.quotes).toHaveLength(3);
    expect(result.outcomes).toEqual({
      kraken: { state: 'failed', errorCode: 'unavailable', errorMessage: 'Kraken did not answer' },
      coingecko: { state: 'synced', errorCode: null, errorMessage: null },
    });
  });

  it('PRC-ALTERNATE starts with CoinGecko in odd hours and asks Kraken only for omitted assets', async () => {
    const kraken = healthy('kraken');
    const coingecko = healthy('coingecko', ['SOL']);
    const result = await gatherQuotes(odd, assets, { kraken, coingecko });
    expect(coingecko.calls).toEqual([['BTC', 'ETH', 'SOL']]);
    expect(kraken.calls).toEqual([['SOL']]);
    expect(result.quotes.map(({ asset, source }) => `${asset}:${source}`)).toEqual([
      'BTC:coingecko',
      'ETH:coingecko',
      'SOL:kraken',
    ]);
    expect(result.outcomes).toEqual({
      coingecko: {
        state: 'delayed',
        errorCode: 'missing_assets',
        errorMessage: 'No price for SOL',
      },
      kraken: { state: 'synced', errorCode: null, errorMessage: null },
    });
  });

  it('PRC-SOURCES keeps a rate-limited CoinGecko from blocking Kraken', async () => {
    const result = await gatherQuotes(odd, assets, {
      kraken: healthy('kraken'),
      coingecko: failing('coingecko', 'rate_limited'),
    });
    expect(result.quotes).toHaveLength(3);
    expect(result.outcomes).toEqual({
      coingecko: {
        state: 'failed',
        errorCode: 'rate_limited',
        errorMessage: 'CoinGecko rate limit reached',
      },
      kraken: { state: 'synced', errorCode: null, errorMessage: null },
    });
  });

  it('stores nothing and reports both when both fail', async () => {
    const result = await gatherQuotes(even, assets, {
      kraken: failing('kraken', 'unavailable'),
      coingecko: failing('coingecko', 'unavailable'),
    });
    expect(result.quotes).toEqual([]);
    expect(result.outcomes.kraken?.state).toBe('failed');
    expect(result.outcomes.coingecko).toEqual({
      state: 'failed',
      errorCode: 'unavailable',
      errorMessage: 'CoinGecko did not answer',
    });
  });

  it('reports assets neither provider priced on the secondary', async () => {
    const result = await gatherQuotes(even, assets, {
      kraken: healthy('kraken', ['ETH', 'SOL']),
      coingecko: healthy('coingecko', ['SOL']),
    });
    expect(result.quotes.map(({ asset }) => asset)).toEqual(['BTC', 'ETH']);
    expect(result.outcomes).toEqual({
      kraken: {
        state: 'delayed',
        errorCode: 'missing_assets',
        errorMessage: 'No price for ETH, SOL',
      },
      coingecko: {
        state: 'delayed',
        errorCode: 'missing_assets',
        errorMessage: 'No price for SOL',
      },
    });
  });
});

describe('PRC-5 freshness and schedule', () => {
  const now = new Date('2026-10-04T14:05:00Z');
  it.each([
    [null, 'none'],
    ['2026-10-04T14:00:00.000Z', 'fresh'],
    ['2026-10-04T12:05:00.000Z', 'fresh'],
    ['2026-10-04T12:04:59.999Z', 'stale'],
    ['2026-10-04T11:05:00.000Z', 'stale'],
  ])('observation at %s is %s', (observedAt, status) => {
    expect(freshness(observedAt, now)).toBe(status);
  });

  it('is due once per UTC hour', () => {
    expect(isDue(null, now)).toBe(true);
    expect(isDue(new Date('2026-10-04T13:59:59.999Z'), now)).toBe(true);
    expect(isDue(new Date('2026-10-04T14:00:00.000Z'), now)).toBe(false);
    expect(isDue(new Date('2026-10-04T14:04:00.000Z'), now)).toBe(false);
  });

  it('plans the next run five minutes after the next hour', () => {
    expect(nextRunAt(now).toISOString()).toBe('2026-10-04T15:05:00.000Z');
    expect(nextRunAt(new Date('2026-10-04T14:59:59Z')).toISOString()).toBe(
      '2026-10-04T15:05:00.000Z',
    );
  });
});
