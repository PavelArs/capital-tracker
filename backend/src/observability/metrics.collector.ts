import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExchangeRatesCacheService } from '../cache/exchange-rates-cache.service';
import {
  databaseSize,
  dbPool,
  dependencyUp,
  sourceLastSuccess,
  sourceState,
  walletOldestSuccess,
  walletsByState,
} from './metrics';

const SOURCE_STATES = ['synced', 'syncing', 'delayed', 'failed'];
const WALLET_STATES = [...SOURCE_STATES, 'pending'];
// Matches INTERRUPTED_AFTER_MS in sync-status/sync-source.ts: a run that long "syncing" died.
const INTERRUPTED_MINUTES = 15;

interface SourceRow {
  key: string;
  state: string;
  lastSuccessAt: Date | null;
}
interface WalletRow {
  network: string;
  state: string;
  count: number;
  oldest: Date | null;
}
interface PgPool {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/**
 * Fills the scrape-time gauges from the database and Redis. Everything here is read-only and
 * aggregated: no wallet address, id or label ever becomes a metric label.
 */
@Injectable()
export class MetricsCollector {
  private readonly logger = new Logger(MetricsCollector.name);

  constructor(
    private readonly source: DataSource,
    @Optional() private readonly cache?: ExchangeRatesCacheService,
  ) {}

  async collect(): Promise<void> {
    await Promise.all([this.collectDatabase(), this.collectRedis()]);
    this.collectPool();
  }

  private async collectDatabase(): Promise<void> {
    try {
      const sources: SourceRow[] = await this.source.query(
        `SELECT key, state, "lastSuccessAt" FROM sync_sources
          WHERE key IN ('prices:kraken', 'prices:coingecko', 'fx:cbr')`,
      );
      const wallets: WalletRow[] = await this.source.query(
        `SELECT a.network,
            CASE WHEN s.key IS NULL THEN 'pending'
                 WHEN s.state = 'syncing'
                   AND (s."lastAttemptAt" IS NULL
                     OR s."lastAttemptAt" < now() - make_interval(mins => ${INTERRUPTED_MINUTES}))
                   THEN 'failed'
                 ELSE s.state END AS state,
            count(*)::int AS count,
            min(s."lastSuccessAt") AS oldest
          FROM wallet_addresses a
          LEFT JOIN sync_sources s ON s.key = 'wallet:' || a.id::text
          GROUP BY 1, 2`,
      );
      const [{ bytes }]: { bytes: string }[] = await this.source.query(
        'SELECT pg_database_size(current_database()) AS bytes',
      );
      databaseSize.set(Number(bytes));
      dependencyUp.set({ dependency: 'postgres' }, 1);

      sourceLastSuccess.reset();
      sourceState.reset();
      for (const row of sources) {
        if (row.lastSuccessAt) {
          sourceLastSuccess.set({ source: row.key }, row.lastSuccessAt.getTime() / 1000);
        }
        for (const state of SOURCE_STATES) {
          sourceState.set({ source: row.key, state }, row.state === state ? 1 : 0);
        }
      }

      walletsByState.reset();
      walletOldestSuccess.reset();
      const oldest = new Map<string, number>();
      for (const row of wallets) {
        walletsByState.set({ network: row.network, state: row.state }, row.count);
        if (row.oldest) {
          const at = row.oldest.getTime() / 1000;
          oldest.set(row.network, Math.min(at, oldest.get(row.network) ?? at));
        }
      }
      for (const [network, at] of oldest) walletOldestSuccess.set({ network }, at);
      // Every state is present for a network that has wallets, so alerts see explicit zeros.
      for (const network of new Set(wallets.map((row) => row.network))) {
        for (const state of WALLET_STATES) {
          if (!wallets.some((row) => row.network === network && row.state === state)) {
            walletsByState.set({ network, state }, 0);
          }
        }
      }
    } catch (error) {
      dependencyUp.set({ dependency: 'postgres' }, 0);
      this.logger.warn(`Metrics could not read the database: ${(error as Error).name}`);
    }
  }

  private async collectRedis(): Promise<void> {
    if (!this.cache) return;
    dependencyUp.set({ dependency: 'redis' }, (await this.cache.isHealthy()) ? 1 : 0);
  }

  private collectPool(): void {
    const pool = (this.source.driver as unknown as { master?: PgPool }).master;
    if (!pool || typeof pool.totalCount !== 'number') return;
    dbPool.set({ state: 'total' }, pool.totalCount);
    dbPool.set({ state: 'idle' }, pool.idleCount);
    dbPool.set({ state: 'waiting' }, pool.waitingCount);
  }
}
