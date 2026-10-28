import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  projectRewardVersion,
  type RewardVersionRow,
  rewardHeadJoin,
  rewardVersionSelect,
} from './asset-reward.store';
import type { FifoReward, RewardSummary } from './asset-reward-types';
import {
  projectSwapVersion,
  type SwapVersionRow,
  swapHeadJoin,
  swapVersionSelect,
} from './asset-swap.store';
import { emptySwapSummary, type FifoSwap } from './asset-swap-types';
import {
  type CapitalReturnVersionRow,
  capitalReturnHeadJoin,
  capitalReturnVersionSelect,
  projectCapitalReturnVersion,
} from './capital-return.store';
import type { CapitalReturnSummary, FifoCapitalReturn } from './capital-return-types';
import { FifoHistoryError, type FifoTrade } from './fifo';
import {
  readTransferHeads,
  readTransferParticipants,
  type TransferVersion,
} from './owned-transfer.store';
import {
  type AccountFifoResult,
  type ActiveTransferInput,
  calculateOwnedTransfers,
  OWNED_TRANSFER_LIMITS,
  type OwnedAccountInput,
  OwnedTransferCapacityError,
  type TransferSummary,
} from './owned-transfer-fifo';
import { readSplits } from './share-split.store';
import type { FifoSplit } from './share-split-types';
import {
  advanceJournal,
  type JournalRow,
  projectTradeVersion,
  readBaselines,
  type VersionRow,
  versionSelect,
} from './trade-journal.store';

export interface ConnectedAccount extends OwnedAccountInput {
  journal: JournalRow;
}
export interface ConnectedLedger {
  accounts: ReadonlyMap<string, ConnectedAccount>;
  transfers: readonly TransferVersion[];
  participants: ReadonlySet<string>;
  rewardParticipants: ReadonlySet<string>;
  swapParticipants: ReadonlySet<string>;
  capitalReturnParticipants: ReadonlySet<string>;
  /** The owner's share splits, for every account they reach. */
  splits: readonly FifoSplit[];
}
export type ConnectedLedgerCache = Map<string, ConnectedLedger>;

const conflict = () => new ConflictException('Accounting history conflicts with saved state');
/**
 * An account opened with balances on the older screens has no journal to add to until it is
 * started there; saying which account lets the owner act, where a bare conflict cannot.
 */
export const journalNotStarted = (accountId: string) =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'The records of an account have not started',
    coverage: { accountId, coverageFrom: null },
  });
/** An entry is dated before the records of its account begin (a journal opened on a date). */
export const notCovered = (accountId: string, coverageFrom: string) =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'The records of an account start after this entry',
    coverage: { accountId, coverageFrom },
  });
export const emptyTransferSummary = (): TransferSummary => ({
  receivedBasisUsd: '0',
  sentBasisUsd: '0',
  feeConsumedBasisUsd: '0',
  fees: [],
});
export const emptyRewardSummary = (): RewardSummary => ({
  activeCount: 0,
  declaredBasisUsd: '0',
  declaredIncomeUsd: '0',
  knownBasisSubtotalUsd: '0',
  knownIncomeSubtotalUsd: '0',
  unknownBasisCount: 0,
  unknownIncomeCount: 0,
  unclassifiedCount: 0,
});

export const emptyCapitalReturnSummary = (): CapitalReturnSummary => ({
  activeCount: 0,
  amountUsd: '0',
  appliedUsd: '0',
  realizedUsd: '0',
  unknownCostCount: 0,
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
  const [ledger] = await readLedgers(manager, owner, [ids], transfers);
  return ledger;
}

/**
 * Every ledger reached from the seeds, one per connected component, in seed order. All of them
 * are read together with one query per table instead of one round of queries per ledger.
 */
export async function readConnectedLedgers(
  manager: EntityManager,
  owner: string,
  seeds: readonly string[],
): Promise<ConnectedLedger[]> {
  if (seeds.length === 0) return [];
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Connected history requires transaction');
  const transfers = await readTransferHeads(manager, owner);
  const components: string[][] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    const ids = componentIds([seed], transfers);
    for (const id of ids) seen.add(id);
    components.push(ids);
  }
  return readLedgers(manager, owner, components, transfers);
}

/**
 * The ledgers of disjoint components. Each step reads every component at once and then checks
 * each component as a single read would, so one component reads and fails exactly as before.
 */
