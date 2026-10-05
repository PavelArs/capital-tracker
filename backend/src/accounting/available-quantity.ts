import { swapAtoms } from './asset-swap-fifo';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { ActiveTransferInput, OwnedAccountInput } from './owned-transfer-types';
import { settlementLeg } from './trade-settlement';

/** The accounts of one connected component and the transfers between them. */
export interface LedgerView {
  accounts: ReadonlyMap<string, OwnedAccountInput>;
  transfers: readonly ActiveTransferInput[];
}

/** One event's quantity changes per account and instrument, in replay order. */
interface Movement {
  operationId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  rank: number;
  index: number;
  deltas: [accountId: string, instrumentId: string, atoms: bigint][];
}

export interface Shortfall {
  /** The operation as GET /accounting/operations names it, e.g. `trade:<id>`. */
  operationId: string;
  accountId: string;
  instrumentId: string;
  occurredAt: string;
}

// Same order as the FIFO replay: instant, order within it, then kind and position.
const rank = { opening: -1, trade: 0, reward: 1, swap: 2, transfer: 3 } as const;

function movements(ledger: LedgerView): Movement[] {
  const found: Movement[] = [];
  for (const account of ledger.accounts.values()) {
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
    for (const [index, trade] of account.trades.entries()) {
      const quantity = canonicalDecimalToAtoms(trade.quantity);
      const deltas: Movement['deltas'] = [
        [id, trade.instrumentId, trade.side === 'buy' ? quantity : -quantity],
      ];
      // A sale's proceeds stay as cash; a buy spends the account's cash first (M9).
      const cash = settlementLeg(trade);
      if (cash && trade.settlement)
        deltas.push([
          id,
          trade.settlement.instrumentId,
          trade.side === 'buy' ? -cash.quantity : cash.quantity,
        ]);
      found.push({
        operationId: `trade:${trade.tradeId}`,
        occurredAt: trade.occurredAt,
        orderWithinTimestamp: trade.orderWithinTimestamp,
        rank: rank.trade,
        index,
        deltas,
      });
    }
    for (const [index, reward] of (account.rewards ?? []).entries())
      found.push({
        operationId: `reward:${reward.rewardId}`,
        occurredAt: reward.occurredAt,
        orderWithinTimestamp: reward.orderWithinTimestamp,
        rank: rank.reward,
        index,
        deltas: [[id, reward.instrumentId, canonicalDecimalToAtoms(reward.quantity)]],
      });
    for (const [index, swap] of (account.swaps ?? []).entries()) {
      const { outgoing, incoming, fee } = swapAtoms(swap);
      const deltas: Movement['deltas'] = [
        [id, swap.outgoingInstrumentId, -outgoing],
        [id, swap.incomingInstrumentId, incoming],
      ];
      if (fee > 0n && swap.feeInstrumentId) deltas.push([id, swap.feeInstrumentId, -fee]);
      found.push({
        operationId: `swap:${swap.swapId}`,
        occurredAt: swap.occurredAt,
        orderWithinTimestamp: swap.orderWithinTimestamp,
        rank: rank.swap,
        index,
        deltas,
      });
    }
  }
  for (const [index, transfer] of ledger.transfers.entries()) {
    const quantity = canonicalDecimalToAtoms(transfer.quantity);
    const deltas: Movement['deltas'] = [
      [transfer.fromAccountId, transfer.instrumentId, -quantity],
      [transfer.toAccountId, transfer.instrumentId, quantity],
    ];
    if (transfer.feeInstrumentId)
      deltas.push([
        transfer.fromAccountId,
        transfer.feeInstrumentId,
        -canonicalDecimalToAtoms(transfer.feeQuantity),
      ]);
    found.push({
      operationId: `transfer:${transfer.transferId}`,
      occurredAt: transfer.occurredAt,
      orderWithinTimestamp: transfer.orderWithinTimestamp,
      rank: rank.transfer,
      index,
      deltas,
    });
  }
  return found.sort(
    (left, right) =>
      (left.occurredAt < right.occurredAt ? -1 : left.occurredAt > right.occurredAt ? 1 : 0) ||
      left.orderWithinTimestamp - right.orderWithinTimestamp ||
      left.rank - right.rank ||
      left.index - right.index,
  );
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
  for (const movement of movements(ledger)) {
    const change = movement.deltas
      .filter(([account, instrument]) => account === accountId && instrument === instrumentId)
      .reduce((sum, [, , atoms]) => sum + atoms, 0n);
    if (movement.occurredAt > at) {
      lowest ??= balance;
      balance += change;
      if (balance < lowest) lowest = balance;
    } else balance += change;
  }
  const available = lowest ?? balance;
  return available > 0n ? formatAtoms(available) : '0';
}

/** The first operation that would spend more than its account holds, or null. */
export function firstShortfall(ledger: LedgerView): Shortfall | null {
  const balances = new Map<string, bigint>();
  for (const movement of movements(ledger)) {
    for (const [accountId, instrumentId, atoms] of movement.deltas) {
      const key = `${accountId}:${instrumentId}`;
      balances.set(key, (balances.get(key) ?? 0n) + atoms);
    }
    for (const [accountId, instrumentId] of movement.deltas)
      if ((balances.get(`${accountId}:${instrumentId}`) ?? 0n) < 0n)
        return {
          operationId: movement.operationId,
          accountId,
          instrumentId,
          occurredAt: movement.occurredAt,
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
  };
}
