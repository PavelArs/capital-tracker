import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { MARKET_ASSETS, QUOTE_CURRENCY } from './price-catalog';
import { type SourceOutcome, freshness, gatherQuotes, isDue, nextRunAt } from './price-collection';
import { CoinGeckoClient, KrakenClient, type PriceFailure, type Quote } from './price-providers';

export type CollectionResult =
  | { outcome: 'collected'; stored: number; backfilled: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

// Owner decision Q4: the chart history starts on 1 January 2025.
export const BACKFILL_FROM = new Date('2025-01-01T00:00:00Z');
const BACKFILL_KEY = 'prices:backfill';
const PROVIDER_KEYS = { kraken: 'prices:kraken', coingecko: 'prices:coingecko' } as const;
// Arbitrary constant identifying the price collector's session advisory lock.
const LOCK_KEY = 7_340_600_001;
const INTERRUPTED_AFTER_MS = 15 * 60_000;
const INSERT_BATCH = 1000;

interface SourceRow {
  key: string;
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}
interface LatestRow {
  asset: string;
  price: string;
  observedAt: Date;
  source: string;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;
// numeric(78,30) text without trailing zeros.
const exact = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    private readonly kraken: KrakenClient,
    private readonly coingecko: CoinGeckoClient,
  ) {}

  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  // Interval jobs stay registered when BACKGROUND_JOBS_ENABLED=false disables cron jobs;
  // this one has its own explicit switch.
  @Interval(5 * 60_000)
  async scheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch {
      this.logger.warn('Hourly price collection could not finish');
    }
  }

  async tick(now = new Date()): Promise<CollectionResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    const [row]: { at: Date | null }[] = await this.source.query(
      `SELECT max("lastAttemptAt") AS at FROM sync_sources WHERE key = ANY($1)`,
      [Object.values(PROVIDER_KEYS)],
    );
    if (!isDue(row?.at ?? null, now)) return { outcome: 'not_due' };
    return this.collect(now);
  }

  async collect(now = new Date()): Promise<CollectionResult> {
    // A session advisory lock held on one dedicated connection: one run at a time.
    const runner = this.source.createQueryRunner();
    await runner.connect();
    try {
      const [lock]: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [LOCK_KEY],
      );
      if (!lock.locked) return { outcome: 'busy' };
      try {
        const backfilled = await this.backfill(now);
        const stored = await this.collectLatest(now);
        return { outcome: 'collected', stored, backfilled };
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }

  private async collectLatest(now: Date): Promise<number> {
    const { quotes, outcomes } = await gatherQuotes(now, MARKET_ASSETS, {
      kraken: this.kraken,
      coingecko: this.coingecko,
    });
    return this.source.transaction(async (manager) => {
      const stored = await this.insert(manager, quotes);
      for (const [provider, outcome] of Object.entries(outcomes)) {
        await this.record(
          manager,
          PROVIDER_KEYS[provider as keyof typeof PROVIDER_KEYS],
          outcome,
          now,
        );
      }
      return stored;
    });
  }

  // Kraken daily candles from 2025-01-01, until every catalog asset succeeded once.
  private async backfill(now: Date): Promise<number> {
    const [state]: SourceRow[] = await this.source.query(
      'SELECT * FROM sync_sources WHERE key = $1',
      [BACKFILL_KEY],
    );
    if (state?.lastSuccessAt) return 0;
    const done: { asset: string }[] = await this.source.query(
      `SELECT DISTINCT asset FROM price_observations
       WHERE kind = 'daily-close' AND source = 'kraken' AND "quoteCurrency" = $1`,
      [QUOTE_CURRENCY],
    );
    const complete = new Set(done.map(({ asset }) => asset));
    const quotes: Quote[] = [];
    const failed: string[] = [];
    let reason: PriceFailure | null = null;
    for (const asset of MARKET_ASSETS) {
      if (complete.has(asset.code)) continue;
      const result = await this.kraken.daily(asset, BACKFILL_FROM, now);
      if (result.ok) quotes.push(...result.quotes);
      else {
        failed.push(asset.code);
        reason ??= result.reason;
      }
    }
    return this.source.transaction(async (manager) => {
      const stored = await this.insert(manager, quotes);
      await this.record(
        manager,
        BACKFILL_KEY,
        failed.length
          ? {
              state: 'failed',
              errorCode: reason,
              errorMessage: `No history for ${failed.join(', ')}`,
            }
          : { state: 'synced', errorCode: null, errorMessage: null },
        now,
        null,
      );
      return stored;
    });
  }

  private async insert(manager: EntityManager, quotes: Quote[]): Promise<number> {
    let stored = 0;
    for (let start = 0; start < quotes.length; start += INSERT_BATCH) {
      const batch = quotes.slice(start, start + INSERT_BATCH);
      const rows: unknown[] = await manager.query(
        `INSERT INTO price_observations (asset, "quoteCurrency", source, "observedAt", price, kind)
         SELECT asset, $1, source, "observedAt", price, kind
         FROM unnest($2::text[], $3::text[], $4::timestamptz[], $5::numeric[], $6::text[])
           AS q(asset, source, "observedAt", price, kind)
         ON CONFLICT DO NOTHING RETURNING asset`,
        [
          QUOTE_CURRENCY,
          batch.map(({ asset }) => asset),
          batch.map(({ source }) => source),
          batch.map(({ observedAt }) => observedAt),
          batch.map(({ price }) => price),
          batch.map(({ kind }) => kind),
        ],
      );
      stored += rows.length;
    }
    return stored;
  }

  private async record(
    manager: EntityManager,
    key: string,
    outcome: SourceOutcome,
    now: Date,
    next: Date | null = nextRunAt(now),
  ): Promise<void> {
    const succeeded = outcome.state === 'synced';
    await manager.query(
      `INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt", "errorCode", "errorMessage")
       VALUES ($1, $2, $3, CASE WHEN $4 THEN $3::timestamptz END, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state,
         "lastAttemptAt" = EXCLUDED."lastAttemptAt",
         "lastSuccessAt" = COALESCE(EXCLUDED."lastSuccessAt", sync_sources."lastSuccessAt"),
         "nextRunAt" = EXCLUDED."nextRunAt", "errorCode" = EXCLUDED."errorCode",
         "errorMessage" = EXCLUDED."errorMessage"`,
      [key, outcome.state, now, succeeded, next, outcome.errorCode, outcome.errorMessage],
    );
  }

  async read(now = new Date()) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      // Valuation rule: the latest observation at or before the instant, from any source.
      const latest: LatestRow[] = await manager.query(
        `SELECT DISTINCT ON (asset) asset, price::text AS price, "observedAt", source
         FROM price_observations
         WHERE asset = ANY($1) AND "quoteCurrency" = $2 AND "observedAt" <= $3
         ORDER BY asset, "observedAt" DESC, source`,
        [MARKET_ASSETS.map(({ code }) => code), QUOTE_CURRENCY, now],
      );
      const sources: SourceRow[] = await manager.query(
        `SELECT * FROM sync_sources WHERE key LIKE 'prices:%' ORDER BY key`,
      );
      const byAsset = new Map(latest.map((row) => [row.asset, row]));
      return {
        quoteCurrency: QUOTE_CURRENCY,
        assets: MARKET_ASSETS.map(({ code }) => {
          const row = byAsset.get(code);
          const observedAt = row ? row.observedAt.toISOString() : null;
          return {
            asset: code,
            price: row ? exact(row.price) : null,
            quoteCurrency: QUOTE_CURRENCY,
            observedAt,
            source: row?.source ?? null,
            status: freshness(observedAt, now),
          };
        }),
        sources: sources.map((row) => {
          const interrupted =
            row.state === 'syncing' &&
            (!row.lastAttemptAt ||
              now.getTime() - row.lastAttemptAt.getTime() > INTERRUPTED_AFTER_MS);
          return {
            key: row.key,
            state: interrupted ? 'failed' : row.state,
            lastAttemptAt: iso(row.lastAttemptAt),
            lastSuccessAt: iso(row.lastSuccessAt),
            nextRunAt: iso(row.nextRunAt),
            errorCode: interrupted ? 'interrupted' : row.errorCode,
            errorMessage: interrupted ? 'Collection stopped before it finished' : row.errorMessage,
          };
        }),
      };
    });
  }
}
