import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { parseDecimal } from '../accounting/input';
import {
  DAY_MS,
  FX_COOLDOWN_MS,
  FX_SOURCE,
  type FxObservation,
  convertUsd,
  observationStatus,
  parseDisplayQuery,
  retryDeadline,
} from './display-fx-domain';
import { DisplayFxProvider, FxProviderError } from './display-fx-provider';

interface ObservationRow {
  observedAt: Date;
  fetchedAt: Date;
  nextUpdateAt: Date;
  endOfLifeAt: Date | null;
  eurRate: string;
  rubRate: string;
}
interface CollectionRow {
  reservedAttempts: Date[];
  leaseId: string | null;
  leaseUntil: Date | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextAttemptAt: Date | null;
  lastOutcome: string;
}
type Claim = { token: string } | { outcome: 'cooldown' | 'in-progress' };
type CollectionResult = {
  outcome:
    | 'collected'
    | 'cooldown'
    | 'in-progress'
    | 'disabled'
    | 'failed'
    | 'rate-limited'
    | 'superseded';
};
const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;
const observationView = (row: ObservationRow): FxObservation => ({
  observedAt: row.observedAt.toISOString(),
  nextUpdateAt: row.nextUpdateAt.toISOString(),
  endOfLifeAt: iso(row.endOfLifeAt),
  eurRate: parseDecimal(row.eurRate, true),
  rubRate: parseDecimal(row.rubRate, true),
});
async function databaseNow(manager: EntityManager): Promise<Date> {
  const [row]: { now: Date }[] = await manager.query('SELECT clock_timestamp() AS now');
  return row.now;
}

@Injectable()
export class DisplayFxService {
  private readonly logger = new Logger(DisplayFxService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    private readonly provider: DisplayFxProvider,
  ) {}

  private get enabled(): boolean {
    return this.config.get('DISPLAY_FX_ENABLED') === 'true';
  }

