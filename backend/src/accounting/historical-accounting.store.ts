import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  type ConnectedLedgerCache,
  connectedResult,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { projectHistoricalFifo } from './historical-accounting';
import { readOwnedAccount } from './trade-journal.store';

/** All reads share the caller's read-only repeatable-read transaction. */
export async function readHistoricalState(
  manager: EntityManager,
  owner: string,
  id: string,
  at: string,
  journalRevision?: number,
  cache?: ConnectedLedgerCache,
) {
  return (await readHistoricalStates(manager, owner, id, [at], journalRevision, cache))[0];
}

/** Bounded prefixes share one component load and the caller's database snapshot. */
export async function readHistoricalStates(
  manager: EntityManager,
  owner: string,
  id: string,
  instants: readonly string[],
  journalRevision?: number,
  cache?: ConnectedLedgerCache,
) {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Historical read requires transaction');
  if (instants.length < 1 || instants.length > 31)
    throw new Error('Historical read requires between1 and31 instants');
  const conflict = () => new ConflictException('Trade request conflicts with saved state');
  await readOwnedAccount(manager, owner, id);
  try {
    const ledger = cache?.get(id) ?? (await readConnectedLedger(manager, owner, [id]));
    if (cache) for (const accountId of ledger.accounts.keys()) cache.set(accountId, ledger);
    const account = ledger.accounts.get(id)!;
    const { journal } = account;
    if (
      instants.some((at) => at < account.coverageFrom) ||
      (journalRevision !== undefined && journalRevision !== journal.currentRevision)
    )
      throw conflict();
    return instants.map((at) => {
      const fifo = connectedResult(
        ledger,
        id,
        projectConnectedLedger(ledger, { at }).accounts.get(id)!,
      );
      return {
        accountId: id,
        at,
        coverageFrom: account.coverageFrom,
        journalRevision: journal.currentRevision,
        basis: 'current-effective-history' as const,
        originKind: journal.originKind,
        openingRevision: journal.openingRevision,
        ...projectHistoricalFifo(fifo, account.initialLots),
        ...(fifo.transferSummary ? { transferSummary: fifo.transferSummary } : {}),
        ...(fifo.transferSummary || fifo.rewardSummary || fifo.swapSummary
          ? {
              revisionBudget: { used: journal.currentRevision, limit: 10000 },
            }
          : {}),
      };
    });
  } catch (error) {
    // Caller input was parsed before entering the transaction. Persisted domain
    // failures are conflicts; SQL/programming errors retain the private500 boundary.
    return rethrowAccountingHistory(error);
  }
}
