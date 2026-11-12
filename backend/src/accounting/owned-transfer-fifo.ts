import { swapAtoms } from './asset-swap-fifo';
import type { SwapAllocation } from './asset-swap-types';
import type { CapitalReturnAllocation } from './capital-return-types';
import { allocationItem, type BookLimits, FifoBook, portionCost } from './fifo-book';
import { FifoHistoryError } from './fifo-lot-interval';
import { canonicalDecimalToAtoms } from './money';
import type {
  ActiveTransferInput,
  OwnedAccountInput,
  OwnedProjection,
  TransferAllocation,
} from './owned-transfer-types';
import { type FifoSplit, SPLIT_LIMITS, validSplitRatio } from './share-split-types';

export type {
  AccountFifoResult,
  ActiveTransferInput,
  LotOrigin,
  OwnedAccountInput,
  OwnedProjection,
  ReceivedLot,
  ReceivedSaleMatch,
  TransferAllocation,
  TransferAllocationItem,
  TransferSummary,
} from './owned-transfer-types';

export const OWNED_TRANSFER_LIMITS = {
  accounts: 32,
  activeTrades: 10000,
  activeTransfers: 1000,
  activeRewards: 1000,
  activeSwaps: 1000,
  activeCapitalReturns: 1000,
  matches: 100000,
  heldFragments: 100000,
} as const;

export class OwnedTransferCapacityError extends FifoHistoryError {
  constructor() {
    super();
    this.name = 'OwnedTransferCapacityError';
  }
}

type Event =
  | {
      kind: 'trade';
      accountId: string;
      occurredAt: string;
      orderWithinTimestamp: number;
      index: number;
    }
  | {
      kind: 'reward';
      accountId: string;
      occurredAt: string;
      orderWithinTimestamp: number;
      index: number;
    }
  | {
      kind: 'swap';
      accountId: string;
      occurredAt: string;
      orderWithinTimestamp: number;
      index: number;
    }
  | {
      kind: 'capital-return';
      accountId: string;
      occurredAt: string;
      orderWithinTimestamp: number;
      index: number;
    }
  | { kind: 'transfer'; occurredAt: string; orderWithinTimestamp: number; index: number }
  | { kind: 'split'; occurredAt: string; orderWithinTimestamp: number; index: number };

type AccountEvent = Extract<Event, { accountId: string }>;

// A split takes effect before anything else at its instant: units traded then are new units.
const eventRank = {
  split: -1,
  trade: 0,
  reward: 1,
  swap: 2,
  'capital-return': 3,
  transfer: 4,
} as const;

interface ActivityTotals {
  trades: number;
  rewards: number;
  swaps: number;
  capitalReturns: number;
}

/** Each account's own limits, then the running totals across the component. */
function countActivity(account: OwnedAccountInput, totals: ActivityTotals): void {
  const rewards = account.rewards?.length ?? 0;
  const swaps = account.swaps?.length ?? 0;
  const capitalReturns = account.capitalReturns?.length ?? 0;
  if (
    account.trades.length > 1000 ||
    account.initialLots.length > 100 ||
    rewards > OWNED_TRANSFER_LIMITS.activeRewards ||
    swaps > OWNED_TRANSFER_LIMITS.activeSwaps ||
    capitalReturns > OWNED_TRANSFER_LIMITS.activeCapitalReturns
  )
    throw new OwnedTransferCapacityError();
  totals.trades += account.trades.length;
  totals.rewards += rewards;
  totals.swaps += swaps;
  totals.capitalReturns += capitalReturns;
  if (
    totals.trades > OWNED_TRANSFER_LIMITS.activeTrades ||
    totals.rewards > OWNED_TRANSFER_LIMITS.activeRewards ||
    totals.swaps > OWNED_TRANSFER_LIMITS.activeSwaps ||
    totals.capitalReturns > OWNED_TRANSFER_LIMITS.activeCapitalReturns
  )
    throw new OwnedTransferCapacityError();
}

/** One book's hooks; every book of the component counts into the same `held` and `matches`. */
function capacityLimits(counters: { matches: number; heldFragments: number }): BookLimits {
  return {
    match: () => {
      if (++counters.matches > OWNED_TRANSFER_LIMITS.matches)
        throw new OwnedTransferCapacityError();
    },
    addFragment: () => {
      if (++counters.heldFragments > OWNED_TRANSFER_LIMITS.heldFragments)
        throw new OwnedTransferCapacityError();
    },
    removeFragment: () => {
      counters.heldFragments--;
    },
  };
}

/** The opening lots in their own order, none after coverage starts and no two at one place. */
function addBaseline(book: FifoBook, account: OwnedAccountInput): void {
  const baseline = [...account.initialLots].sort((left, right) =>
    left.acquiredAt === right.acquiredAt
      ? left.orderWithinTimestamp - right.orderWithinTimestamp
      : left.acquiredAt < right.acquiredAt
        ? -1
        : 1,
  );
  for (const [index, lot] of baseline.entries()) {
    if (
      lot.acquiredAt > account.coverageFrom ||
      (index > 0 &&
        baseline[index - 1].acquiredAt === lot.acquiredAt &&
        baseline[index - 1].orderWithinTimestamp === lot.orderWithinTimestamp)
    )
      throw new FifoHistoryError();
    book.addInitial(lot);
  }
}

