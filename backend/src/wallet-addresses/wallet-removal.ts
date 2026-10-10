import type { EntityManager } from 'typeorm';
import { walletSourceKey } from './chain-sync';

/**
 * WALLET-REMOVE: stops tracking one address, or every address of one wallet. Nothing is
 * deleted: the transactions, the owner's answers and the entries they produced stay, and the
 * address only leaves the lists, the balances and the sync schedule. A Bybit account also loses
 * its stored API key; adding the account again asks for a key. Returns the addresses stopped.
 */
export async function stopTracking(
  manager: EntityManager,
  owner: string,
  target: { addressId: string } | { accountId: string },
): Promise<string[]> {
  const byAddress = 'addressId' in target;
  const [stopped]: [{ id: string }[], number] = await manager.query(
    `UPDATE wallet_addresses SET "removedAt" = clock_timestamp()
      WHERE "ownerId" = $1 AND "removedAt" IS NULL AND ${byAddress ? 'id' : '"accountId"'} = $2
      RETURNING id`,
    [owner, byAddress ? target.addressId : target.accountId],
  );
  const ids = stopped.map(({ id }) => id);
  if (ids.length > 0)
    await manager.query(
      `UPDATE bybit_accounts SET credentials = '{}'::jsonb WHERE "ownerId" = $1 AND "walletId" = ANY($2::uuid[])`,
      [owner, ids],
    );
  return ids;
}

/** An address added again after it was removed: its own history is still there. */
export async function resumeTracking(manager: EntityManager, id: string): Promise<void> {
  await manager.query('UPDATE sync_sources SET "nextRunAt" = clock_timestamp() WHERE key = $1', [
    walletSourceKey(id),
  ]);
}
