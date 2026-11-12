import type { DataSource, EntityManager } from 'typeorm';

export type SourceState = 'synced' | 'syncing' | 'delayed' | 'failed';

// A run still "syncing" after this long has died with its process.
export const INTERRUPTED_AFTER_MS = 15 * 60_000;

export interface SourceRow {
  state: SourceState;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SourceStatus {
  state: SourceState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** A stored state as the owner sees it: a run that never finished reads as failed. */
export function presentSource(row: SourceRow, now: Date): SourceStatus {
  const interrupted =
    row.state === 'syncing' &&
    (!row.lastAttemptAt || now.getTime() - row.lastAttemptAt.getTime() > INTERRUPTED_AFTER_MS);
  return {
    state: interrupted ? 'failed' : row.state,
    lastAttemptAt: iso(row.lastAttemptAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    nextRunAt: iso(row.nextRunAt),
    errorCode: interrupted ? 'interrupted' : row.errorCode,
    errorMessage: interrupted ? 'The sync stopped before it finished.' : row.errorMessage,
  };
}

export interface RecordedOutcome {
  state: SourceState;
  errorCode: string | null;
  errorMessage: string | null;
  nextRunAt: Date | null;
}

/** Stores one attempt; the last success survives failures. */
export async function recordSource(
  manager: Pick<EntityManager, 'query'>,
  key: string,
  outcome: RecordedOutcome,
  now: Date,
): Promise<void> {
  await manager.query(
    `INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt", "errorCode", "errorMessage")
     VALUES ($1, $2, $3, CASE WHEN $4 THEN $3::timestamptz END, $5, $6, $7)
     ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state,
       "lastAttemptAt" = EXCLUDED."lastAttemptAt",
       "lastSuccessAt" = COALESCE(EXCLUDED."lastSuccessAt", sync_sources."lastSuccessAt"),
       "nextRunAt" = EXCLUDED."nextRunAt", "errorCode" = EXCLUDED."errorCode",
       "errorMessage" = EXCLUDED."errorMessage"`,
    [
      key,
      outcome.state,
      now,
      outcome.state === 'synced',
      outcome.nextRunAt,
      outcome.errorCode,
      // The column is varchar(300); a longer text would abort the run that records it.
      outcome.errorMessage?.slice(0, 300) ?? null,
    ],
  );
}

/**
 * One run of a scheduled job at a time, busy while another holds its lock: a transaction-scoped
 * advisory lock on a dedicated connection, released by the rollback below or by the connection
 * ending, never left behind.
 */
export async function runLocked<T>(
  source: DataSource,
  lockKey: number,
  run: () => Promise<T>,
): Promise<T | { outcome: 'busy' }> {
  const runner = source.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    try {
      const [lock]: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_xact_lock($1) AS locked',
        [lockKey],
      );
      if (!lock.locked) return { outcome: 'busy' };
      return await run();
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
  }
}
