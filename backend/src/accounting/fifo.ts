import { canonicalDecimalToAtoms, formatAtoms } from './money';

export interface Execution {
  instrumentId: string;
  side: 'buy' | 'sell';
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
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

export class FifoHistoryError extends Error {
  constructor() {
    super('Invalid trade history');
    this.name = 'FifoHistoryError';
  }
}

interface WorkingLot {
  source: { kind: 'trade'; trade: FifoTrade } | { kind: 'carry-in'; lot: FifoCarryInInput };
  quantity: bigint;
  cost: bigint;
  disposed: bigint;
  allocated: bigint;
}

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
  const allocated = (cost * disposed) / quantity;
  return {
    priorDisposedQuantity: formatAtoms(disposed),
    priorAllocatedCostUsd: formatAtoms(allocated),
    carriedCostUsd: formatAtoms(cost - allocated),
  };
}

function projectLot(lot: WorkingLot): FifoLot | CarryInLot {
  const remaining = {
    remainingQuantity: formatAtoms(lot.quantity - lot.disposed),
    remainingCostUsd: formatAtoms(lot.cost - lot.allocated),
  };
  if (lot.source.kind === 'carry-in') {
    const original = lot.source.lot;
    return {
      sourceKind: 'carry-in',
      ...original,
      carriedCostUsd: deriveCarryInAmounts(
        original.originalQuantity,
        original.originalCostUsd,
        original.carriedQuantity,
      ).carriedCostUsd,
      ...remaining,
    };
  }
  const trade = lot.source.trade;
  return {
    buyTradeId: trade.tradeId,
    buyVersion: trade.version,
    instrumentId: trade.instrumentId,
    instrumentName: trade.instrumentName,
    instrumentSymbol: trade.instrumentSymbol,
    occurredAt: trade.occurredAt,
    orderWithinTimestamp: trade.orderWithinTimestamp,
    originalQuantity: trade.quantity,
    originalCostUsd: formatAtoms(lot.cost),
    ...remaining,
  };
}

