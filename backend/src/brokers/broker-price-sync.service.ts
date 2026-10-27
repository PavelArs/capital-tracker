import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { readSplits } from '../accounting/share-split.store';
import { moscowDate } from '../fx-rates/fx-conversion';
import { errorMessage, trackJob } from '../observability/metrics';
import { isDue, nextRunAt, RUN_OFFSET_MS } from '../prices/price-collection';
import { INTERRUPTED_AFTER_MS, recordSource } from '../sync-status/sync-source';
import { BrokerConnectionsService, NO_HOLDINGS } from './broker-connections.service';
import {
  closeInstant,
  closeObservations,
  PRICE_HISTORY_FROM,
  settledCloses,
} from './broker-price-history';
import {
  type BrokerPrice,
  insertBrokerPrices,
  insertObservations,
  lowestPrices,
  readBrokerPrices,
} from './broker-prices';
import { TBankClient } from './tbank-client';

export type BrokerPriceTick =
  | { outcome: 'ran'; accounts: number; failed: number; saved: number; closes: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

export const BROKER_PRICES_KEY = 'prices:tbank';
/** BPH-BACKFILL: when the day closes were last read in full; not shown to the owner itself. */
export const BROKER_HISTORY_KEY = 'prices:tbank-history';
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

/** Why a read failed, as a sync source error; the connection texts never carry the token. */
function failure(error: unknown): { code: string; message: string } {
  const code = failureCode(error);
  return {
    code,
    message: code === 'error' ? 'The refresh stopped unexpectedly' : (error as Error).message,
  };
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
    private readonly tbank: TBankClient,
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
    const closes = await this.backfill(connected, now);
    return {
      outcome: 'ran',
      accounts: connected.length,
      failed: failures.length,
      saved,
      closes,
    };
  }

  /**
   * BPH-BACKFILL: on the first run of each Moscow day, the close of every
   * complete day since 2025 of each security linked to a T-Bank asset, read with one of the
   * owner's saved tokens. A day T-Bank serves later is filled in on a later day; a close already
   * stored stays as it is. Its outcome is its own source, apart from the current prices; a failed
   * read is tried again the next day, so a security T-Bank never serves costs one read a day.
   * shortcut: rereads the whole range daily (two requests per security), fine for a personal
   * portfolio; read only the missing days if the range or the holdings grow large.
   */
  private async backfill(
    connected: readonly { ownerId: string; accountId: string }[],
    now: Date,
  ): Promise<number> {
    let closes = 0;
    const failures: { code: string; message: string }[] = [];
    try {
      const [row]: { lastAttemptAt: Date | null }[] = await this.source.query(
        'SELECT "lastAttemptAt" FROM sync_sources WHERE key = $1',
        [BROKER_HISTORY_KEY],
      );
      if (row?.lastAttemptAt && moscowDate(row.lastAttemptAt) === moscowDate(now)) return 0;
      const owners = new Map<string, string[]>();
      for (const { ownerId, accountId } of connected)
        owners.set(ownerId, [...(owners.get(ownerId) ?? []), accountId]);
      for (const [ownerId, accounts] of owners)
        closes += await this.ownerHistory(ownerId, accounts, now, failures);
    } catch (error) {
      failures.push(failure(error));
    }
    const [first] = failures;
    await recordSource(
      this.source,
      BROKER_HISTORY_KEY,
      first
        ? {
            state: 'failed',
            errorCode: first.code,
            errorMessage:
              `${failures.length} reads of past T-Bank prices failed: ${first.message}`.slice(
                0,
                300,
              ),
            nextRunAt: new Date(closeInstant(moscowDate(now)).getTime() + 1 + RUN_OFFSET_MS),
          }
        : { state: 'synced', errorCode: null, errorMessage: null, nextRunAt: null },
      now,
    );
    return closes;
  }

  /**
   * BPH-BACKFILL: one owner's day closes; returns how many were new. A security T-Bank gives no
   * closes for is noted and the others are still read.
   */
  private async ownerHistory(
    ownerId: string,
    accounts: readonly string[],
    now: Date,
    failures: { code: string; message: string }[],
  ): Promise<number> {
    // Market data is the same through any account's token: the first that still works.
    let token: string | undefined;
    let lastError: unknown;
    for (const accountId of accounts) {
      try {
        token = await this.connections.marketToken(ownerId, accountId);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (token === undefined) {
      failures.push(failure(lastError));
      return 0;
    }
    const links: { uid: string; instrumentId: string }[] = await this.source.query(
      `SELECT "providerInstrumentId" AS uid, "instrumentId" FROM broker_instrument_links
        WHERE "ownerId" = $1 AND provider = 'tbank' ORDER BY "providerInstrumentId"`,
      [ownerId],
    );
    const splits = await readSplits(this.source.manager, ownerId);
    let saved = 0;
    for (const link of links) {
      const history = await this.tbank.dailyCloses(token, link.uid, PRICE_HISTORY_FROM, now);
      if (!history.ok) {
        failures.push(failure(BrokerConnectionsService.failure(history.reason)));
        continue;
      }
      let nominal: { amount: string; currency: string } | null = null;
      if (history.value.currency === 'pt.' && history.value.closes.length > 0) {
        const bond = await this.tbank.bondNominal(token, link.uid);
        if (!bond.ok) {
          failures.push(failure(BrokerConnectionsService.failure(bond.reason)));
          continue;
        }
        nominal = bond.value;
      }
      const rows = settledCloses(
        closeObservations(link.instrumentId, history.value, nominal),
        splits,
        now,
      );
      saved += await this.source.transaction((manager) =>
        insertObservations(manager, ownerId, rows),
      );
    }
    return saved;
  }
}
