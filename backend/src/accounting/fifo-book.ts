import type { CarryInFifoResult, FifoCarryInInput, FifoTrade } from './fifo';
import {
  FifoHistoryError,
  type LotInterval,
  intervalCost,
  lotInterval,
  takePrefix,
} from './fifo-lot-interval';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type {
  AccountFifoResult,
  LotOrigin,
  ReceivedSaleMatch,
  TransferArrival,
  TransferFeeSummary,
} from './owned-transfer-types';

type Source =
  | { kind: 'trade'; trade: FifoTrade }
  | { kind: 'carry-in'; lot: FifoCarryInInput; carriedCostUsd: string };

export interface BookFragment {
  source: Source;
  origin: LotOrigin;
  arrival: TransferArrival | null;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  interval: LotInterval;
}

export interface BookPortion {
  fragment: BookFragment;
  interval: LotInterval;
  cost: bigint;
}

export interface BookLimits {
  match?: () => void;
  addFragment?: () => void;
  removeFragment?: () => void;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identity(origin: LotOrigin): string {
  return origin.kind === 'trade' ? origin.tradeId : origin.lotId;
}

/** Priority after a fragment arrives; its original cost coordinates are never rebased. */
function compareFragments(left: BookFragment, right: BookFragment): number {
  const a = left.origin;
  const b = right.origin;
  return (
    compareText(a.acquiredAt, b.acquiredAt) ||
    a.orderWithinTimestamp - b.orderWithinTimestamp ||
    compareText(a.accountId, b.accountId) ||
    compareText(a.kind, b.kind) ||
    compareText(identity(a), identity(b)) ||
    (a.kind === 'trade' && b.kind === 'trade'
      ? a.version - b.version
      : a.kind === 'carry-in' && b.kind === 'carry-in'
        ? a.openingRevision - b.openingRevision || a.ordinal - b.ordinal
        : 0) ||
    (left.interval.start < right.interval.start
      ? -1
      : left.interval.start > right.interval.start
        ? 1
        : 0)
  );
}

/** Mutable only within a single pure projection; no input row is modified. */
export class FifoBook {
  private readonly queues = new Map<string, BookFragment[]>();
  private readonly held = new Set<BookFragment>();
  private readonly chronology = new Set<string>();
  private readonly matches: AccountFifoResult['matches'] = [];
  private readonly realizations: AccountFifoResult['realizations'] = [];
  private readonly fees = new Map<
    string,
    Omit<TransferFeeSummary, 'quantity' | 'consumedBasisUsd'> & {
      quantity: bigint;
      consumedBasisUsd: bigint;
    }
  >();
  private grossBuys = 0n;
  private buyFees = 0n;
  private grossSales = 0n;
  private sellFees = 0n;
  private consumedCost = 0n;
  private receivedBasis = 0n;
  private sentBasis = 0n;
  private feeConsumedBasis = 0n;
  private participant = false;

  constructor(
    readonly accountId: string,
    private readonly limits: BookLimits = {},
  ) {}

  private append(fragment: BookFragment): void {
    this.limits.addFragment?.();
    const queue = this.queues.get(fragment.instrumentId) ?? [];
    queue.push(fragment);
    this.queues.set(fragment.instrumentId, queue);
    this.held.add(fragment);
  }

  addInitial(lot: FifoCarryInInput): void {
    const quantity = canonicalDecimalToAtoms(lot.originalQuantity);
    const cost = canonicalDecimalToAtoms(lot.originalCostUsd);
    const carried = canonicalDecimalToAtoms(lot.carriedQuantity);
    if (quantity <= 0n || cost < 0n || carried <= 0n || carried > quantity)
      throw new FifoHistoryError();
    const interval = lotInterval(quantity, cost, quantity - carried);
    const carriedCostUsd = formatAtoms(intervalCost(interval));
    this.append({
      source: { kind: 'carry-in', lot, carriedCostUsd },
      origin: {
        accountId: this.accountId,
        kind: 'carry-in',
        lotId: lot.lotId,
        openingRevision: lot.openingRevision,
        ordinal: lot.ordinal,
        acquiredAt: lot.acquiredAt,
        orderWithinTimestamp: lot.orderWithinTimestamp,
        originalQuantity: lot.originalQuantity,
        originalCostUsd: lot.originalCostUsd,
      },
      arrival: null,
      instrumentId: lot.instrumentId,
      instrumentName: lot.instrumentName,
      instrumentSymbol: lot.instrumentSymbol,
      interval,
    });
  }

