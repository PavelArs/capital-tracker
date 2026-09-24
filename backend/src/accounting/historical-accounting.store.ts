import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FifoHistoryError } from './fifo';
import { projectHistoricalAccounting } from './historical-accounting';
import { readBaseline, readJournal, readOwnedAccount, readTradeHeads } from './trade-journal.store';

/** All reads share the caller's read-only repeatable-read transaction. */
export async function readHistoricalState(
  manager: EntityManager,
  owner: string,
  id: string,
  at: string,
  journalRevision?: number,
) {
  return (await readHistoricalStates(manager, owner, id, [at], journalRevision))[0];
}

/** Bounded prefixes share one ledger load and the caller's database snapshot. */
export async function readHistoricalStates(
  manager: EntityManager,
  owner: string,
  id: string,
  instants: readonly string[],
  journalRevision?: number,
) {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Historical read requires transaction');
  if (instants.length < 1 || instants.length > 31)
    throw new Error('Historical read requires between1 and31 instants');
  const conflict = () => new ConflictException('Trade request conflicts with saved state');
  await readOwnedAccount(manager, owner, id);
  const journal = await readJournal(manager, owner, id);
  if (
    !journal ||
    instants.some((at) => at < journal.coverageFrom.toISOString()) ||
    (journalRevision !== undefined && journalRevision !== journal.currentRevision)
  )
    throw conflict();
  try {
    const heads = await readTradeHeads(manager, owner, id);
    const baseline = await readBaseline(manager, owner, id, journal);
    return instants.map((at) => ({
      accountId: id,
      at,
      coverageFrom: journal.coverageFrom.toISOString(),
      journalRevision: journal.currentRevision,
      basis: 'current-effective-history' as const,
      originKind: journal.originKind,
      openingRevision: journal.openingRevision,
      ...projectHistoricalAccounting(heads, baseline, at),
    }));
  } catch (error) {
    // Caller input was parsed before entering the transaction. These errors
    // concern persisted history; SQL/programming failures retain private500.
    if (error instanceof FifoHistoryError || error instanceof BadRequestException) throw conflict();
    throw error;
  }
}
