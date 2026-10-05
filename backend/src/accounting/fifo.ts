import { FifoBook } from './fifo-book';
import { FifoHistoryError, intervalCost, lotInterval } from './fifo-lot-interval';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { TradePayment } from './paid-currency';
import type { TradeSettlement } from './trade-settlement';

export { FifoHistoryError } from './fifo-lot-interval';

export interface Execution {
  instrumentId: string;
  side: 'buy' | 'sell';
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
  /** Amounts as paid in RUB or EUR; the USD amounts above were derived from them. */
  paid?: TradePayment;
  /** Cash in the same account that the trade's proceeds went to or its price came from (M9). */
  settlement?: TradeSettlement;
}

export interface FifoTrade extends Execution {
  tradeId: string;
  version: number;
  instrumentName: string;
  instrumentSymbol: string | null;
}

export interface FifoSummary {
  grossBuysUsd: string;
  buyFeesUsd: string;
  grossSalesUsd: string;
  sellFeesUsd: string;
  netSalesUsd: string;
  consumedCostUsd: string;
  realizedUsd: string;
  remainingCostUsd: string;
}

export interface FifoLot {
  buyTradeId: string;
  buyVersion: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
  remainingCostUsd: string;
}

export interface FifoRealization {
  sellTradeId: string;
  sellVersion: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
  netUsd: string;
  consumedCostUsd: string;
  realizedUsd: string;
}

export interface FifoMatch {
  sellTradeId: string;
  sellVersion: number;
  buyTradeId: string;
  buyVersion: number;
  quantity: string;
  costUsd: string;
}

export interface FifoResult {
  summary: FifoSummary;
  lots: FifoLot[];
  realizations: FifoRealization[];
  matches: FifoMatch[];
}

export interface FifoCarryInInput {
  lotId: string;
  openingRevision: number;
  ordinal: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  carriedQuantity: string;
}
export interface CarryInLot extends FifoCarryInInput {
  sourceKind: 'carry-in';
  carriedCostUsd: string;
  remainingQuantity: string;
  remainingCostUsd: string;
}
export interface CarryInMatch {
  sourceKind: 'carry-in';
  sellTradeId: string;
  sellVersion: number;
  lotId: string;
  openingRevision: number;
  ordinal: number;
  quantity: string;
  costUsd: string;
}
export interface CarryInFifoResult extends Omit<FifoResult, 'lots' | 'matches'> {
  lots: (FifoLot | CarryInLot)[];
  matches: (FifoMatch | CarryInMatch)[];
}

export const MAX_ACTIVE_TRADES = 1000;
export const MAX_CARRY_IN_LOTS = 100;

/** Original allocation coordinates survive a partial disposal before coverage. */
export function deriveCarryInAmounts(
  originalQuantity: string,
  originalCostUsd: string,
  carriedQuantity: string,
) {
  const quantity = canonicalDecimalToAtoms(originalQuantity);
  const cost = canonicalDecimalToAtoms(originalCostUsd);
  const remaining = canonicalDecimalToAtoms(carriedQuantity);
  if (quantity <= 0n || cost < 0n || remaining <= 0n || remaining > quantity)
    throw new FifoHistoryError();
  const disposed = quantity - remaining;
  const allocated = intervalCost(lotInterval(quantity, cost, 0n, disposed));
  const carried = intervalCost(lotInterval(quantity, cost, disposed, quantity));
  return {
    priorDisposedQuantity: formatAtoms(disposed),
    priorAllocatedCostUsd: formatAtoms(allocated),
    carriedCostUsd: formatAtoms(carried),
  };
}

/** Rebuild one account's complete normalized active history; never mutate its input. */
export function calculateFifo(trades: readonly FifoTrade[]): FifoResult;
export function calculateFifo(
  trades: readonly FifoTrade[],
  initialLots: readonly FifoCarryInInput[],
): CarryInFifoResult;
export function calculateFifo(
  trades: readonly FifoTrade[],
  initialLots: readonly FifoCarryInInput[] = [],
): CarryInFifoResult {
  if (trades.length > MAX_ACTIVE_TRADES || initialLots.length > MAX_CARRY_IN_LOTS)
    throw new FifoHistoryError();
  const book = new FifoBook('');
  const baseline = [...initialLots].sort((left, right) =>
    left.acquiredAt === right.acquiredAt
      ? left.orderWithinTimestamp - right.orderWithinTimestamp
      : left.acquiredAt < right.acquiredAt
        ? -1
        : 1,
  );
  for (const [index, lot] of baseline.entries()) {
    if (
      index > 0 &&
      baseline[index - 1].acquiredAt === lot.acquiredAt &&
      baseline[index - 1].orderWithinTimestamp === lot.orderWithinTimestamp
    )
      throw new FifoHistoryError();
    book.addInitial(lot);
  }
  const ordered = [...trades].sort((left, right) =>
    left.occurredAt === right.occurredAt
      ? left.orderWithinTimestamp - right.orderWithinTimestamp
      : left.occurredAt < right.occurredAt
        ? -1
        : 1,
  );
  for (const trade of ordered) book.applyTrade(trade);
  return book.projectLegacy();
}
