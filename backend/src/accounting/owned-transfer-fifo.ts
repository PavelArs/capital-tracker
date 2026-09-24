import { CostTally } from './cost-evidence';
import { type BookPortion, FifoBook } from './fifo-book';
import { FifoHistoryError } from './fifo-lot-interval';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type {
  ActiveTransferInput,
  OwnedAccountInput,
  OwnedProjection,
  TransferAllocation,
  TransferAllocationItem,
} from './owned-transfer-types';

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
  matches: 100000,
  heldFragments: 100000,
} as const;

export class OwnedTransferCapacityError extends FifoHistoryError {
  constructor() {
    super();
    this.name = 'OwnedTransferCapacityError';
  }
}

function cost(portions: readonly BookPortion[]): CostTally {
  const total = new CostTally();
  for (const portion of portions) total.add(portion.cost);
  return total;
}

function item(kind: 'principal' | 'fee', portion: BookPortion): TransferAllocationItem {
  return {
    kind,
    instrumentId: portion.fragment.instrumentId,
    quantity: formatAtoms(portion.interval.end - portion.interval.start),
    costUsd: portion.cost === null ? null : formatAtoms(portion.cost),
    origin: portion.fragment.origin,
    intervalStart: formatAtoms(portion.interval.start),
    intervalEnd: formatAtoms(portion.interval.end),
    arrival: portion.fragment.arrival,
  };
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
  | { kind: 'transfer'; occurredAt: string; orderWithinTimestamp: number; index: number };

/** Pure full-component replay. Callers load current-effective heads in one DB snapshot. */
export function calculateOwnedTransfers(
  accounts: readonly OwnedAccountInput[],
  transfers: readonly ActiveTransferInput[],
  at?: string,
): OwnedProjection {
  if (
    accounts.length > OWNED_TRANSFER_LIMITS.accounts ||
    transfers.length > OWNED_TRANSFER_LIMITS.activeTransfers
  )
    throw new OwnedTransferCapacityError();
  const byAccount = new Map(accounts.map((account) => [account.accountId, account]));
  if (byAccount.size !== accounts.length) throw new FifoHistoryError();
  let tradeCount = 0;
  let rewardCount = 0;
  let heldFragments = 0;
  let matches = 0;
  const books = new Map<string, FifoBook>();
  const events: Event[] = [];
  for (const account of accounts) {
    if (
      account.trades.length > 1000 ||
      account.initialLots.length > 100 ||
      (account.rewards?.length ?? 0) > OWNED_TRANSFER_LIMITS.activeRewards
    )
      throw new OwnedTransferCapacityError();
    tradeCount += account.trades.length;
    rewardCount += account.rewards?.length ?? 0;
    if (tradeCount > OWNED_TRANSFER_LIMITS.activeTrades) throw new OwnedTransferCapacityError();
    if (rewardCount > OWNED_TRANSFER_LIMITS.activeRewards) throw new OwnedTransferCapacityError();
    const book = new FifoBook(account.accountId, {
      match: () => {
        if (++matches > OWNED_TRANSFER_LIMITS.matches) throw new OwnedTransferCapacityError();
      },
      addFragment: () => {
        if (++heldFragments > OWNED_TRANSFER_LIMITS.heldFragments)
          throw new OwnedTransferCapacityError();
      },
      removeFragment: () => {
        heldFragments--;
      },
    });
    books.set(account.accountId, book);
    if (account.rewards?.length) book.markRewardIdentity();
    if (at === undefined || account.coverageFrom <= at) {
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
    for (const [index, trade] of account.trades.entries()) {
      if (trade.occurredAt < account.coverageFrom) throw new FifoHistoryError();
      events.push({
        kind: 'trade',
        accountId: account.accountId,
        occurredAt: trade.occurredAt,
        orderWithinTimestamp: trade.orderWithinTimestamp,
        index,
      });
    }
    for (const [index, reward] of (account.rewards ?? []).entries()) {
      if (reward.occurredAt < account.coverageFrom) throw new FifoHistoryError();
      events.push({
        kind: 'reward',
        accountId: account.accountId,
        occurredAt: reward.occurredAt,
        orderWithinTimestamp: reward.orderWithinTimestamp,
        index,
      });
    }
  }
  const rewardIds = new Set<string>();
  for (const account of accounts)
    for (const reward of account.rewards ?? []) {
      if (rewardIds.has(reward.rewardId)) throw new FifoHistoryError();
      rewardIds.add(reward.rewardId);
    }
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

  // Validate the entire effective chronology, including events after an as-of prefix.
  const occupied = new Map<string, Set<string>>();
  for (const event of events) {
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
  events.sort((left, right) =>
    left.occurredAt < right.occurredAt
      ? -1
      : left.occurredAt > right.occurredAt
        ? 1
        : left.orderWithinTimestamp - right.orderWithinTimestamp ||
          (left.kind === right.kind
            ? left.index - right.index
            : (left.kind === 'trade' ? 0 : left.kind === 'reward' ? 1 : 2) -
              (right.kind === 'trade' ? 0 : right.kind === 'reward' ? 1 : 2)),
  );

  const allocations = new Map<string, TransferAllocation>();
  for (const event of events) {
    if (at !== undefined && event.occurredAt > at) break;
    if (event.kind === 'trade') {
      const account = byAccount.get(event.accountId)!;
      books.get(event.accountId)!.applyTrade(account.trades[event.index]);
      continue;
    }
    if (event.kind === 'reward') {
      const account = byAccount.get(event.accountId)!;
      books.get(event.accountId)!.applyReward(account.rewards![event.index]);
      continue;
    }
    const transfer = transfers[event.index];
    const sender = books.get(transfer.fromAccountId)!;
    const receiver = books.get(transfer.toAccountId)!;
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
    const principalCost = cost(principal);
    const feeCost = cost(fee);
    allocations.set(transfer.transferId, {
      transferId: transfer.transferId,
      principalBasisUsd: principalCost.value,
      feeConsumedBasisUsd: feeCost.value,
      items: [
        ...principal.map((portion) => item('principal', portion)),
        ...fee.map((portion) => item('fee', portion)),
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
  return {
    accounts: new Map([...books].map(([id, book]) => [id, book.project()])),
    allocations,
  };
}
