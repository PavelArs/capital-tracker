import { swapAtoms } from './asset-swap-fifo';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { ActiveTransferInput, OwnedAccountInput } from './owned-transfer-types';
import type { FifoSplit } from './share-split-types';
import { settlementLeg } from './trade-settlement';

/** The accounts of one connected component and the transfers between them. */
export interface LedgerView {
  accounts: ReadonlyMap<string, OwnedAccountInput>;
  transfers: readonly ActiveTransferInput[];
  /** The owner's share splits; each multiplies the units held of its security. */
  splits?: readonly FifoSplit[];
}

/** One event's quantity changes per account and instrument, in replay order. */
interface Movement {
  operationId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  rank: number;
  index: number;
  deltas: [accountId: string, instrumentId: string, atoms: bigint][];
  /** A share split: every account's balance of the security is multiplied by `ratio`. */
  split?: { instrumentId: string; ratio: bigint };
}

export interface Shortfall {
  /** The operation as GET /accounting/operations names it, e.g. `trade:<id>`. */
  operationId: string;
  accountId: string;
  instrumentId: string;
  occurredAt: string;
  availableQuantity: string;
  requiredQuantity: string;
  missingQuantity: string;
}

// Same order as the FIFO replay: instant, order within it, then kind and position.
const rank = {
  opening: -2,
  split: -1,
  trade: 0,
  reward: 1,
  swap: 2,
  capitalReturn: 3,
  transfer: 4,
} as const;

type Deltas = Movement['deltas'];

function tradeDeltas(id: string, trade: OwnedAccountInput['trades'][number]): Deltas {
  const quantity = canonicalDecimalToAtoms(trade.quantity);
  const deltas: Deltas = [[id, trade.instrumentId, trade.side === 'buy' ? quantity : -quantity]];
  // A sale's proceeds stay as cash; a buy spends the account's cash first (M9).
  const cash = settlementLeg(trade);
  if (cash && trade.settlement)
    deltas.push([
      id,
      trade.settlement.instrumentId,
      trade.side === 'buy' ? -cash.quantity : cash.quantity,
    ]);
  return deltas;
}

function swapDeltas(id: string, swap: NonNullable<OwnedAccountInput['swaps']>[number]): Deltas {
  const { outgoing, incoming, fee } = swapAtoms(swap);
  const deltas: Deltas = [
    [id, swap.outgoingInstrumentId, -outgoing],
    [id, swap.incomingInstrumentId, incoming],
  ];
  if (fee > 0n && swap.feeInstrumentId) deltas.push([id, swap.feeInstrumentId, -fee]);
  return deltas;
}

function transferDeltas(transfer: ActiveTransferInput): Deltas {
  const quantity = canonicalDecimalToAtoms(transfer.quantity);
  const deltas: Deltas = [
    [transfer.fromAccountId, transfer.instrumentId, -quantity],
    [transfer.toAccountId, transfer.instrumentId, quantity],
  ];
  if (transfer.feeInstrumentId)
    deltas.push([
      transfer.fromAccountId,
      transfer.feeInstrumentId,
      -canonicalDecimalToAtoms(transfer.feeQuantity),
    ]);
  return deltas;
}