function pushAccountEvents(account: OwnedAccountInput, events: Event[]): void {
  const push = <T extends { occurredAt: string; orderWithinTimestamp: number }>(
    kind: AccountEvent['kind'],
    rows: readonly T[],
    check: (row: T) => unknown = () => undefined,
  ) => {
    for (const [index, row] of rows.entries()) {
      if (row.occurredAt < account.coverageFrom) throw new FifoHistoryError();
      check(row);
      events.push({
        kind,
        accountId: account.accountId,
        occurredAt: row.occurredAt,
        orderWithinTimestamp: row.orderWithinTimestamp,
        index,
      });
    }
  };
  push('trade', account.trades);
  push('reward', account.rewards ?? []);
  push('swap', account.swaps ?? [], swapAtoms);
  push('capital-return', account.capitalReturns ?? []);
}

function assertUnique(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new FifoHistoryError();
    seen.add(id);
  }
}

function pushTransferEvents(
  transfers: readonly ActiveTransferInput[],
  byAccount: ReadonlyMap<string, OwnedAccountInput>,
  events: Event[],
): void {
  const transferIds = new Set<string>();
  for (const [index, transfer] of transfers.entries()) {
    const source = byAccount.get(transfer.fromAccountId);
    const destination = byAccount.get(transfer.toAccountId);
    if (
      !source ||
      !destination ||
      source === destination ||
      transferIds.has(transfer.transferId) ||
      transfer.occurredAt < source.coverageFrom ||
      transfer.occurredAt < destination.coverageFrom
    )
      throw new FifoHistoryError();
    transferIds.add(transfer.transferId);
    const quantity = canonicalDecimalToAtoms(transfer.quantity);
    const fee = canonicalDecimalToAtoms(transfer.feeQuantity);
    if (
      quantity <= 0n ||
      fee < 0n ||
      (fee === 0n && transfer.feeInstrumentId !== null) ||
      (fee > 0n && transfer.feeInstrumentId === null)
    )
      throw new FifoHistoryError();
    events.push({
      kind: 'transfer',
      occurredAt: transfer.occurredAt,
      orderWithinTimestamp: transfer.orderWithinTimestamp,
      index,
    });
  }
}

/** One split per security and instant; it belongs to no account, so it occupies none. */
function pushSplitEvents(splits: readonly FifoSplit[], events: Event[]): void {
  const splitKeys = new Set<string>();
  for (const [index, split] of splits.entries()) {
    const key = JSON.stringify([split.instrumentId, split.effectiveAt]);
    if (!validSplitRatio(split.ratio) || splitKeys.has(key)) throw new FifoHistoryError();
    splitKeys.add(key);
    events.push({ kind: 'split', occurredAt: split.effectiveAt, orderWithinTimestamp: -1, index });
  }
}

/** No account takes part in two events at one instant and order within it. */
function assertOneEventPerPlace(
  events: readonly Event[],
  transfers: readonly ActiveTransferInput[],
): void {
  const occupied = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.kind === 'split') continue;
    const ids =
      event.kind !== 'transfer'
        ? [event.accountId]
        : [transfers[event.index].fromAccountId, transfers[event.index].toAccountId];
    const key = JSON.stringify([event.occurredAt, event.orderWithinTimestamp]);
    for (const id of ids) {
      const keys = occupied.get(id) ?? new Set<string>();
      if (keys.has(key)) throw new FifoHistoryError();
      keys.add(key);
      occupied.set(id, keys);
    }
  }
}

function compareEvents(left: Event, right: Event): number {
  if (left.occurredAt < right.occurredAt) return -1;
  if (left.occurredAt > right.occurredAt) return 1;
  return (
    left.orderWithinTimestamp - right.orderWithinTimestamp ||
    (left.kind === right.kind
      ? left.index - right.index
      : eventRank[left.kind] - eventRank[right.kind])
  );
}

interface Replay {
  byAccount: ReadonlyMap<string, OwnedAccountInput>;
  books: ReadonlyMap<string, FifoBook>;
  transfers: readonly ActiveTransferInput[];
  splits: readonly FifoSplit[];
  allocations: Map<string, TransferAllocation>;
  swapAllocations: Map<string, SwapAllocation>;
  capitalReturnAllocations: Map<string, CapitalReturnAllocation>;
}

function replaySplit(split: FifoSplit, replay: Replay): void {
  // An account whose history starts at or after the split holds new units already.
  for (const [id, book] of replay.books)
    if (replay.byAccount.get(id)!.coverageFrom < split.effectiveAt)
      book.applySplit(split.instrumentId, BigInt(split.ratio));
}

