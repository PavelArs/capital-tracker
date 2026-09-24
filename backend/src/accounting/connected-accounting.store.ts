import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import { FifoHistoryError, type FifoTrade } from './fifo';
import {
  type AccountFifoResult,
  type ActiveTransferInput,
  OWNED_TRANSFER_LIMITS,
  type OwnedAccountInput,
  OwnedTransferCapacityError,
  type TransferSummary,
  calculateOwnedTransfers,
} from './owned-transfer-fifo';
import {
  type TransferVersion,
  readTransferHeads,
  readTransferParticipants,
} from './owned-transfer.store';
import {
  type JournalRow,
  type VersionRow,
  advanceJournal,
  projectTradeVersion,
  readBaseline,
  versionSelect,
} from './trade-journal.store';

export interface ConnectedAccount extends OwnedAccountInput {
  journal: JournalRow;
}
export interface ConnectedLedger {
  accounts: ReadonlyMap<string, ConnectedAccount>;
  transfers: readonly TransferVersion[];
  participants: ReadonlySet<string>;
}
export type ConnectedLedgerCache = Map<string, ConnectedLedger>;

const conflict = () => new ConflictException('Accounting history conflicts with saved state');
export const emptyTransferSummary = (): TransferSummary => ({
  receivedBasisUsd: '0',
  sentBasisUsd: '0',
  feeConsumedBasisUsd: '0',
  fees: [],
});

/** Resolve the affected old/new union before taking sorted account locks. */
function componentIds(seeds: readonly string[], edges: readonly ActiveTransferInput[]): string[] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [from, to] of [
      [edge.fromAccountId, edge.toAccountId],
      [edge.toAccountId, edge.fromAccountId],
    ]) {
      const neighbors = adjacency.get(from) ?? new Set<string>();
      neighbors.add(to);
      adjacency.set(from, neighbors);
    }
  }
  const ids = new Set(seeds);
  const queue = [...ids];
  for (let index = 0; index < queue.length; index++) {
    if (ids.size > OWNED_TRANSFER_LIMITS.accounts) throw new OwnedTransferCapacityError();
    for (const next of adjacency.get(queue[index]) ?? []) {
      if (!ids.has(next)) {
        ids.add(next);
        queue.push(next);
      }
    }
  }
  return [...ids].sort();
}

/** One caller-owned transaction; writes acquire the owner lock before any row locks. */
export async function readConnectedLedger(
  manager: EntityManager,
  owner: string,
  seeds: readonly string[],
  options: {
    lock?: boolean;
    transfers?: readonly TransferVersion[];
    candidateTransfers?: readonly ActiveTransferInput[];
  } = {},
): Promise<ConnectedLedger> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Connected history requires transaction');
  if (options.lock) await lockAccountingOwner(manager, owner);
  const transfers = options.transfers ?? (await readTransferHeads(manager, owner));
  const ids = componentIds(seeds, [...transfers, ...(options.candidateTransfers ?? [])]);
  if (options.lock) {
    const locked: { id: string }[] = await manager.query(
      'SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [owner, ids],
    );
    if (locked.length !== ids.length) throw new NotFoundException();
  }
  const journals: JournalRow[] = await manager.query(
    'SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) ORDER BY "accountId"',
    [owner, ids],
  );
  if (journals.length !== ids.length) throw conflict();
  // Count first: do not materialize a corrupt/oversized component and then truncate it.
  const counts: { accountId: string; count: number }[] = await manager.query(
    `SELECT t."accountId",count(*)::int AS count FROM account_trades t
      JOIN account_trade_versions v ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId"
        AND v."tradeId"=t.id AND v.version=t."currentVersion"
      WHERE t."ownerId"=$1 AND t."accountId"=ANY($2::uuid[]) AND v.kind<>'void' GROUP BY t."accountId"`,
    [owner, ids],
  );
  if (
    counts.some((row) => row.count > 1000) ||
    counts.reduce((n, row) => n + row.count, 0) > OWNED_TRANSFER_LIMITS.activeTrades
  )
    throw new OwnedTransferCapacityError();
  const rows: (VersionRow & { accountId: string })[] = await manager.query(
    `${versionSelect} JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accountId"
      AND t.id=v."tradeId" AND t."currentVersion"=v.version
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
      ORDER BY v."accountId",v."occurredAt",v."orderWithinTimestamp",v."tradeId" LIMIT 10001`,
    [owner, ids],
  );
  if (rows.length > OWNED_TRANSFER_LIMITS.activeTrades) throw new OwnedTransferCapacityError();
  const byAccount = new Map<string, FifoTrade[]>();
  for (const row of rows) {
    const trades = byAccount.get(row.accountId) ?? [];
    trades.push(projectTradeVersion(row));
    byAccount.set(row.accountId, trades);
  }
  const accounts = new Map<string, ConnectedAccount>();
  for (const journal of journals) {
    accounts.set(journal.accountId, {
      accountId: journal.accountId,
      coverageFrom: journal.coverageFrom.toISOString(),
      journal,
      trades: byAccount.get(journal.accountId) ?? [],
      initialLots: await readBaseline(manager, owner, journal.accountId, journal),
    });
  }
  return {
    accounts,
    transfers: transfers.filter((transfer) => accounts.has(transfer.fromAccountId)),
    participants: await readTransferParticipants(manager, owner, ids),
  };
}

/** Domain errors remain distinguishable for invalid-candidate CSV previews. */
export function projectConnectedLedger(
  ledger: ConnectedLedger,
  options: {
    at?: string;
    accountId?: string;
    trades?: readonly FifoTrade[];
    transfers?: readonly ActiveTransferInput[];
  } = {},
) {
  const accounts = [...ledger.accounts.values()].map((account) =>
    account.accountId === options.accountId
      ? { ...account, trades: options.trades ?? account.trades }
      : account,
  );
  return calculateOwnedTransfers(accounts, options.transfers ?? ledger.transfers, options.at);
}

export function connectedResult(ledger: ConnectedLedger, id: string, result: AccountFifoResult) {
  if (!ledger.participants.has(id) && !result.transferSummary) return result;
  return { ...result, transferSummary: result.transferSummary ?? emptyTransferSummary() };
}

export function rethrowAccountingHistory(error: unknown): never {
  if (error instanceof OwnedTransferCapacityError)
    throw new ConflictException('Accounting component capacity exceeded');
  if (error instanceof FifoHistoryError || error instanceof BadRequestException) throw conflict();
  throw error;
}

export function assertRevisionCapacity(
  ledger: ConnectedLedger,
  sourceId?: string,
  sourceTicks = 1,
): void {
  for (const account of ledger.accounts.values()) {
    const ticks = account.accountId === sourceId ? sourceTicks : 1;
    if (account.journal.currentRevision + ticks > 10000) throw new OwnedTransferCapacityError();
  }
}
export async function advanceConnectedJournals(
  manager: EntityManager,
  owner: string,
  ledger: ConnectedLedger,
  sourceId?: string,
  sourceTicks = 1,
): Promise<void> {
  assertRevisionCapacity(ledger, sourceId, sourceTicks);
  for (const account of ledger.accounts.values()) {
    const ticks = account.accountId === sourceId ? sourceTicks : 1;
    await advanceJournal(
      manager,
      owner,
      account.accountId,
      account.journal.currentRevision + ticks,
    );
  }
}
export async function readTradeVersionCount(manager: EntityManager, owner: string, id: string) {
  const [row]: { count: number }[] = await manager.query(
    'SELECT count(*)::int AS count FROM account_trade_versions WHERE "ownerId"=$1 AND "accountId"=$2',
    [owner, id],
  );
  return row.count;
}