/** One account's openings, trades, rewards, swaps and capital returns, in that order. */
function accountMovements(account: OwnedAccountInput, found: Movement[]): void {
  const id = account.accountId;
  for (const [index, lot] of account.initialLots.entries())
    found.push({
      operationId: `opening:${lot.lotId}`,
      occurredAt: account.coverageFrom,
      orderWithinTimestamp: -1,
      rank: rank.opening,
      index,
      deltas: [[id, lot.instrumentId, canonicalDecimalToAtoms(lot.carriedQuantity)]],
    });
  for (const [index, trade] of account.trades.entries())
    found.push({
      operationId: `trade:${trade.tradeId}`,
      occurredAt: trade.occurredAt,
      orderWithinTimestamp: trade.orderWithinTimestamp,
      rank: rank.trade,
      index,
      deltas: tradeDeltas(id, trade),
    });
  for (const [index, reward] of (account.rewards ?? []).entries())
    found.push({
      operationId: `reward:${reward.rewardId}`,
      occurredAt: reward.occurredAt,
      orderWithinTimestamp: reward.orderWithinTimestamp,
      rank: rank.reward,
      index,
      deltas: [[id, reward.instrumentId, canonicalDecimalToAtoms(reward.quantity)]],
    });
  for (const [index, swap] of (account.swaps ?? []).entries())
    found.push({
      operationId: `swap:${swap.swapId}`,
      occurredAt: swap.occurredAt,
      orderWithinTimestamp: swap.orderWithinTimestamp,
      rank: rank.swap,
      index,
      deltas: swapDeltas(id, swap),
    });
  // A capital return brings cash in; the units it lowers the cost of stay where they are.
  for (const [index, capitalReturn] of (account.capitalReturns ?? []).entries())
    found.push({
      operationId: `capital-return:${capitalReturn.capitalReturnId}`,
      occurredAt: capitalReturn.occurredAt,
      orderWithinTimestamp: capitalReturn.orderWithinTimestamp,
      rank: rank.capitalReturn,
      index,
      deltas: [[id, capitalReturn.cashInstrumentId, canonicalDecimalToAtoms(capitalReturn.amount)]],
    });
}

function compareMovements(left: Movement, right: Movement): number {
  return (
    (left.occurredAt < right.occurredAt ? -1 : left.occurredAt > right.occurredAt ? 1 : 0) ||
    left.orderWithinTimestamp - right.orderWithinTimestamp ||
    left.rank - right.rank ||
    left.index - right.index
  );
}

function movements(ledger: LedgerView): Movement[] {
  const found: Movement[] = [];
  for (const account of ledger.accounts.values()) accountMovements(account, found);
  for (const [index, transfer] of ledger.transfers.entries())
    found.push({
      operationId: `transfer:${transfer.transferId}`,
      occurredAt: transfer.occurredAt,
      orderWithinTimestamp: transfer.orderWithinTimestamp,
      rank: rank.transfer,
      index,
      deltas: transferDeltas(transfer),
    });
  for (const [index, split] of (ledger.splits ?? []).entries())
    found.push({
      operationId: `split:${split.splitId}`,
      occurredAt: split.effectiveAt,
      orderWithinTimestamp: -1,
      rank: rank.split,
      index,
      deltas: [],
      split: { instrumentId: split.instrumentId, ratio: BigInt(split.ratio) },
    });
  return found.sort(compareMovements);
}

/** What one movement changes of one account's balance of one instrument. */
function netDelta(movement: Movement, accountId: string, instrumentId: string): bigint {
  return movement.deltas
    .filter(([account, instrument]) => account === accountId && instrument === instrumentId)
    .reduce((sum, [, , atoms]) => sum + atoms, 0n);
}

/**
 * The ratio a movement multiplies the account's units of the instrument by: null when it is no
 * split of it, 1 when the account's history starts at or after the split (new units already).
 */
function ownSplitRatio(movement: Movement, instrumentId: string, coverageFrom: string) {
  if (movement.split?.instrumentId !== instrumentId) return null;
  return coverageFrom >= movement.occurredAt ? 1n : movement.split.ratio;
}

/**
 * What the account can spend of one instrument at `at` (PR-OPS-8): its lowest balance from
 * that instant on, so a new outflow placed after every event already at `at` never takes
 * this or any later balance below zero. Nothing before the account's history starts.
 */