interface InstrumentQueue {
  lots: WorkingLot[];
  head: number;
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
  const ordered = [...trades].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
    return left.orderWithinTimestamp - right.orderWithinTimestamp;
  });
  const queues = new Map<string, InstrumentQueue>();
  const lots: WorkingLot[] = [];
  const matches: (FifoMatch | CarryInMatch)[] = [];
  const realizations: FifoRealization[] = [];
  let grossBuys = 0n;
  let buyFees = 0n;
  let grossSales = 0n;
  let sellFees = 0n;
  let consumedCost = 0n;
  let carryInCost = 0n;
  let previous: FifoTrade | undefined;

  const baseline = [...initialLots].sort((left, right) =>
    left.acquiredAt === right.acquiredAt
      ? left.orderWithinTimestamp - right.orderWithinTimestamp
      : left.acquiredAt < right.acquiredAt
        ? -1
        : 1,
  );
  for (const [index, original] of baseline.entries()) {
    if (
      index > 0 &&
      baseline[index - 1].acquiredAt === original.acquiredAt &&
      baseline[index - 1].orderWithinTimestamp === original.orderWithinTimestamp
    )
      throw new FifoHistoryError();
    const amounts = deriveCarryInAmounts(
      original.originalQuantity,
      original.originalCostUsd,
      original.carriedQuantity,
    );
    const lot: WorkingLot = {
      source: { kind: 'carry-in', lot: original },
      quantity: canonicalDecimalToAtoms(original.originalQuantity),
      cost: canonicalDecimalToAtoms(original.originalCostUsd),
      disposed: canonicalDecimalToAtoms(amounts.priorDisposedQuantity),
      allocated: canonicalDecimalToAtoms(amounts.priorAllocatedCostUsd),
    };
    const queue = queues.get(original.instrumentId) ?? { lots: [], head: 0 };
    queue.lots.push(lot);
    queues.set(original.instrumentId, queue);
    lots.push(lot);
    carryInCost += canonicalDecimalToAtoms(amounts.carriedCostUsd);
  }

  for (const trade of ordered) {
    if (
      previous?.occurredAt === trade.occurredAt &&
      previous.orderWithinTimestamp === trade.orderWithinTimestamp
    )
      throw new FifoHistoryError();
    previous = trade;
    const quantity = canonicalDecimalToAtoms(trade.quantity);
    const gross = canonicalDecimalToAtoms(trade.grossUsd);
    const fee = canonicalDecimalToAtoms(trade.feeUsd);

    if (trade.side === 'buy') {
      const lot: WorkingLot = {
        source: { kind: 'trade', trade },
        quantity,
        cost: gross + fee,
        disposed: 0n,
        allocated: 0n,
      };
      const queue = queues.get(trade.instrumentId) ?? { lots: [], head: 0 };
      queue.lots.push(lot);
      queues.set(trade.instrumentId, queue);
      lots.push(lot);
      grossBuys += gross;
      buyFees += fee;
      continue;
    }

    const queue = queues.get(trade.instrumentId);
    if (!queue) throw new FifoHistoryError();
    let remaining = quantity;
    let saleCost = 0n;
    while (remaining > 0n) {
      const lot = queue.lots[queue.head];
      if (!lot) throw new FifoHistoryError();
      const available = lot.quantity - lot.disposed;
      const matched = remaining < available ? remaining : available;
      lot.disposed += matched;
      // Difference of cumulative allocations from the ORIGINAL lot, including its final atom.
      const allocated = (lot.cost * lot.disposed) / lot.quantity;
      const cost = allocated - lot.allocated;
      lot.allocated = allocated;
      saleCost += cost;
      remaining -= matched;
      const match = {
        sellTradeId: trade.tradeId,
        sellVersion: trade.version,
        quantity: formatAtoms(matched),
        costUsd: formatAtoms(cost),
      };
      matches.push(
        lot.source.kind === 'trade'
          ? {
              sellTradeId: trade.tradeId,
              sellVersion: trade.version,
              buyTradeId: lot.source.trade.tradeId,
              buyVersion: lot.source.trade.version,
              quantity: match.quantity,
              costUsd: match.costUsd,
            }
          : {
              ...match,
              sourceKind: 'carry-in',
              lotId: lot.source.lot.lotId,
              openingRevision: lot.source.lot.openingRevision,
              ordinal: lot.source.lot.ordinal,
            },
      );
      if (lot.disposed === lot.quantity) queue.head += 1;
    }
    grossSales += gross;
    sellFees += fee;
    consumedCost += saleCost;
    realizations.push({
      sellTradeId: trade.tradeId,
      sellVersion: trade.version,
      instrumentId: trade.instrumentId,
      instrumentName: trade.instrumentName,
      instrumentSymbol: trade.instrumentSymbol,
      occurredAt: trade.occurredAt,
      orderWithinTimestamp: trade.orderWithinTimestamp,
      quantity: trade.quantity,
      grossUsd: trade.grossUsd,
      feeUsd: trade.feeUsd,
      netUsd: formatAtoms(gross - fee),
      consumedCostUsd: formatAtoms(saleCost),
      realizedUsd: formatAtoms(gross - fee - saleCost),
    });
  }

  return {
    summary: {
      grossBuysUsd: formatAtoms(grossBuys),
      buyFeesUsd: formatAtoms(buyFees),
      grossSalesUsd: formatAtoms(grossSales),
      sellFeesUsd: formatAtoms(sellFees),
      netSalesUsd: formatAtoms(grossSales - sellFees),
      consumedCostUsd: formatAtoms(consumedCost),
      realizedUsd: formatAtoms(grossSales - sellFees - consumedCost),
      remainingCostUsd: formatAtoms(carryInCost + grossBuys + buyFees - consumedCost),
    },
    lots: lots.filter((lot) => lot.disposed < lot.quantity).map(projectLot),
    realizations,
    matches,
  };
}
