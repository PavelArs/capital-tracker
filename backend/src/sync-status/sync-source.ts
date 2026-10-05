import type { EntityManager } from 'typeorm';

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
      outcome.errorMessage,
    ],
  );
}