  async read(rawQuery: unknown) {
    const amountUsd = parseDisplayQuery(rawQuery);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const now = (await databaseNow(manager)).getTime();
      const [state]: CollectionRow[] = await manager.query(
        'SELECT * FROM display_fx_collection WHERE provider=$1',
        [FX_SOURCE],
      );
      const [row]: ObservationRow[] = await manager.query(
        'SELECT * FROM display_fx_observations WHERE provider=$1 ORDER BY "observedAt" DESC LIMIT 1',
        [FX_SOURCE],
      );
      const observation = row ? observationView(row) : null;
      const inProgress = !!state?.leaseUntil && state.leaseUntil.getTime() > now;
      const outcome =
        state?.lastOutcome === 'running' && !inProgress
          ? 'interrupted'
          : (state?.lastOutcome ?? 'idle');
      return {
        amountUsd,
        enabled: this.enabled,
        source: FX_SOURCE,
        kind: 'indicative-daily' as const,
        basis: 'latest-stored-observation' as const,
        status: observationStatus(observation, outcome, now),
        observation:
          observation && row
            ? {
                ...observation,
                fetchedAt: row.fetchedAt.toISOString(),
                eurAmount: convertUsd(amountUsd, observation.eurRate),
                rubAmount: convertUsd(amountUsd, observation.rubRate),
              }
            : null,
        collection: {
          lastAttemptAt: iso(state?.lastAttemptAt),
          lastSuccessAt: iso(state?.lastSuccessAt),
          nextAttemptAt: iso(state?.nextAttemptAt),
          outcome,
          inProgress,
        },
      };
    });
  }

  private async claim(): Promise<Claim> {
    return this.source.transaction(async (manager) => {
      await manager.query(
        'INSERT INTO display_fx_collection(provider) VALUES ($1) ON CONFLICT DO NOTHING',
        [FX_SOURCE],
      );
      const [state]: CollectionRow[] = await manager.query(
        'SELECT * FROM display_fx_collection WHERE provider=$1 FOR UPDATE',
        [FX_SOURCE],
      );
      const now = await databaseNow(manager);
      if (state.leaseUntil && state.leaseUntil > now) return { outcome: 'in-progress' };
      const reserved = state.reservedAttempts
        .filter((at) => at.getTime() > now.getTime() - DAY_MS)
        .sort((a, b) => a.getTime() - b.getTime());
      const budgetEnd = reserved.length >= 3 ? reserved[0].getTime() + DAY_MS : 0;
      if (
        budgetEnd > now.getTime() &&
        (!state.nextAttemptAt || state.nextAttemptAt.getTime() < budgetEnd)
      ) {
        await manager.query(
          'UPDATE display_fx_collection SET "nextAttemptAt"=$2 WHERE provider=$1',
          [FX_SOURCE, new Date(budgetEnd)],
        );
      }
      if ((state.nextAttemptAt && state.nextAttemptAt > now) || budgetEnd > now.getTime()) {
        return { outcome: 'cooldown' };
      }
      const token = randomUUID();
      reserved.push(now);
      const nextAttempt = Math.max(
        now.getTime() + FX_COOLDOWN_MS,
        reserved.length >= 3 ? reserved[0].getTime() + DAY_MS : 0,
      );
      await manager.query(
        `UPDATE display_fx_collection SET "reservedAttempts"=$2,
        "leaseId"=$3,"leaseUntil"=$4,"lastAttemptAt"=$5,"nextAttemptAt"=$6,"lastOutcome"='running'
        WHERE provider=$1`,
        [FX_SOURCE, reserved, token, new Date(now.getTime() + 30000), now, new Date(nextAttempt)],
      );
      return { token };
    });
  }

  async collect(): Promise<CollectionResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    const claim = await this.claim();
    if ('outcome' in claim) return claim;
    let observation: FxObservation | null = null;
    let failure: FxProviderError | null = null;
    try {
      observation = await this.provider.fetch();
    } catch (error) {
      failure = error instanceof FxProviderError ? error : new FxProviderError('provider-error');
    }
    return this.finish(claim.token, observation, failure);
  }

  private async finish(
    token: string,
    observation: FxObservation | null,
    failure: FxProviderError | null,
  ): Promise<CollectionResult> {
    return this.source.transaction(async (manager) => {
      const [state]: CollectionRow[] = await manager.query(
        'SELECT * FROM display_fx_collection WHERE provider=$1 FOR UPDATE',
        [FX_SOURCE],
      );
      const now = await databaseNow(manager);
      if (!state || state.leaseId !== token || !state.leaseUntil || state.leaseUntil <= now) {
        return { outcome: 'superseded' };
      }
      let error = failure;
      if (observation) {
        const [latest]: ObservationRow[] = await manager.query(
          'SELECT * FROM display_fx_observations WHERE provider=$1 ORDER BY "observedAt" DESC LIMIT 1',
          [FX_SOURCE],
        );
        const latestAt = latest?.observedAt.toISOString();
        if (
          latestAt &&
          (latestAt > observation.observedAt ||
            (latestAt === observation.observedAt &&
              JSON.stringify(observationView(latest)) !== JSON.stringify(observation)))
        ) {
          error = new FxProviderError('invalid-data');
        } else if (!latest || latestAt !== observation.observedAt) {
          await manager.query(
            `INSERT INTO display_fx_observations
            (provider,base,"observedAt","fetchedAt","nextUpdateAt","endOfLifeAt","eurRate","rubRate")
            VALUES ($1,'USD',$2,$3,$4,$5,$6,$7)`,
            [
              FX_SOURCE,
              observation.observedAt,
              now,
              observation.nextUpdateAt,
              observation.endOfLifeAt,
              observation.eurRate,
              observation.rubRate,
            ],
          );
        }
      }
      if (error || !observation) {
        const budgetEnd =
          state.reservedAttempts.length >= 3
            ? Math.min(...state.reservedAttempts.map((at) => at.getTime())) + DAY_MS
            : null;
        const deadline = retryDeadline(now.getTime(), error?.retryAfter, budgetEnd);
        await manager.query(
          `UPDATE display_fx_collection SET "leaseId"=NULL,"leaseUntil"=NULL,
          "lastOutcome"=$2,"nextAttemptAt"=$3 WHERE provider=$1`,
          [FX_SOURCE, error?.outcome ?? 'provider-error', new Date(deadline)],
        );
        return { outcome: error?.outcome === 'rate-limited' ? 'rate-limited' : 'failed' };
      }
      const nextAttempt = Math.max(
        state.lastAttemptAt!.getTime() + DAY_MS,
        Date.parse(observation.nextUpdateAt),
      );
      await manager.query(
        `UPDATE display_fx_collection SET "leaseId"=NULL,"leaseUntil"=NULL,
        "lastOutcome"='ok',"lastSuccessAt"=$2,"nextAttemptAt"=$3 WHERE provider=$1`,
        [FX_SOURCE, now, new Date(nextAttempt)],
      );
      return { outcome: 'collected' };
    });
  }

  @Cron('*/15 * * * *')
  async collectWhenDue(): Promise<void> {
    try {
      await this.collect();
    } catch {
      this.logger.warn('Daily display FX collection could not finish');
    }
  }
}
