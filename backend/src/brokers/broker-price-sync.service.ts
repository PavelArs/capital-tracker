import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { errorMessage, trackJob } from '../observability/metrics';
import { isDue, nextRunAt } from '../prices/price-collection';
import { INTERRUPTED_AFTER_MS, recordSource } from '../sync-status/sync-source';
import { BrokerConnectionsService, NO_HOLDINGS } from './broker-connections.service';
import {
  type BrokerPrice,
  insertBrokerPrices,
  lowestPrices,
  readBrokerPrices,
} from './broker-prices';

export type BrokerPriceTick =
  | { outcome: 'ran'; accounts: number; failed: number; saved: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

export const BROKER_PRICES_KEY = 'prices:tbank';
// Arbitrary constant identifying the broker price refresh's session advisory lock.
const LOCK_KEY = 7_340_600_021;

/** Why one account gave no prices, as a sync source error code. */
function failureCode(error: unknown): string {
  if (!(error instanceof HttpException)) return 'error';
  const status = error.getStatus();
  if (status === 503) return 'unavailable';
  if (status === 404) return 'not_connected';
  if (status === 422) return 'rejected';
  return 'error';
}

/**
 * BPR-2: once an hour, the current price T-Bank reports for each security held in each connected
 * account, read with the saved read-only token. One account's failure never stops the others.
 */
@Injectable()
export class BrokerPriceSyncService {
  private readonly logger = new Logger(BrokerPriceSyncService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    private readonly connections: BrokerConnectionsService,
  ) {}

  // Background collection is one owner switch: broker prices follow the hourly prices (M3).
  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  // Interval jobs stay registered when BACKGROUND_JOBS_ENABLED=false disables cron jobs;
  // this one follows the collection switch above.
  @Interval(5 * 60_000)
  async scheduledTick(): Promise<void> {
    try {
      await trackJob('broker-prices', () => this.tick());
    } catch (error) {
      this.logger.warn(`T-Bank price refresh could not finish: ${errorMessage(error)}`);
    }
  }

  async tick(now = new Date()): Promise<BrokerPriceTick> {
    if (!this.enabled) return { outcome: 'disabled' };
    // A transaction-scoped advisory lock on a dedicated connection: one refresh at a time,
    // released by the rollback below or by the connection ending, never left behind.
    const runner = this.source.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      try {
        const [lock]: { locked: boolean }[] = await runner.query(
          'SELECT pg_try_advisory_xact_lock($1) AS locked',
          [LOCK_KEY],
        );
        if (!lock.locked) return { outcome: 'busy' };
        // Checked under the lock so a run that just finished elsewhere is not repeated.
        const [row]: { lastAttemptAt: Date | null }[] = await this.source.query(
          'SELECT "lastAttemptAt" FROM sync_sources WHERE key = $1',
          [BROKER_PRICES_KEY],
        );
        if (!isDue(row?.lastAttemptAt ?? null, now)) return { outcome: 'not_due' };
        return await this.refresh(now);
      } finally {
        await runner.rollbackTransaction();
      }
    } finally {
      await runner.release();
    }
  }

  /** One pass over every T-Bank connection of a live broker account. */
  async refresh(now = new Date()): Promise<BrokerPriceTick> {
    await recordSource(
      this.source,
      BROKER_PRICES_KEY,
      {
        state: 'syncing',
        errorCode: null,
        errorMessage: null,
        nextRunAt: new Date(now.getTime() + INTERRUPTED_AFTER_MS),
      },
      now,
    );
    const connected: { ownerId: string; accountId: string }[] = await this.source.query(
      `SELECT c."ownerId", c."accountId" FROM broker_connections c
        JOIN manual_accounts a ON a."ownerId" = c."ownerId" AND a.id = c."accountId"
        WHERE c.provider = 'tbank' AND a."removedAt" IS NULL
        ORDER BY c."ownerId", c."accountId"`,
    );
    const failures: { code: string; message: string }[] = [];
    // Each owner's prices from all accounts, so one asset held twice keeps the lower price.
    const read = new Map<string, BrokerPrice[]>();
    for (const { ownerId, accountId } of connected) {
      try {
        const history = await this.connections.history(ownerId, accountId, true);
        const result = await this.source.transaction((manager) =>
          readBrokerPrices(manager, ownerId, history),
        );
        if (result === 'conflict')
          failures.push({
            code: 'conflict',
            message: 'T-Bank names a security differently from the saved links',
          });
        else read.set(ownerId, [...(read.get(ownerId) ?? []), ...result]);
      } catch (error) {
        // A closed account holds nothing T-Bank can price.
        if (error instanceof HttpException && error.message === NO_HOLDINGS) continue;
        const code = failureCode(error);
        failures.push({
          code,
          // The owner-facing texts of the connection service never carry the token.
          message: code === 'error' ? 'The refresh stopped unexpectedly' : (error as Error).message,
        });
      }
    }
    let saved = 0;
    for (const [ownerId, prices] of read)
      saved += await this.source.transaction((manager) =>
        insertBrokerPrices(manager, ownerId, lowestPrices(prices), now),
      );
    const [first] = failures;
    await recordSource(
      this.source,
      BROKER_PRICES_KEY,
      first
        ? {
            state: 'failed',
            errorCode: first.code,
            errorMessage:
              `T-Bank prices of ${failures.length} of ${connected.length} accounts were not read: ${first.message}`.slice(
                0,
                300,
              ),
            nextRunAt: nextRunAt(now),
          }
        : { state: 'synced', errorCode: null, errorMessage: null, nextRunAt: nextRunAt(now) },
      now,
    );
    return { outcome: 'ran', accounts: connected.length, failed: failures.length, saved };
  }
}