async function readLedgers(
  manager: EntityManager,
  owner: string,
  components: readonly (readonly string[])[],
  transfers: readonly TransferVersion[],
): Promise<ConnectedLedger[]> {
  const ids = components.flat();
  const members = components.map((component) => new Set(component));
  const parts = <T extends { accountId: string }>(rows: readonly T[]) =>
    members.map((member) => rows.filter((row) => member.has(row.accountId)));
  const allJournals: JournalRow[] = await manager.query(
    'SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) ORDER BY "accountId"',
    [owner, ids],
  );
  const journals = parts(allJournals);
  components.forEach((component, index) => {
    if (journals[index].length !== component.length) {
      const started = new Set(journals[index].map((journal) => journal.accountId));
      const missing = component.find((id) => !started.has(id));
      throw missing ? journalNotStarted(missing) : conflict();
    }
  });
  // Count first: do not materialize a corrupt/oversized component and then truncate it.
  const counts: { accountId: string; count: number }[] = await manager.query(
    `SELECT t."accountId",count(*)::int AS count FROM account_trades t
      JOIN account_trade_versions v ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId"
        AND v."tradeId"=t.id AND v.version=t."currentVersion"
      WHERE t."ownerId"=$1 AND t."accountId"=ANY($2::uuid[]) AND v.kind<>'void' GROUP BY t."accountId"`,
    [owner, ids],
  );
  for (const part of parts(counts))
    if (
      part.some((row) => row.count > 1000) ||
      part.reduce((n, row) => n + row.count, 0) > OWNED_TRANSFER_LIMITS.activeTrades
    )
      throw new OwnedTransferCapacityError();
  // One row more than a component may hold, per component: an oversized one is still refused.
  const rows: (VersionRow & { accountId: string })[] = await manager.query(
    `${versionSelect} JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accountId"
      AND t.id=v."tradeId" AND t."currentVersion"=v.version
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
      ORDER BY v."accountId",v."occurredAt",v."orderWithinTimestamp",v."tradeId" LIMIT $3`,
    [owner, ids, components.length * (OWNED_TRANSFER_LIMITS.activeTrades + 1)],
  );
  if (parts(rows).some((part) => part.length > OWNED_TRANSFER_LIMITS.activeTrades))
    throw new OwnedTransferCapacityError();
  const byAccount = new Map<string, FifoTrade[]>();
  for (const row of rows) {
    const trades = byAccount.get(row.accountId) ?? [];
    trades.push(projectTradeVersion(row));
    byAccount.set(row.accountId, trades);
  }
  const rewardCounts: { accountId: string; active: number }[] = await manager.query(
    `SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active
      FROM account_reward_versions v ${rewardHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) GROUP BY v."accountId"`,
    [owner, ids],
  );
  for (const part of parts(rewardCounts))
    if (
      part.some((row) => row.active > OWNED_TRANSFER_LIMITS.activeRewards) ||
      part.reduce((n, row) => n + row.active, 0) > OWNED_TRANSFER_LIMITS.activeRewards
    )
      throw new OwnedTransferCapacityError();
  const rewardRows: RewardVersionRow[] = await manager.query(
    `${rewardVersionSelect} ${rewardHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
      ORDER BY v."accountId",v."occurredAt",v."orderWithinTimestamp",v."rewardId" LIMIT $3`,
    [owner, ids, components.length * (OWNED_TRANSFER_LIMITS.activeRewards + 1)],
  );
  if (parts(rewardRows).some((part) => part.length > OWNED_TRANSFER_LIMITS.activeRewards))
    throw new OwnedTransferCapacityError();
  const rewardsByAccount = new Map<string, FifoReward[]>();
  for (const row of rewardRows) {
    const rewards = rewardsByAccount.get(row.accountId) ?? [];
    rewards.push(projectRewardVersion(row));
    rewardsByAccount.set(row.accountId, rewards);
  }
  const swapCounts: { accountId: string; active: number }[] = await manager.query(
    `SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active
      FROM account_swap_versions v ${swapHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) GROUP BY v."accountId"`,
    [owner, ids],
  );
  for (const part of parts(swapCounts))
    if (
      part.some((row) => row.active > OWNED_TRANSFER_LIMITS.activeSwaps) ||
      part.reduce((n, row) => n + row.active, 0) > OWNED_TRANSFER_LIMITS.activeSwaps
    )
      throw new OwnedTransferCapacityError();
  const swapRows: SwapVersionRow[] = await manager.query(
    `${swapVersionSelect} ${swapHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
      ORDER BY v."accountId",v."occurredAt",v."orderWithinTimestamp",v."swapId" LIMIT $3`,
    [owner, ids, components.length * (OWNED_TRANSFER_LIMITS.activeSwaps + 1)],
  );
  if (parts(swapRows).some((part) => part.length > OWNED_TRANSFER_LIMITS.activeSwaps))
    throw new OwnedTransferCapacityError();
  const swapsByAccount = new Map<string, FifoSwap[]>();
  for (const row of swapRows) {
    const swaps = swapsByAccount.get(row.accountId) ?? [];
    swaps.push(projectSwapVersion(row));
    swapsByAccount.set(row.accountId, swaps);
  }
  const returnCounts: { accountId: string; active: number }[] = await manager.query(
    `SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active
      FROM account_capital_return_versions v ${capitalReturnHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) GROUP BY v."accountId"`,
    [owner, ids],
  );
  for (const part of parts(returnCounts))
    if (
      part.some((row) => row.active > OWNED_TRANSFER_LIMITS.activeCapitalReturns) ||
      part.reduce((n, row) => n + row.active, 0) > OWNED_TRANSFER_LIMITS.activeCapitalReturns
    )
      throw new OwnedTransferCapacityError();
  const returnRows: CapitalReturnVersionRow[] = await manager.query(
    `${capitalReturnVersionSelect} ${capitalReturnHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
      ORDER BY v."accountId",v."occurredAt",v."orderWithinTimestamp",v."capitalReturnId" LIMIT $3`,
    [owner, ids, components.length * (OWNED_TRANSFER_LIMITS.activeCapitalReturns + 1)],
  );
  if (parts(returnRows).some((part) => part.length > OWNED_TRANSFER_LIMITS.activeCapitalReturns))
    throw new OwnedTransferCapacityError();
  const returnsByAccount = new Map<string, FifoCapitalReturn[]>();
  for (const row of returnRows) {
    const returns = returnsByAccount.get(row.accountId) ?? [];
    returns.push(projectCapitalReturnVersion(row));
    returnsByAccount.set(row.accountId, returns);
  }
  const baselines = await readBaselines(manager, owner, allJournals);
  const participants = await readTransferParticipants(manager, owner, ids);
  const splits = await readSplits(manager, owner);
  return components.map((_component, index) => {
    const accounts = new Map<string, ConnectedAccount>();
    for (const journal of journals[index]) {
      accounts.set(journal.accountId, {
        accountId: journal.accountId,
        coverageFrom: journal.coverageFrom.toISOString(),
        journal,
        trades: byAccount.get(journal.accountId) ?? [],
        rewards: rewardsByAccount.get(journal.accountId) ?? [],
        swaps: swapsByAccount.get(journal.accountId) ?? [],
        capitalReturns: returnsByAccount.get(journal.accountId) ?? [],
        initialLots: baselines.get(journal.accountId)!,
      });
    }
    const member = members[index];
    return {
      accounts,
      transfers: transfers.filter((transfer) => accounts.has(transfer.fromAccountId)),
      participants: new Set([...participants].filter((id) => member.has(id))),
      rewardParticipants: new Set(parts(rewardCounts)[index].map((row) => row.accountId)),
      swapParticipants: new Set(parts(swapCounts)[index].map((row) => row.accountId)),
      capitalReturnParticipants: new Set(parts(returnCounts)[index].map((row) => row.accountId)),
      splits,
    };
  });
}

