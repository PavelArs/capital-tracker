import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { BrokerPriceSyncService } from '../brokers/broker-price-sync.service';
import { FxRatesService } from '../fx-rates/fx-rates.service';
import { InflationService } from '../inflation/inflation.service';
import { PricesService } from '../prices/prices.service';
import { WalletSyncService } from '../wallet-addresses/wallet-sync.service';
import { recordSource } from './sync-source';

describe('recordSource', () => {
  const at = new Date('2026-10-30T09:00:00Z');
  const stored = (query: jest.Mock) => query.mock.calls[0][1][6];

  it('cuts a long failure text to the 300 characters sync_sources."errorMessage" holds', async () => {
    // About 50 unlisted Bybit codes make a message far longer than the column.
    const codes = Array.from({ length: 50 }, (_, i) => `SYNTHETICCOIN${i}`).join(', ');
    const message = `Bybit has no USDT market for ${codes}`;
    const query = jest.fn().mockResolvedValue(undefined);
    await recordSource(
      { query },
      'prices:bybit',
      { state: 'delayed', errorCode: 'missing_assets', errorMessage: message, nextRunAt: null },
      at,
    );
    expect(message.length).toBeGreaterThan(300);
    expect(stored(query)).toBe(message.slice(0, 300));
  });

  it('keeps an absent failure text absent', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await recordSource(
      { query },
      'prices:bybit',
      { state: 'synced', errorCode: null, errorMessage: null, nextRunAt: null },
      at,
    );
    expect(stored(query)).toBeNull();
  });
});

// SYNC-RUN-LOCK characterization: each scheduled collector runs one at a time under its own
// transaction-scoped advisory lock on a dedicated connection; the due check runs under the lock
// on the pool; the lock is always rolled back and the connection released. Synthetic stubs only.
const LOCK_SQL = 'SELECT pg_try_advisory_xact_lock($1) AS locked';
// Past the first five minutes of the hour, so the hourly collectors may be due.
const now = new Date('2026-10-20T12:10:00.000Z');
const config = {
  get: (key: string) => (key === 'PRICE_COLLECTION_ENABLED' ? 'true' : undefined),
} as unknown as ConfigService;

function lockedSource(locked: boolean, answer: (sql: string) => unknown[] = () => []) {
  const calls: unknown[][] = [];
  const runner = {
    connect: async () => void calls.push(['connect']),
    startTransaction: async () => void calls.push(['startTransaction']),
    query: async (sql: string, params: unknown[]) => {
      calls.push(['runner', sql, params]);
      return [{ locked }];
    },
    rollbackTransaction: async () => void calls.push(['rollbackTransaction']),
    release: async () => void calls.push(['release']),
  };
  const source = {
    createQueryRunner: () => {
      calls.push(['createQueryRunner']);
      return runner;
    },
    query: async (sql: string, params: unknown[]) => {
      calls.push(['source', sql, params]);
      return answer(sql);
    },
  } as unknown as DataSource;
  return { source, calls };
}

/** Stands in for a step of the run, noting when it ran. */
function stub(service: object, method: string, calls: unknown[][], value: unknown) {
  return jest
    .spyOn(service as Record<string, (...args: unknown[]) => Promise<unknown>>, method)
    .mockImplementation(async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return value;
    });
}

const opened = (key: number) => [
  ['createQueryRunner'],
  ['connect'],
  ['startTransaction'],
  ['runner', LOCK_SQL, [key]],
];
const closed = [['rollbackTransaction'], ['release']];

const builds = {
  fx: (source: DataSource) => new FxRatesService(source, config, {} as never),
  inflation: (source: DataSource) => new InflationService(source, config, {} as never),
  prices: (source: DataSource) =>
    new PricesService(source, config, {} as never, {} as never, {} as never),
  wallets: (source: DataSource) => new WalletSyncService(source, config, []),
  'broker-prices': (source: DataSource) =>
    new BrokerPriceSyncService(source, config, {} as never, {} as never),
};

