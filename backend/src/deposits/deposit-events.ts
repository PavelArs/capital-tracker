import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';

// DEP-HISTORY: one row per thing the owner did to a deposit, written in the same transaction as
// the change itself and numbered under the deposit's lock. Only the facts History shows are kept.

export type DepositEventKind =
  | 'opened'
  | 'movement-added'
  | 'movement-removed'
  | 'rate-added'
  | 'check-added'
  | 'deleted';

export interface DepositEventFacts {
  /** The day the action is about; for `opened` the start date. */
  occurredOn?: string | null;
  movementKind?: 'topup' | 'withdrawal' | 'interest-payout' | null;
  amount?: string | null;
  ratePercent?: string | null;
  bankBalance?: string | null;
  comment?: string | null;
}

/** Call while the deposit still exists and, except for `opened`, with its row locked. */
export async function recordDepositEvent(
  manager: EntityManager,
  owner: string,
  depositId: string,
  kind: DepositEventKind,
  facts: DepositEventFacts = {},
): Promise<void> {
  await manager.query(
    `INSERT INTO bank_deposit_events
       (id, "ownerId", "depositId", version, kind, "depositKind", name, bank, currency, "occurredOn",
        "endDate", payout, "movementKind", amount, "ratePercent", "bankBalance", comment)
     SELECT $1::uuid, d."ownerId", d.id,
       (SELECT coalesce(max(e.version), 0) + 1 FROM bank_deposit_events e
         WHERE e."ownerId" = d."ownerId" AND e."depositId" = d.id),
       $4::text, d.kind, d.name, d.bank, d.currency, $5::date,
       CASE WHEN $4::text = 'opened' THEN d."endDate" END,
       CASE WHEN $4::text = 'opened' THEN d.payout END,
       $6::text, $7::numeric, $8::numeric, $9::numeric, $10::text
     FROM bank_deposits d WHERE d."ownerId" = $2 AND d.id = $3`,
    [
      randomUUID(),
      owner,
      depositId,
      kind,
      facts.occurredOn ?? null,
      facts.movementKind ?? null,
      facts.amount ?? null,
      facts.ratePercent ?? null,
      facts.bankBalance ?? null,
      facts.comment ?? null,
    ],
  );
}
