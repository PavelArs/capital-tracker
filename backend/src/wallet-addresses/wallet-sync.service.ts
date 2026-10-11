import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ChainClassificationService } from '../accounting/chain-classification.service';
import { recordWalletSync, startTimer, trackJob } from '../observability/metrics';
import { INTERRUPTED_AFTER_MS, recordSource } from '../sync-status/sync-source';
import { isNetwork, networkNames } from './chain-assets';
import {
  CHAIN_SYNC_ADAPTERS,
  type ChainSyncAdapter,
  outcomeOf,
  type SourceOutcome,
  type StepResult,
  walletSourceKey,
} from './chain-sync';
import { journalSync } from './sync-journal';

export type WalletTickResult =
  | { outcome: 'ran'; wallets: { id: string; state: SourceOutcome['state'] | 'busy' }[] }
  | { outcome: 'busy' | 'disabled' };

// Arbitrary constant identifying the wallet scheduler's session advisory lock.
const LOCK_KEY = 7_340_600_011;
// Wallets per tick; the rest wait for the next minute.
const WALLETS_PER_TICK = 20;

interface DueWallet {
  id: string;
  ownerId: string;
  network: string;
}

@Injectable()
export class WalletSyncService {
  private readonly logger = new Logger(WalletSyncService.name);
  private readonly adapters: Map<string, ChainSyncAdapter>;

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    @Inject(CHAIN_SYNC_ADAPTERS) adapters: ChainSyncAdapter[],
    @Optional() private readonly classifications?: ChainClassificationService,
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.network, adapter]));
  }

  // Background collection is one owner switch: wallets follow the hourly prices (M3).
  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  // Interval jobs stay registered when BACKGROUND_JOBS_ENABLED=false disables cron jobs;
  // this one follows the collection switch above.
  @Interval(60_000)
  async scheduledTick(): Promise<void> {
    try {
      await trackJob('wallets', () => this.tick());
    } catch {
      this.logger.warn('Background wallet sync could not finish');
    }
  }

  async tick(now = new Date()): Promise<WalletTickResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    return this.runDue(now);
  }

  // SYNC-BG, SYNC-ISOLATION: every due wallet gets one pass; a wallet whose provider fails
  // or whose adapter throws records its own failure and the next wallet still runs.
  async runDue(now = new Date()): Promise<WalletTickResult> {
    // A transaction-scoped advisory lock on a dedicated connection: one scheduler at a time,
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
        const due: DueWallet[] = await this.source.query(
          `SELECT a.id, a."ownerId", a.network FROM wallet_addresses a
            LEFT JOIN sync_sources s ON s.key = 'wallet:' || a.id::text
            WHERE a."removedAt" IS NULL
              AND (s.key IS NULL OR s."nextRunAt" IS NULL OR s."nextRunAt" <= $1)
            ORDER BY s."nextRunAt" ASC NULLS FIRST, a."createdAt", a.id LIMIT $2`,
          [now, WALLETS_PER_TICK],
        );
        const wallets: { id: string; state: SourceOutcome['state'] | 'busy' }[] = [];
        for (const wallet of due) {
          const result = await this.run(wallet, now);
          wallets.push({ id: wallet.id, state: result === 'busy' ? 'busy' : result.state });
        }
        return { outcome: 'ran', wallets };
      } finally {
        await runner.rollbackTransaction();
      }
    } finally {
      await runner.release();
    }
  }

  /**
   * One pass for one wallet, its state recorded before and after. "busy" means another
   * pass of the same wallet is committing; that pass records the state.
   */
  async run(
    wallet: DueWallet,
    now = new Date(),
  ): Promise<(SourceOutcome & { step: StepResult | null }) | 'busy'> {
    const startedAt = startTimer();
    const result = await this.runPass(wallet, now);
    recordWalletSync(wallet.network, result === 'busy' ? 'busy' : result.state, startedAt);
    return result;
  }

  private async runPass(
    wallet: DueWallet,
    now: Date,
  ): Promise<(SourceOutcome & { step: StepResult | null }) | 'busy'> {
    const key = walletSourceKey(wallet.id);
    const adapter = this.adapters.get(wallet.network);
    const name =
      adapter?.name ?? (isNetwork(wallet.network) ? networkNames[wallet.network] : wallet.network);
    if (!adapter) {
      const outcome = outcomeOf(name, { failure: 'unsupported' }, now);
      await this.record(key, outcome, now);
      await this.journal(wallet, outcome, null, now);
      return { ...outcome, step: null };
    }
    // Leased while it runs: the scheduler leaves it alone until the pass ends or dies.
    await this.record(
      key,
      {
        state: 'syncing',
        errorCode: null,
        errorMessage: null,
        nextRunAt: new Date(now.getTime() + INTERRUPTED_AFTER_MS),
      },
      now,
    );
    let step: StepResult;
    try {
      step = await adapter.step(wallet.ownerId, wallet.id);
    } catch (error) {
      if (error instanceof ConflictException) return 'busy';
      this.logger.warn(`${name} wallet sync stopped unexpectedly`);
      const outcome = outcomeOf(name, { failure: 'error' }, now);
      await this.record(key, outcome, now);
      await this.journal(wallet, outcome, null, now);
      return { ...outcome, step: null };
    }
    const outcome = outcomeOf(name, step, now);
    await this.record(key, outcome, now);
    await this.journal(wallet, outcome, step, now);
    // D7, XFER-AUTO: what this pass stored may complete a transfer between own wallets.
    if (step.outcome !== 'provider_error') await this.linkOwnTransfers(wallet.ownerId);
    return { ...outcome, step };
  }

  /** Links the owner's certain own transfers; a failure never fails the sync. */
  async linkOwnTransfers(ownerId: string): Promise<void> {
    await this.classifications?.linkQuietly(ownerId);
  }

  private record(key: string, outcome: SourceOutcome, now: Date): Promise<void> {
    return recordSource(this.source, key, outcome, now);
  }

  /** SYNC-JOURNAL: a failed write never fails the sync it describes. */
  private async journal(
    wallet: DueWallet,
    outcome: SourceOutcome,
    step: StepResult | null,
    now: Date,
  ): Promise<void> {
    try {
      await journalSync(this.source, wallet, outcome, step, now);
    } catch {
      this.logger.warn('The sync journal could not be written');
    }
  }
}