describe.each([
  ['fx', 7_340_600_002],
  ['inflation', 7_340_600_021],
  ['prices', 7_340_600_001],
  ['wallets', 7_340_600_011],
  ['broker-prices', 7_340_600_031],
] as const)('SYNC-RUN-LOCK: the %s tick', (name, key) => {
  it('SYNC-RUN-LOCK reports busy and touches nothing else while another run holds its lock', async () => {
    const { source, calls } = lockedSource(false);
    await expect(builds[name](source).tick(now)).resolves.toEqual({ outcome: 'busy' });
    expect(calls).toEqual([...opened(key), ...closed]);
  });

  it('SYNC-RUN-LOCK rolls the lock back and releases the connection when the run throws', async () => {
    const { source, calls } = lockedSource(true, () => {
      throw new Error('synthetic database failure');
    });
    await expect(builds[name](source).tick(now)).rejects.toThrow('synthetic database failure');
    expect(calls.slice(0, 4)).toEqual(opened(key));
    expect(calls.slice(-2)).toEqual(closed);
    expect(calls).toHaveLength(7);
  });
});

describe('SYNC-RUN-LOCK: the due checks under the lock', () => {
  const recent = new Date('2026-10-20T12:06:00.000Z');
  const FX_DUE = 'SELECT "lastAttemptAt" AS at FROM sync_sources WHERE key = $1';
  const INFLATION_DUE = 'SELECT "nextRunAt" AS at FROM sync_sources WHERE key = $1';
  const PRICES_DUE = `SELECT max("lastAttemptAt") AS at FROM sync_sources WHERE key = ANY($1)`;
  const BROKER_DUE = 'SELECT "lastAttemptAt" FROM sync_sources WHERE key = $1';

  it('SYNC-RUN-LOCK fx skips a run when this hour already had one', async () => {
    const { source, calls } = lockedSource(true, () => [{ at: recent }]);
    const service = builds.fx(source);
    const work = stub(service, 'collectRates', calls, 5);
    await expect(service.tick(now)).resolves.toEqual({ outcome: 'not_due' });
    expect(work).not.toHaveBeenCalled();
    expect(calls).toEqual([...opened(7_340_600_002), ['source', FX_DUE, ['fx:cbr']], ...closed]);
  });

  it('SYNC-RUN-LOCK fx collects under the lock when due, and without the check on demand', async () => {
    const { source, calls } = lockedSource(true, () => []);
    const service = builds.fx(source);
    stub(service, 'collectRates', calls, 5);
    await expect(service.tick(now)).resolves.toEqual({ outcome: 'collected', stored: 5 });
    expect(calls).toEqual([
      ...opened(7_340_600_002),
      ['source', FX_DUE, ['fx:cbr']],
      ['collectRates', now],
      ...closed,
    ]);
    calls.length = 0;
    await expect(service.collect(now)).resolves.toEqual({ outcome: 'collected', stored: 5 });
    expect(calls).toEqual([...opened(7_340_600_002), ['collectRates', now], ...closed]);
  });

  it('SYNC-RUN-LOCK inflation skips a run until its next run time has passed', async () => {
    const { source, calls } = lockedSource(true, () => [
      { at: new Date('2026-10-20T12:10:00.001Z') },
    ]);
    const service = builds.inflation(source);
    const work = stub(service, 'collectMonths', calls, 3);
    await expect(service.tick(now)).resolves.toEqual({ outcome: 'not_due' });
    expect(work).not.toHaveBeenCalled();
    expect(calls).toEqual([
      ...opened(7_340_600_021),
      ['source', INFLATION_DUE, ['fx:inflation']],
      ...closed,
    ]);
  });

  it('SYNC-RUN-LOCK inflation collects under the lock at its next run time, and on demand', async () => {
    const { source, calls } = lockedSource(true, () => [{ at: now }]);
    const service = builds.inflation(source);
    stub(service, 'collectMonths', calls, 3);
    await expect(service.tick(now)).resolves.toEqual({ outcome: 'collected', stored: 3 });
    expect(calls).toEqual([
      ...opened(7_340_600_021),
      ['source', INFLATION_DUE, ['fx:inflation']],
      ['collectMonths', now],
      ...closed,
    ]);
    calls.length = 0;
    await expect(service.collect(now)).resolves.toEqual({ outcome: 'collected', stored: 3 });
    expect(calls).toEqual([...opened(7_340_600_021), ['collectMonths', now], ...closed]);
  });

  it('SYNC-RUN-LOCK prices skips a run when either provider was asked this hour', async () => {
    const { source, calls } = lockedSource(true, () => [{ at: recent }]);
    const service = builds.prices(source);
    const work = stub(service, 'backfill', calls, 2);
    await expect(service.tick(now)).resolves.toEqual({ outcome: 'not_due' });
    expect(work).not.toHaveBeenCalled();
    expect(calls).toEqual([
      ...opened(7_340_600_001),
      ['source', PRICES_DUE, [['prices:kraken', 'prices:coingecko']]],
      ...closed,
    ]);
  });

  it('SYNC-RUN-LOCK prices runs its four steps under the lock when due, and on demand', async () => {
    const { source, calls } = lockedSource(true, () => [{ at: null }]);
    const service = builds.prices(source);
    stub(service, 'backfill', calls, 2);
    stub(service, 'collectLatest', calls, 3);
    stub(service, 'collectBybit', calls, { stored: 4, backfilled: 1 });
    stub(service, 'collectTokens', calls, 5);
    const steps = [
      ['backfill', now],
      ['collectLatest', now],
      ['collectBybit', now],
      ['collectTokens', now],
    ];
    const collected = { outcome: 'collected', stored: 12, backfilled: 3 };
    await expect(service.tick(now)).resolves.toEqual(collected);
    expect(calls).toEqual([
      ...opened(7_340_600_001),
      ['source', PRICES_DUE, [['prices:kraken', 'prices:coingecko']]],
      ...steps,
      ...closed,
    ]);
    calls.length = 0;
    await expect(service.collect(now)).resolves.toEqual(collected);
    expect(calls).toEqual([...opened(7_340_600_001), ...steps, ...closed]);
  });

  it('SYNC-RUN-LOCK broker prices skip a refresh when this hour already had one', async () => {
    const { source, calls } = lockedSource(true, () => [{ lastAttemptAt: recent }]);
    const service = builds['broker-prices'](source);
    const work = stub(service, 'refresh', calls, null);
    await expect(service.tick(now)).resolves.toEqual({ outcome: 'not_due' });
    expect(work).not.toHaveBeenCalled();
    expect(calls).toEqual([
      ...opened(7_340_600_031),
      ['source', BROKER_DUE, ['prices:tbank']],
      ...closed,
    ]);
  });

  it('SYNC-RUN-LOCK broker prices refresh under the lock when due', async () => {
    const { source, calls } = lockedSource(true, () => []);
    const service = builds['broker-prices'](source);
    const ran = { outcome: 'ran', accounts: 2, failed: 0, saved: 4, closes: 1 };
    stub(service, 'refresh', calls, ran);
    await expect(service.tick(now)).resolves.toEqual(ran);
    expect(calls).toEqual([
      ...opened(7_340_600_031),
      ['source', BROKER_DUE, ['prices:tbank']],
      ['refresh', now],
      ...closed,
    ]);
  });

  it('SYNC-RUN-LOCK wallets run each due wallet still switched on under the lock', async () => {
    const DUE_WALLETS = `SELECT a.id, a."ownerId", a.network FROM wallet_addresses a
            LEFT JOIN sync_sources s ON s.key = 'wallet:' || a.id::text
            WHERE a."removedAt" IS NULL AND a."syncDisabledAt" IS NULL
              AND (s.key IS NULL OR s."nextRunAt" IS NULL OR s."nextRunAt" <= $1)
            ORDER BY s."nextRunAt" ASC NULLS FIRST, a."createdAt", a.id LIMIT $2`;
    const STILL_ON = `SELECT 1 FROM wallet_addresses
              WHERE id = $1 AND "removedAt" IS NULL AND "syncDisabledAt" IS NULL`;
    const due = ['w1', 'w2', 'w3'].map((id) => ({ id, ownerId: 'o1', network: 'optimism' }));
    let checked = 0;
    const { source, calls } = lockedSource(true, (sql) => {
      if (sql === DUE_WALLETS) return due;
      // The second wallet was switched off while the first one ran.
      return ++checked === 2 ? [] : [{ '?column?': 1 }];
    });
    const service = builds.wallets(source);
    const results: unknown[] = [{ state: 'synced' }, 'busy'];
    jest.spyOn(service, 'run').mockImplementation(async (...args) => {
      calls.push(['run', ...args]);
      return results.shift() as 'busy';
    });
    await expect(service.tick(now)).resolves.toEqual({
      outcome: 'ran',
      wallets: [
        { id: 'w1', state: 'synced' },
        { id: 'w3', state: 'busy' },
      ],
    });
    expect(calls).toEqual([
      ...opened(7_340_600_011),
      ['source', DUE_WALLETS, [now, 20]],
      ['source', STILL_ON, ['w1']],
      ['run', due[0], now, true],
      ['source', STILL_ON, ['w2']],
      ['source', STILL_ON, ['w3']],
      ['run', due[2], now, true],
      ...closed,
    ]);
  });
});
