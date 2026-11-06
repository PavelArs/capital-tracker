import type { EntityManager } from 'typeorm';
import { type SourceOutcome, type StepResult, walletSourceKey } from './chain-sync';

/** WALLET-SYNC-OFF: this many failed passes in a row switch a wallet's sync off. */
export const DISABLE_AFTER_FAILURES = 3;

/** Who switched the sync off: the owner, or the app after the failures. */
export type SyncOffReason = 'manual' | 'failures';

/**
 * How one pass counts toward the run of failures: "failed" adds one, "ok" starts the run over,
 * "neutral" leaves it as it is.
 */
export type PassKind = 'ok' | 'failed' | 'neutral';

export function passKind(outcome: SourceOutcome, step: StepResult | null): PassKind {
  // A provider that only asks the app to wait is busy, not broken: the pass neither adds nor clears.
  if (outcome.state === 'delayed') return 'neutral';
  // A refusal after the pass stored rows still moved the history forward.
  if (outcome.state === 'failed' && (step?.imported ?? 0) === 0) return 'failed';
  return 'ok';
}

type Query = Pick<EntityManager, 'query'>;

/**
 * Stores what one pass did to the run of failures, in one statement so passes of the same wallet
 * cannot lose a count. Returns true when this pass switched the wallet's sync off. A sync the
 * owner already switched off keeps its reason.
 */
export async function recordPass(
  manager: Query,
  walletId: string,
  kind: PassKind,
  now: Date,
): Promise<boolean> {
  if (kind === 'neutral') return false;
  const failed = kind === 'failed';
  const trips = `"syncDisabledAt" IS NULL AND $2 AND "syncFailures" + 1 >= $3`;
  const [rows]: [{ switchedOff: boolean }[], number] = await manager.query(
    `UPDATE wallet_addresses SET
       "syncFailures" = CASE WHEN $2 THEN "syncFailures" + 1 ELSE 0 END,
       "syncDisabledAt" = CASE WHEN ${trips} THEN $4::timestamptz ELSE "syncDisabledAt" END,
       "syncDisabledReason" = CASE WHEN ${trips} THEN 'failures' ELSE "syncDisabledReason" END
     WHERE id = $1
     RETURNING ("syncDisabledReason" = 'failures' AND "syncDisabledAt" = $4::timestamptz) AS "switchedOff"`,
    [walletId, failed, DISABLE_AFTER_FAILURES, now],
  );
  return rows?.[0]?.switchedOff === true;
}

/**
 * Switches one address's background sync on or off. Nothing is deleted: the stored transactions
 * stay either way. Switching on clears the failures and makes the wallet due at once; switching
 * off keeps the first reason. Returns false when the owner has no such address.
 */
export async function setSyncEnabled(
  manager: Query,
  owner: string,
  addressId: string,
  enabled: boolean,
): Promise<boolean> {
  if (!enabled) {
    const [off]: [{ id: string }[], number] = await manager.query(
      `UPDATE wallet_addresses SET
         "syncDisabledAt" = COALESCE("syncDisabledAt", clock_timestamp()),
         "syncDisabledReason" = COALESCE("syncDisabledReason", 'manual')
       WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL RETURNING id`,
      [owner, addressId],
    );
    return off.length === 1;
  }
  const [on]: [{ wasOff: boolean }[], number] = await manager.query(
    `UPDATE wallet_addresses a SET "syncDisabledAt" = NULL, "syncDisabledReason" = NULL,
       "syncFailures" = 0
     FROM (SELECT id, "syncDisabledAt" IS NOT NULL AS "wasOff" FROM wallet_addresses
       WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE) o
     WHERE a.id = o.id RETURNING o."wasOff"`,
    [owner, addressId],
  );
  if (on.length !== 1) return false;
  if (on[0].wasOff)
    await manager.query('UPDATE sync_sources SET "nextRunAt" = clock_timestamp() WHERE key = $1', [
      walletSourceKey(addressId),
    ]);
  return true;
}