function replayAccountEvent(event: AccountEvent, replay: Replay): void {
  const account = replay.byAccount.get(event.accountId)!;
  const book = replay.books.get(event.accountId)!;
  if (event.kind === 'trade') book.applyTrade(account.trades[event.index]);
  else if (event.kind === 'reward') book.applyReward(account.rewards![event.index]);
  else if (event.kind === 'swap') {
    const swap = account.swaps![event.index];
    replay.swapAllocations.set(swap.swapId, book.applySwap(swap));
  } else {
    const capitalReturn = account.capitalReturns![event.index];
    replay.capitalReturnAllocations.set(
      capitalReturn.capitalReturnId,
      book.applyCapitalReturn(capitalReturn),
    );
  }
}

function replayEvent(event: Event, replay: Replay): void {
  if (event.kind === 'split') replaySplit(replay.splits[event.index], replay);
  else if (event.kind === 'transfer') replayTransfer(replay.transfers[event.index], replay);
  else replayAccountEvent(event, replay);
}

function replayTransfer(transfer: ActiveTransferInput, replay: Replay): void {
  const sender = replay.books.get(transfer.fromAccountId)!;
  const receiver = replay.books.get(transfer.toAccountId)!;
  sender.occupy(transfer.occurredAt, transfer.orderWithinTimestamp);
  receiver.occupy(transfer.occurredAt, transfer.orderWithinTimestamp);
  const principal = sender.consume(
    transfer.instrumentId,
    canonicalDecimalToAtoms(transfer.quantity),
  );
  const fee =
    transfer.feeInstrumentId === null
      ? []
      : sender.consume(transfer.feeInstrumentId, canonicalDecimalToAtoms(transfer.feeQuantity));
  sender.recordSent(principal);
  sender.recordFee(fee);
  receiver.receive(principal, { transferId: transfer.transferId, version: transfer.version });
  const principalCost = portionCost(principal);
  const feeCost = portionCost(fee);
  replay.allocations.set(transfer.transferId, {
    transferId: transfer.transferId,
    principalBasisUsd: principalCost.value,
    feeConsumedBasisUsd: feeCost.value,
    items: [
      ...principal.map((portion) => allocationItem('principal', portion)),
      ...fee.map((portion) => allocationItem('fee', portion)),
    ],
    ...(principalCost.incomplete || feeCost.incomplete
      ? {
          basisCoverage: {
            principal: principalCost.coverage,
            fee: feeCost.coverage,
          },
        }
      : {}),
  });
}

/** The account's book, with its opening lots when its history has begun by `at`. */
function openBook(
  account: OwnedAccountInput,
  counters: { matches: number; heldFragments: number },
  at: string | undefined,
): FifoBook {
  const book = new FifoBook(account.accountId, capacityLimits(counters));
  if (account.rewards?.length) book.markRewardIdentity();
  if (account.swaps?.length) book.markSwapIdentity();
  if (account.capitalReturns?.length) book.markCapitalReturnIdentity();
  if (at === undefined || account.coverageFrom <= at) addBaseline(book, account);
  return book;
}

/** Pure full-component replay. Callers load current-effective heads in one DB snapshot. */
export function calculateOwnedTransfers(
  accounts: readonly OwnedAccountInput[],
  transfers: readonly ActiveTransferInput[],
  at?: string,
  splits: readonly FifoSplit[] = [],
): OwnedProjection {
  if (
    accounts.length > OWNED_TRANSFER_LIMITS.accounts ||
    transfers.length > OWNED_TRANSFER_LIMITS.activeTransfers ||
    splits.length > SPLIT_LIMITS.activeSplits
  )
    throw new OwnedTransferCapacityError();
  const byAccount = new Map(accounts.map((account) => [account.accountId, account]));
  if (byAccount.size !== accounts.length) throw new FifoHistoryError();
  const totals: ActivityTotals = { trades: 0, rewards: 0, swaps: 0, capitalReturns: 0 };
  const counters = { matches: 0, heldFragments: 0 };
  const books = new Map<string, FifoBook>();
  const events: Event[] = [];
  for (const account of accounts) {
    countActivity(account, totals);
    books.set(account.accountId, openBook(account, counters, at));
    pushAccountEvents(account, events);
  }
  assertUnique(accounts.flatMap((account) => (account.rewards ?? []).map((row) => row.rewardId)));
  assertUnique(accounts.flatMap((account) => (account.swaps ?? []).map((row) => row.swapId)));
  assertUnique(
    accounts.flatMap((account) => (account.capitalReturns ?? []).map((row) => row.capitalReturnId)),
  );
  pushTransferEvents(transfers, byAccount, events);
  pushSplitEvents(splits, events);

  // Validate the entire effective chronology, including events after an as-of prefix.
  assertOneEventPerPlace(events, transfers);
  events.sort(compareEvents);

  const replay: Replay = {
    byAccount,
    books,
    transfers,
    splits,
    allocations: new Map(),
    swapAllocations: new Map(),
    capitalReturnAllocations: new Map(),
  };
  for (const event of events) {
    if (at !== undefined && event.occurredAt > at) break;
    replayEvent(event, replay);
  }
  return {
    accounts: new Map([...books].map(([id, book]) => [id, book.project()])),
    allocations: replay.allocations,
    swapAllocations: replay.swapAllocations,
    capitalReturnAllocations: replay.capitalReturnAllocations,
  };
}
