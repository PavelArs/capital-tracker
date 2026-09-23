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

export const MAX_ACTIVE_TRADES = 1000;

export class FifoHistoryError extends Error {
  constructor() {
    super('Invalid trade history');
    this.name = 'FifoHistoryError';
  }
}

interface WorkingLot {
  trade: FifoTrade;
  quantity: bigint;
  cost: bigint;
  disposed: bigint;
  allocated: bigint;
}

interface InstrumentQueue {
  lots: WorkingLot[];
  head: number;
}

/** Rebuild one account's complete normalized active history; never mutate its input. */
export function calculateFifo(trades: readonly FifoTrade[]): FifoResult {
  if (trades.length > MAX_ACTIVE_TRADES) throw new FifoHistoryError();
  const ordered = [...trades].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
    return left.orderWithinTimestamp - right.orderWithinTimestamp;
  });
  const queues = new Map<string, InstrumentQueue>();
  const lots: WorkingLot[] = [];
  const matches: FifoMatch[] = [];
  const realizations: FifoRealization[] = [];
  let grossBuys = 0n;
  let buyFees = 0n;
  let grossSales = 0n;
  let sellFees = 0n;
  let consumedCost = 0n;
  let previous: FifoTrade | undefined;

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
      const lot: WorkingLot = { trade, quantity, cost: gross + fee, disposed: 0n, allocated: 0n };
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
      matches.push({
        sellTradeId: trade.tradeId,
        sellVersion: trade.version,
        buyTradeId: lot.trade.tradeId,
        buyVersion: lot.trade.version,
        quantity: formatAtoms(matched),
        costUsd: formatAtoms(cost),
      });
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
      remainingCostUsd: formatAtoms(grossBuys + buyFees - consumedCost),
    },
    lots: lots
      .filter((lot) => lot.disposed < lot.quantity)
      .map((lot) => ({
        buyTradeId: lot.trade.tradeId,
        buyVersion: lot.trade.version,
        instrumentId: lot.trade.instrumentId,
        instrumentName: lot.trade.instrumentName,
        instrumentSymbol: lot.trade.instrumentSymbol,
        occurredAt: lot.trade.occurredAt,
        orderWithinTimestamp: lot.trade.orderWithinTimestamp,
        originalQuantity: lot.trade.quantity,
        originalCostUsd: formatAtoms(lot.cost),
        remainingQuantity: formatAtoms(lot.quantity - lot.disposed),
        remainingCostUsd: formatAtoms(lot.cost - lot.allocated),
      })),
    realizations,
    matches,
  };
}