export function availableQuantity(
  ledger: LedgerView,
  accountId: string,
  instrumentId: string,
  at: string,
): string {
  const account = ledger.accounts.get(accountId);
  if (!account || at < account.coverageFrom) return '0';
  let balance = 0n;
  let lowest: bigint | null = null;
  // Splits after `at` count later balances in new units; dividing them back keeps `at`'s units.
  let later = 1n;
  for (const movement of movements(ledger)) {
    const future = movement.occurredAt > at;
    if (future) lowest ??= balance;
    const ratio = ownSplitRatio(movement, instrumentId, account.coverageFrom);
    if (ratio !== null) {
      balance *= ratio;
      if (future) later *= ratio;
      continue;
    }
    balance += netDelta(movement, accountId, instrumentId);
    if (future && lowest !== null && balance / later < lowest) lowest = balance / later;
  }
  const available = lowest ?? balance;
  return available > 0n ? formatAtoms(available) : '0';
}

/** The first operation that would spend more than its account holds, or null. */
export function firstShortfall(ledger: LedgerView): Shortfall | null {
  const balances = new Map<string, bigint>();
  for (const movement of movements(ledger)) {
    if (movement.split) {
      splitBalances(balances, ledger, movement.occurredAt, movement.split);
      continue;
    }
    for (const [accountId, instrumentId, atoms] of movement.deltas) {
      const key = `${accountId}:${instrumentId}`;
      balances.set(key, (balances.get(key) ?? 0n) + atoms);
    }
    const shortfall = shortfallAfter(movement, balances);
    if (shortfall) return shortfall;
  }
  return null;
}

/** A split multiplies every account's balance of its security held from before it. */
function splitBalances(
  balances: Map<string, bigint>,
  ledger: LedgerView,
  occurredAt: string,
  split: NonNullable<Movement['split']>,
): void {
  for (const [key, balance] of balances) {
    const [accountId, instrumentId] = key.split(':');
    // An account whose history starts at or after the split holds new units already.
    if (
      instrumentId === split.instrumentId &&
      ledger.accounts.get(accountId)!.coverageFrom < occurredAt
    )
      balances.set(key, balance * split.ratio);
  }
}

/** The first balance a movement took below zero, as the shortfall it caused; null if none. */
function shortfallAfter(movement: Movement, balances: ReadonlyMap<string, bigint>) {
  for (const [accountId, instrumentId] of movement.deltas) {
    const balance = balances.get(`${accountId}:${instrumentId}`) ?? 0n;
    if (balance >= 0n) continue;
    const missing = -balance;
    const required = -netDelta(movement, accountId, instrumentId);
    return {
      operationId: movement.operationId,
      accountId,
      instrumentId,
      occurredAt: movement.occurredAt,
      availableQuantity: formatAtoms(required - missing),
      requiredQuantity: formatAtoms(required),
      missingQuantity: formatAtoms(missing),
    };
  }
  return null;
}

/** The same ledger without one trade: the trade being edited or deleted. */
export function withoutTrade<T extends LedgerView>(
  ledger: T,
  accountId: string,
  tradeId: string,
): LedgerView {
  return {
    accounts: new Map(
      [...ledger.accounts].map(([id, account]) => [
        id,
        id === accountId
          ? { ...account, trades: account.trades.filter((trade) => trade.tradeId !== tradeId) }
          : account,
      ]),
    ),
    transfers: ledger.transfers,
    splits: ledger.splits,
  };
}

/**
 * The ledger without one trade, reward or transfer, named as GET /accounting/operations
 * names it (`transfer:<id>`): what an edit of that operation may spend.
 */
export function withoutOperation(ledger: LedgerView, operationId: string): LedgerView {
  const [kind, id] = operationId.split(':');
  return {
    accounts: new Map(
      [...ledger.accounts].map(([accountId, account]) => [
        accountId,
        {
          ...account,
          trades:
            kind === 'trade'
              ? account.trades.filter((item) => item.tradeId !== id)
              : account.trades,
          ...(account.rewards && kind === 'reward'
            ? { rewards: account.rewards.filter((item) => item.rewardId !== id) }
            : {}),
        },
      ]),
    ),
    transfers:
      kind === 'transfer'
        ? ledger.transfers.filter((item) => item.transferId !== id)
        : ledger.transfers,
    splits: ledger.splits,
  };
}