  occupy(occurredAt: string, orderWithinTimestamp: number): void {
    const key = JSON.stringify([occurredAt, orderWithinTimestamp]);
    if (this.chronology.has(key)) throw new FifoHistoryError();
    this.chronology.add(key);
  }

  applyTrade(trade: FifoTrade): void {
    this.occupy(trade.occurredAt, trade.orderWithinTimestamp);
    const quantity = canonicalDecimalToAtoms(trade.quantity);
    const gross = canonicalDecimalToAtoms(trade.grossUsd);
    const fee = canonicalDecimalToAtoms(trade.feeUsd);
    if (quantity <= 0n || gross <= 0n || fee < 0n) throw new FifoHistoryError();
    if (trade.side === 'buy') {
      const cost = gross + fee;
      this.append({
        source: { kind: 'trade', trade },
        origin: {
          accountId: this.accountId,
          kind: 'trade',
          tradeId: trade.tradeId,
          version: trade.version,
          acquiredAt: trade.occurredAt,
          orderWithinTimestamp: trade.orderWithinTimestamp,
          originalQuantity: trade.quantity,
          originalCostUsd: formatAtoms(cost),
        },
        arrival: null,
        instrumentId: trade.instrumentId,
        instrumentName: trade.instrumentName,
        instrumentSymbol: trade.instrumentSymbol,
        interval: lotInterval(quantity, cost),
      });
      this.grossBuys += gross;
      this.buyFees += fee;
      return;
    }
    const portions = this.consume(trade.instrumentId, quantity);
    let saleCost = 0n;
    for (const portion of portions) {
      saleCost += portion.cost;
      const { fragment, interval } = portion;
      const common = {
        sellTradeId: trade.tradeId,
        sellVersion: trade.version,
        quantity: formatAtoms(interval.end - interval.start),
        costUsd: formatAtoms(portion.cost),
      };
      if (fragment.arrival) {
        const match: ReceivedSaleMatch = {
          ...common,
          sourceKind: 'transfer',
          origin: fragment.origin,
          arrival: fragment.arrival,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
        };
        this.matches.push(match);
      } else if (fragment.source.kind === 'trade') {
        this.matches.push({
          ...common,
          buyTradeId: fragment.source.trade.tradeId,
          buyVersion: fragment.source.trade.version,
        });
      } else {
        this.matches.push({
          ...common,
          sourceKind: 'carry-in',
          lotId: fragment.source.lot.lotId,
          openingRevision: fragment.source.lot.openingRevision,
          ordinal: fragment.source.lot.ordinal,
        });
      }
    }
    this.grossSales += gross;
    this.sellFees += fee;
    this.consumedCost += saleCost;
    this.realizations.push({
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

  /** Consume available inventory in FIFO order without declaring a sale. */
  consume(instrumentId: string, quantity: bigint): BookPortion[] {
    if (quantity <= 0n) throw new FifoHistoryError();
    const queue = this.queues.get(instrumentId);
    if (!queue) throw new FifoHistoryError();
    const portions: BookPortion[] = [];
    let remaining = quantity;
    while (remaining > 0n) {
      const fragment = queue[0];
      if (!fragment) throw new FifoHistoryError();
      const available = fragment.interval.end - fragment.interval.start;
      const matched = remaining < available ? remaining : available;
      this.limits.match?.();
      const { taken, remainder } = takePrefix(fragment.interval, matched);
      fragment.interval = remainder;
      portions.push({ fragment, interval: taken, cost: intervalCost(taken) });
      remaining -= matched;
      if (remainder.start === remainder.end) {
        queue.shift();
        this.held.delete(fragment);
        this.limits.removeFragment?.();
      }
    }
    return portions;
  }

  receive(portions: readonly BookPortion[], arrival: TransferArrival): void {
    for (const portion of portions) {
      this.limits.addFragment?.();
      const fragment: BookFragment = {
        source: portion.fragment.source,
        origin: portion.fragment.origin,
        arrival,
        instrumentId: portion.fragment.instrumentId,
        instrumentName: portion.fragment.instrumentName,
        instrumentSymbol: portion.fragment.instrumentSymbol,
        interval: portion.interval,
      };
      const queue = this.queues.get(fragment.instrumentId) ?? [];
      queue.sort(compareFragments);
      let low = 0;
      let high = queue.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareFragments(queue[middle], fragment) <= 0) low = middle + 1;
        else high = middle;
      }
      queue.splice(low, 0, fragment);
      this.queues.set(fragment.instrumentId, queue);
      this.held.add(fragment);
      this.receivedBasis += portion.cost;
    }
    this.participant = true;
  }

  recordSent(portions: readonly BookPortion[]): void {
    this.participant = true;
    for (const portion of portions) this.sentBasis += portion.cost;
  }

  recordFee(portions: readonly BookPortion[]): void {
    this.participant = true;
    for (const portion of portions) {
      this.feeConsumedBasis += portion.cost;
      const { fragment, interval } = portion;
      const current = this.fees.get(fragment.instrumentId) ?? {
        instrumentId: fragment.instrumentId,
        instrumentName: fragment.instrumentName,
        instrumentSymbol: fragment.instrumentSymbol,
        quantity: 0n,
        consumedBasisUsd: 0n,
      };
      current.quantity += interval.end - interval.start;
      current.consumedBasisUsd += portion.cost;
      this.fees.set(fragment.instrumentId, current);
    }
  }

  project(): AccountFifoResult {
    let remainingCost = 0n;
    const lots: AccountFifoResult['lots'] = [];
    for (const fragment of this.held) {
      const interval = fragment.interval;
      const remainingQuantity = formatAtoms(interval.end - interval.start);
      const remainingCostUsd = formatAtoms(intervalCost(interval));
      remainingCost += intervalCost(interval);
      if (fragment.arrival) {
        lots.push({
          sourceKind: 'transfer',
          instrumentId: fragment.instrumentId,
          instrumentName: fragment.instrumentName,
          instrumentSymbol: fragment.instrumentSymbol,
          origin: fragment.origin,
          arrival: fragment.arrival,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
          remainingQuantity,
          remainingCostUsd,
        });
      } else if (fragment.source.kind === 'trade') {
        const trade = fragment.source.trade;
        lots.push({
          buyTradeId: trade.tradeId,
          buyVersion: trade.version,
          instrumentId: trade.instrumentId,
          instrumentName: trade.instrumentName,
          instrumentSymbol: trade.instrumentSymbol,
          occurredAt: trade.occurredAt,
          orderWithinTimestamp: trade.orderWithinTimestamp,
          originalQuantity: trade.quantity,
          originalCostUsd: formatAtoms(interval.originalCost),
          remainingQuantity,
          remainingCostUsd,
        });
      } else {
        lots.push({
          sourceKind: 'carry-in',
          ...fragment.source.lot,
          carriedCostUsd: fragment.source.carriedCostUsd,
          remainingQuantity,
          remainingCostUsd,
        });
      }
    }
    const result: AccountFifoResult = {
      summary: {
        grossBuysUsd: formatAtoms(this.grossBuys),
        buyFeesUsd: formatAtoms(this.buyFees),
        grossSalesUsd: formatAtoms(this.grossSales),
        sellFeesUsd: formatAtoms(this.sellFees),
        netSalesUsd: formatAtoms(this.grossSales - this.sellFees),
        consumedCostUsd: formatAtoms(this.consumedCost),
        realizedUsd: formatAtoms(this.grossSales - this.sellFees - this.consumedCost),
        remainingCostUsd: formatAtoms(remainingCost),
      },
      lots,
      realizations: this.realizations,
      matches: this.matches,
    };
    if (this.participant) {
      result.transferSummary = {
        receivedBasisUsd: formatAtoms(this.receivedBasis),
        sentBasisUsd: formatAtoms(this.sentBasis),
        feeConsumedBasisUsd: formatAtoms(this.feeConsumedBasis),
        fees: [...this.fees.values()]
          .sort((left, right) => compareText(left.instrumentId, right.instrumentId))
          .map((fee) => ({
            instrumentId: fee.instrumentId,
            instrumentName: fee.instrumentName,
            instrumentSymbol: fee.instrumentSymbol,
            quantity: formatAtoms(fee.quantity),
            consumedBasisUsd: formatAtoms(fee.consumedBasisUsd),
          })),
      };
    }
    return result;
  }

  /** The legacy wrapper never receives a fragment and keeps its exact DTO type. */
  projectLegacy(): CarryInFifoResult {
    if (this.participant) throw new FifoHistoryError();
    return this.project() as CarryInFifoResult;
  }
}
