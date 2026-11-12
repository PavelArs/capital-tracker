import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ChainClassificationService } from '../accounting/chain-classification.service';
import { errorMessage, recordWalletSync, startTimer, trackJob } from '../observability/metrics';
import { INTERRUPTED_AFTER_MS, recordSource, runLocked } from '../sync-status/sync-source';
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
import { passKind, recordPass } from './sync-switch';

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

  // Interval jobs are always registered; PRICE_COLLECTION_ENABLED gates each tick.
  @Interval(60_000)
  async scheduledTick(): Promise<void> {
    try {
      await trackJob('wallets', () => this.tick());
    } catch (error) {
      this.logger.warn(`Background wallet sync could not finish: ${errorMessage(error)}`);
    }
  }

  async tick(now = new Date()): Promise<WalletTickResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    return this.runDue(now);
  }

  // SYNC-BG, SYNC-ISOLATION: every due wallet gets one pass; a wallet whose provider fails
  // or whose adapter throws records its own failure and the next wallet still runs.
  async runDue(now = new Date()): Promise<WalletTickResult> {
    return runLocked(this.source, LOCK_KEY, async () => {
      const due: DueWallet[] = await this.source.query(
        `SELECT a.id, a."ownerId", a.network FROM wallet_addresses a
            LEFT JOIN sync_sources s ON s.key = 'wallet:' || a.id::text
            WHERE a."removedAt" IS NULL AND a."syncDisabledAt" IS NULL
              AND (s.key IS NULL OR s."nextRunAt" IS NULL OR s."nextRunAt" <= $1)
            ORDER BY s."nextRunAt" ASC NULLS FIRST, a."createdAt", a.id LIMIT $2`,
        [now, WALLETS_PER_TICK],
      );
      const wallets: { id: string; state: SourceOutcome['state'] | 'busy' }[] = [];
      for (const wallet of due) {
        // WALLET-SYNC-OFF: the owner may have switched this wallet off while earlier ones ran.
        const [still] = await this.source.query(
          `SELECT 1 FROM wallet_addresses
              WHERE id = $1 AND "removedAt" IS NULL AND "syncDisabledAt" IS NULL`,
          [wallet.id],
        );
        if (!still) continue;
        const result = await this.run(wallet, now, true);
        wallets.push({ id: wallet.id, state: result === 'busy' ? 'busy' : result.state });
      }
      return { outcome: 'ran', wallets };
    });
  }

  /**
   * One pass for one wallet, its state recorded before and after. "busy" means another
   * pass of the same wallet is committing; that pass records the state.
   */
  async run(
    wallet: DueWallet,
    now = new Date(),
    /** WALLET-SYNC-OFF: only the scheduler's own passes add to the run of failures. */
    background = false,
  ): Promise<(SourceOutcome & { step: StepResult | null }) | 'busy'> {
    const startedAt = startTimer();
    const result = await this.runPass(wallet, now, background);
    recordWalletSync(wallet.network, result === 'busy' ? 'busy' : result.state, startedAt);
    return result;
  }

  private async runPass(
    wallet: DueWallet,
    now: Date,
    background: boolean,
  ): Promise<(SourceOutcome & { step: StepResult | null }) | 'busy'> {
    const key = walletSourceKey(wallet.id);
    const adapter = this.adapters.get(wallet.network);
    const name =
      adapter?.name ?? (isNetwork(wallet.network) ? networkNames[wallet.network] : wallet.network);
    if (!adapter) {
      const outcome = outcomeOf(name, { failure: 'unsupported' }, now);
      await this.record(key, outcome, now);
      await this.journal(wallet, outcome, null, now);
      await this.countPass(wallet, outcome, null, now, background);
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
      await this.countPass(wallet, outcome, null, now, background);
      return { ...outcome, step: null };
    }
    const outcome = outcomeOf(name, step, now);
    await this.record(key, outcome, now);
    await this.journal(wallet, outcome, step, now);
    await this.countPass(wallet, outcome, step, now, background);
    // D7, XFER-AUTO: what this pass stored may complete a transfer between own wallets, also when
    // it then stopped on a refusal after committing some ranges.
    if (step.outcome !== 'provider_error' || step.imported > 0) {
      await this.linkOwnTransfers(wallet.ownerId);
    }
    return { ...outcome, step };
  }

  /** Links the owner's certain own transfers; a failure never fails the sync. */
  async linkOwnTransfers(ownerId: string): Promise<void> {
    await this.classifications?.linkQuietly(ownerId);
  }

  /**
   * WALLET-SYNC-OFF: three failed passes in a row switch the wallet's sync off until the owner
   * switches it on. A failed write here never fails the sync it describes.
   */
  private async countPass(
    wallet: DueWallet,
    outcome: SourceOutcome,
    step: StepResult | null,
    now: Date,
    background: boolean,
  ): Promise<void> {
    try {
      // The owner pressing "Retry now" in a short outage must not switch the sync off: a manual
      // failure leaves the run as it is; a manual success still clears it.
      const kind = passKind(outcome, step);
      if (
        await recordPass(
          this.source,
          wallet.id,
          kind === 'failed' && !background ? 'neutral' : kind,
          now,
        )
      )
        this.logger.warn(`${wallet.network} wallet sync switched off after repeated failures`);
    } catch {
      this.logger.warn('The wallet sync failure count could not be written');
    }
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
