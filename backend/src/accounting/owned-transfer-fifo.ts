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

const MAX_ACCOUNTS = 32;
const MAX_CONNECTED_TRADES = 10000;
const MAX_TRANSFERS = 1000;
const MAX_MATCHES = 100000;
const MAX_HELD_FRAGMENTS = 100000;

export class OwnedTransferCapacityError extends FifoHistoryError {
  constructor() {
    super();
    this.name = 'OwnedTransferCapacityError';
  }
}

function cost(portions: readonly BookPortion[]): bigint {
  return portions.reduce((sum, portion) => sum + portion.cost, 0n);
}

function item(kind: 'principal' | 'fee', portion: BookPortion): TransferAllocationItem {
  return {
    kind,
    instrumentId: portion.fragment.instrumentId,
    quantity: formatAtoms(portion.interval.end - portion.interval.start),
    costUsd: formatAtoms(portion.cost),
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
  | { kind: 'transfer'; occurredAt: string; orderWithinTimestamp: number; index: number };

/** Pure full-component replay. Callers load current-effective heads in one DB snapshot. */
export function calculateOwnedTransfers(
  accounts: readonly OwnedAccountInput[],
  transfers: readonly ActiveTransferInput[],
  at?: string,
): OwnedProjection {
  if (accounts.length > MAX_ACCOUNTS || transfers.length > MAX_TRANSFERS)
    throw new OwnedTransferCapacityError();
  const byAccount = new Map(accounts.map((account) => [account.accountId, account]));
  if (byAccount.size !== accounts.length) throw new FifoHistoryError();
  let tradeCount = 0;
  let heldFragments = 0;
  let matches = 0;
  const books = new Map<string, FifoBook>();
  const events: Event[] = [];
  for (const account of accounts) {
    if (account.trades.length > 1000 || account.initialLots.length > 100)
      throw new OwnedTransferCapacityError();
    tradeCount += account.trades.length;
    if (tradeCount > MAX_CONNECTED_TRADES) throw new OwnedTransferCapacityError();
    const book = new FifoBook(account.accountId, {
      match: () => {
        if (++matches > MAX_MATCHES) throw new OwnedTransferCapacityError();
      },
      addFragment: () => {
        if (++heldFragments > MAX_HELD_FRAGMENTS) throw new OwnedTransferCapacityError();
      },
      removeFragment: () => {
        heldFragments--;
      },
    });
    books.set(account.accountId, book);
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
      event.kind === 'trade'
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
          (left.kind === right.kind ? left.index - right.index : left.kind === 'trade' ? -1 : 1),
  );

  const allocations = new Map<string, TransferAllocation>();
  for (const event of events) {
    if (at !== undefined && event.occurredAt > at) break;
    if (event.kind === 'trade') {
      const account = byAccount.get(event.accountId)!;
      books.get(event.accountId)!.applyTrade(account.trades[event.index]);
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
    allocations.set(transfer.transferId, {
      transferId: transfer.transferId,
      principalBasisUsd: formatAtoms(cost(principal)),
      feeConsumedBasisUsd: formatAtoms(cost(fee)),
      items: [
        ...principal.map((portion) => item('principal', portion)),
        ...fee.map((portion) => item('fee', portion)),
      ],
    });
  }
  return {
    accounts: new Map([...books].map(([id, book]) => [id, book.project()])),
    allocations,
  };
}