/** Domain errors remain distinguishable for invalid-candidate CSV previews. */
export function projectConnectedLedger(
  ledger: ConnectedLedger,
  options: {
    at?: string;
    accountId?: string;
    trades?: readonly FifoTrade[];
    rewards?: readonly FifoReward[];
    swaps?: readonly FifoSwap[];
    capitalReturns?: readonly FifoCapitalReturn[];
    transfers?: readonly ActiveTransferInput[];
  } = {},
) {
  const accounts = [...ledger.accounts.values()].map((account) =>
    account.accountId === options.accountId
      ? {
          ...account,
          trades: options.trades ?? account.trades,
          rewards: options.rewards ?? account.rewards,
          swaps: options.swaps ?? account.swaps,
          capitalReturns: options.capitalReturns ?? account.capitalReturns,
        }
      : account,
  );
  return calculateOwnedTransfers(
    accounts,
    options.transfers ?? ledger.transfers,
    options.at,
    ledger.splits,
  );
}

export function connectedResult(ledger: ConnectedLedger, id: string, result: AccountFifoResult) {
  return {
    ...result,
    ...(ledger.participants.has(id) && !result.transferSummary
      ? { transferSummary: emptyTransferSummary() }
      : {}),
    ...(ledger.swapParticipants.has(id) && !result.swapSummary
      ? { swapSummary: emptySwapSummary() }
      : {}),
    ...(ledger.capitalReturnParticipants.has(id) && !result.capitalReturnSummary
      ? { capitalReturnSummary: emptyCapitalReturnSummary() }
      : {}),
    ...(ledger.rewardParticipants.has(id) && !result.rewardSummary
      ? { rewardSummary: emptyRewardSummary() }
      : {}),
  };
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
