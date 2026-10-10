import type { EntityManager } from 'typeorm';
import type { SourceOutcome, StepResult } from './chain-sync';

// SYNC-JOURNAL: the newest passes of each wallet, so the owner sees what the background job did
// and when, not only its last result.
export const JOURNAL_KEPT = 50;
export const JOURNAL_SHOWN = 20;

export type JournalState = 'synced' | 'partial' | 'delayed' | 'failed';

export interface JournalEntry {
  at: string;
  state: JournalState;
  errorCode: string | null;
  message: string | null;
  imported: number;
}

/** How a pass ended; a partial pass is still loading, which the wallet's own state calls syncing. */
export function journalState(outcome: SourceOutcome, step: StepResult | null): JournalState {
  if (step?.outcome === 'partial') return 'partial';
  return outcome.state === 'syncing' ? 'failed' : outcome.state;
}

/** Appends one ended pass and drops the oldest beyond the kept number. */
export async function journalSync(
  manager: Pick<EntityManager, 'query'>,
  wallet: { id: string; ownerId: string },
  outcome: SourceOutcome,
  step: StepResult | null,
  now: Date,
): Promise<void> {
  await manager.query(
    `INSERT INTO wallet_sync_runs ("ownerId", "addressId", "ranAt", state, "errorCode",
      "errorMessage", imported) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      wallet.ownerId,
      wallet.id,
      now,
      journalState(outcome, step),
      outcome.errorCode,
      outcome.errorMessage,
      step?.imported ?? 0,
    ],
  );
  await manager.query(
    `DELETE FROM wallet_sync_runs WHERE "addressId" = $1 AND id NOT IN (
       SELECT id FROM wallet_sync_runs WHERE "addressId" = $1
       ORDER BY "ranAt" DESC, id DESC LIMIT $2)`,
    [wallet.id, JOURNAL_KEPT],
  );
}

interface JournalRow {
  ranAt: Date;
  state: JournalState;
  errorCode: string | null;
  errorMessage: string | null;
  imported: number;
}

/** The newest passes of one wallet, newest first. */
export async function readJournal(
  manager: Pick<EntityManager, 'query'>,
  ownerId: string,
  addressId: string,
): Promise<JournalEntry[]> {
  const rows: JournalRow[] = await manager.query(
    `SELECT "ranAt", state, "errorCode", "errorMessage", imported FROM wallet_sync_runs
      WHERE "ownerId" = $1 AND "addressId" = $2 ORDER BY "ranAt" DESC, id DESC LIMIT $3`,
    [ownerId, addressId, JOURNAL_SHOWN],
  );
  return rows.map((row) => ({
    at: row.ranAt.toISOString(),
    state: row.state,
    errorCode: row.errorCode,
    message: row.errorMessage,
    imported: row.imported,
  }));
}
