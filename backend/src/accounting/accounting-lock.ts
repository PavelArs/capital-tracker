import type { EntityManager } from 'typeorm';

/** Same-owner economic writes share one order before taking any account-row lock. */
export async function lockAccountingOwner(manager: EntityManager, owner: string): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Accounting write lock requires transaction');
  // Domain separation avoids other advisory-lock namespaces; collisions only
  // serialize unrelated owners and cannot bypass ownership or data validation.
  await manager.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0))",
    [owner],
  );
}
