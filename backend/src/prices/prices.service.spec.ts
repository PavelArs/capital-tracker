import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { BybitMarketClient } from './bybit-market';
import { CoinGeckoClient, KrakenClient, type Quote } from './price-providers';
import { PricesService } from './prices.service';

function fixture(count: number) {
  const codes = Array.from({ length: count }, (_, i) => `SYN${String(i).padStart(3, '0')}`);
  const quotes = new Map<string, Quote>();
  const states: string[] = [];
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('DISTINCT upper(symbol)')) return codes.map((code) => ({ code }));
    if (sql.includes('SELECT DISTINCT asset')) return codes.map((asset) => ({ asset }));
    if (sql.includes('INSERT INTO price_observations')) {
      const assets = args[1] as string[];
      for (let i = 0; i < assets.length; i++)
        quotes.set(assets[i], {
          asset: assets[i],
          price: (args[4] as string[])[i],
          source: 'bybit',
          kind: 'hourly-close',
          observedAt: (args[3] as string[])[i],
        });
      return assets.map((asset) => ({ asset }));
    }
    if (sql.includes('FROM price_observations'))
      return [...quotes.values()].map((quote) => ({
        ...quote,
        observedAt: new Date(quote.observedAt),
      }));
    if (sql.includes('INSERT INTO sync_sources')) {
      states.push(args[1] as string);
      return [];
    }
    if (sql.includes('FROM sync_sources') || sql.includes('SET TRANSACTION')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const manager = { query };
  const source = {
    query,
    transaction: async (...args: unknown[]) =>
      (args.at(-1) as (manager: unknown) => unknown)(manager),
  };
  const bybit = {
    latest: jest.fn(async (asset: string, now: Date) => ({
      asset,
      price: '1',
      observedAt: now.toISOString(),
      kind: 'hourly-close',
      source: 'bybit',
    })),
    daily: jest.fn(),
  };
  const service = new PricesService(
    source as unknown as DataSource,
    new ConfigService({}),
    {} as KrakenClient,
    {} as CoinGeckoClient,
    bybit as unknown as BybitMarketClient,
  );
  const collect = (now: Date) =>
    (service as unknown as { collectBybit(now: Date): Promise<unknown> }).collectBybit(now);
  return { codes, bybit, service, collect, states };
}

describe('PRC-FAIR-BATCH: every eligible symbol gets a turn', () => {
  it('PRC-FAIR-BATCH prices all 51 symbols over two hourly runs and keeps each run bounded', async () => {
    const { codes, bybit, collect, states } = fixture(51);
    const now = new Date('2026-10-18T12:05:00Z');
    await collect(now);
    expect(bybit.latest.mock.calls.length).toBeLessThanOrEqual(50);
    expect(states[0]).toBe('delayed');
    const first = bybit.latest.mock.calls.length;
    await collect(new Date(now.getTime() + 3_600_000));
    expect(bybit.latest.mock.calls.length - first).toBeLessThanOrEqual(50);
    expect(new Set(bybit.latest.mock.calls.map(([code]) => code))).toEqual(new Set(codes));
    expect(states.at(-1)).toBe('synced');
  });

  it('PRC-ALL-HEALTH lists symbols beyond the collection batch, including missing prices', async () => {
    const { service, codes } = fixture(51);
    const view = await service.read(new Date('2026-10-18T12:05:00Z'));
    expect(view.assets.filter((asset) => codes.includes(asset.asset))).toHaveLength(51);
    expect(view.assets.find((asset) => asset.asset === codes[50])?.status).toBe('none');
  });
});
