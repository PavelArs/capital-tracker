import type { DataSource } from 'typeorm';
import type { ExchangeRatesCacheService } from '../cache/exchange-rates-cache.service';
import { registry } from './metrics';
import { MetricsCollector } from './metrics.collector';

const value = async (name: string, labels: Record<string, string>) => {
  for (const metric of await registry.getMetricsAsJSON()) {
    for (const entry of metric.values) {
      const matches = Object.entries(labels).every(
        ([key, expected]) => entry.labels[key] === expected,
      );
      // A histogram's rows carry their own series name ("..._count"); gauges and counters use the metric's.
      if (matches && ((entry as { metricName?: string }).metricName ?? metric.name) === name) {
        return entry.value;
      }
    }
  }
  return undefined;
};

function collector(rows: { sources: unknown[]; wallets: unknown[] } | Error, redisUp = true) {
  const source = {
    query: jest.fn(async (sql: string) => {
      if (rows instanceof Error) throw rows;
      if (sql.includes('pg_database_size')) return [{ bytes: '123456' }];
      return sql.includes('FROM wallet_addresses') ? rows.wallets : rows.sources;
    }),
    driver: { master: { totalCount: 4, idleCount: 3, waitingCount: 1 } },
  } as unknown as DataSource;
  const cache = { isHealthy: async () => redisUp } as unknown as ExchangeRatesCacheService;
  return new MetricsCollector(source, cache);
}

describe('OBS-COLLECTOR', () => {
  it('OBS-SRC-1 reports when each price and rate source last succeeded and its state', async () => {
    await collector({
      sources: [
        { key: 'prices:kraken', state: 'synced', lastSuccessAt: new Date('2026-10-10T12:00:00Z') },
        { key: 'fx:cbr', state: 'failed', lastSuccessAt: null },
      ],
      wallets: [],
    }).collect();
    expect(
      await value('ct_source_last_success_timestamp_seconds', { source: 'prices:kraken' }),
    ).toBe(Date.parse('2026-10-10T12:00:00Z') / 1000);
    expect(await value('ct_source_state', { source: 'fx:cbr', state: 'failed' })).toBe(1);
    expect(await value('ct_source_state', { source: 'fx:cbr', state: 'synced' })).toBe(0);
    expect(await value('ct_dependency_up', { dependency: 'postgres' })).toBe(1);
    expect(await value('ct_database_size_bytes', {})).toBe(123456);
  });

  it('OBS-SRC-2 counts wallets per network and state with explicit zeros, never per address', async () => {
    await collector({
      sources: [],
      wallets: [
        {
          network: 'ethereum',
          state: 'failed',
          count: 1,
          oldest: new Date('2026-10-10T10:00:00Z'),
        },
        {
          network: 'ethereum',
          state: 'synced',
          count: 2,
          oldest: new Date('2026-10-10T11:00:00Z'),
        },
      ],
    }).collect();
    expect(await value('ct_wallets', { network: 'ethereum', state: 'failed' })).toBe(1);
    expect(await value('ct_wallets', { network: 'ethereum', state: 'synced' })).toBe(2);
    expect(await value('ct_wallets', { network: 'ethereum', state: 'pending' })).toBe(0);
    expect(await value('ct_wallet_oldest_success_timestamp_seconds', { network: 'ethereum' })).toBe(
      Date.parse('2026-10-10T10:00:00Z') / 1000,
    );
    const labels = (await registry.getMetricsAsJSON())
      .filter((metric) => metric.name.startsWith('ct_wallet'))
      .flatMap((metric) => metric.values.flatMap((entry) => Object.keys(entry.labels)));
    expect(new Set(labels)).toEqual(new Set(['network', 'state']));
  });

  it('OBS-DEP-1 marks the database down instead of failing the scrape', async () => {
    await collector(new Error('connection refused')).collect();
    expect(await value('ct_dependency_up', { dependency: 'postgres' })).toBe(0);
  });

  it('OBS-DEP-2 reports Redis and the connection pool', async () => {
    await collector({ sources: [], wallets: [] }, false).collect();
    expect(await value('ct_dependency_up', { dependency: 'redis' })).toBe(0);
    expect(await value('ct_db_pool_connections', { state: 'waiting' })).toBe(1);
    expect(await value('ct_db_pool_connections', { state: 'total' })).toBe(4);
  });
});
