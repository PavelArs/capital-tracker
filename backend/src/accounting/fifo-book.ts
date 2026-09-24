import type { FifoReward, RewardSummary } from './asset-reward-types';
import { CostTally } from './cost-evidence';
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
  RewardSaleMatch,
  TransferArrival,
  TransferFeeSummary,
} from './owned-transfer-types';

type Source =
  | { kind: 'trade'; trade: FifoTrade }
  | { kind: 'carry-in'; lot: FifoCarryInInput; carriedCostUsd: string }
  | { kind: 'reward'; reward: FifoReward };

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
  cost: bigint | null;
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
  return origin.kind === 'trade'
    ? origin.tradeId
    : origin.kind === 'carry-in'
      ? origin.lotId
      : origin.rewardId;
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
    Pick<TransferFeeSummary, 'instrumentId' | 'instrumentName' | 'instrumentSymbol'> & {
      quantity: bigint;
      basis: CostTally;
      unknownCostQuantity: bigint;
    }
  >();
  private grossBuys = 0n;
  private buyFees = 0n;
  private grossSales = 0n;
  private sellFees = 0n;
  private readonly consumedCost = new CostTally();
  private readonly receivedBasis = new CostTally();
  private readonly sentBasis = new CostTally();
  private readonly feeConsumedBasis = new CostTally();
  private knownRealized = 0n;
  private unknownRealizedCount = 0;
  private hasRewardIdentity = false;
  private rewardCount = 0;
  private readonly rewardBasis = new CostTally();
  private readonly rewardIncome = new CostTally();
  private knownCategorizedIncome = 0n;
  private unclassifiedRewards = 0;
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

  markRewardIdentity(): void {
    this.hasRewardIdentity = true;
  }

  applyReward(reward: FifoReward): void {
    this.occupy(reward.occurredAt, reward.orderWithinTimestamp);
    const quantity = canonicalDecimalToAtoms(reward.quantity);
    const basis =
      reward.acquisitionBasisUsd === null
        ? null
        : canonicalDecimalToAtoms(reward.acquisitionBasisUsd);
    const income =
      reward.incomeValueUsd === null ? null : canonicalDecimalToAtoms(reward.incomeValueUsd);
    if (quantity <= 0n || (basis !== null && basis < 0n) || (income !== null && income < 0n))
      throw new FifoHistoryError();
    this.append({
      source: { kind: 'reward', reward },
      origin: {
        accountId: this.accountId,
        kind: 'reward',
        rewardId: reward.rewardId,
        version: reward.version,
        category: reward.category,
        acquiredAt: reward.occurredAt,
        orderWithinTimestamp: reward.orderWithinTimestamp,
        originalQuantity: reward.quantity,
        originalCostUsd: reward.acquisitionBasisUsd,
      },
      arrival: null,
      instrumentId: reward.instrumentId,
      instrumentName: reward.instrumentName,
      instrumentSymbol: reward.instrumentSymbol,
      interval: lotInterval(quantity, basis),
    });
    this.hasRewardIdentity = true;
    this.rewardCount++;
    this.rewardBasis.add(basis);
    this.rewardIncome.add(income);
    if (reward.category === 'unclassified') this.unclassifiedRewards++;
    else if (income !== null) this.knownCategorizedIncome += income;
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
    const saleCost = new CostTally();
    for (const portion of portions) {
      saleCost.add(portion.cost);
      this.consumedCost.add(portion.cost);
      const { fragment, interval } = portion;
      const common = {
        sellTradeId: trade.tradeId,
        sellVersion: trade.version,
        quantity: formatAtoms(interval.end - interval.start),
        costUsd: portion.cost === null ? null : formatAtoms(portion.cost),
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
        if (portion.cost === null) throw new FifoHistoryError();
        this.matches.push({
          ...common,
          costUsd: formatAtoms(portion.cost),
          buyTradeId: fragment.source.trade.tradeId,
          buyVersion: fragment.source.trade.version,
        });
      } else if (fragment.source.kind === 'carry-in') {
        if (portion.cost === null) throw new FifoHistoryError();
        this.matches.push({
          ...common,
          costUsd: formatAtoms(portion.cost),
          sourceKind: 'carry-in',
          lotId: fragment.source.lot.lotId,
          openingRevision: fragment.source.lot.openingRevision,
          ordinal: fragment.source.lot.ordinal,
        });
      } else {
        const match: RewardSaleMatch = {
          ...common,
          sourceKind: 'reward',
          origin: fragment.origin as Extract<LotOrigin, { kind: 'reward' }>,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
        };
        this.matches.push(match);
      }
    }
    this.grossSales += gross;
    this.sellFees += fee;
    if (saleCost.incomplete) this.unknownRealizedCount++;
    else this.knownRealized += gross - fee - saleCost.known;
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
      consumedCostUsd: saleCost.value,
      realizedUsd: saleCost.incomplete ? null : formatAtoms(gross - fee - saleCost.known),
      ...(saleCost.incomplete
        ? {
            basisCoverage: {
              knownConsumedCostUsd: formatAtoms(saleCost.known),
              unknownMatchCount: saleCost.unknownCount,
            },
          }
        : {}),
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
    const sortedInThisReceive = new Set<string>();
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
      if (!sortedInThisReceive.has(fragment.instrumentId)) {
        queue.sort(compareFragments);
        sortedInThisReceive.add(fragment.instrumentId);
      }
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
      this.receivedBasis.add(portion.cost);
    }
    this.participant = true;
  }

  recordSent(portions: readonly BookPortion[]): void {
    this.participant = true;
    for (const portion of portions) this.sentBasis.add(portion.cost);
  }

  recordFee(portions: readonly BookPortion[]): void {
    this.participant = true;
    for (const portion of portions) {
      this.feeConsumedBasis.add(portion.cost);
      const { fragment, interval } = portion;
      const current = this.fees.get(fragment.instrumentId) ?? {
        instrumentId: fragment.instrumentId,
        instrumentName: fragment.instrumentName,
        instrumentSymbol: fragment.instrumentSymbol,
        quantity: 0n,
        basis: new CostTally(),
        unknownCostQuantity: 0n,
      };
      current.quantity += interval.end - interval.start;
      current.basis.add(portion.cost);
      if (portion.cost === null) current.unknownCostQuantity += interval.end - interval.start;
      this.fees.set(fragment.instrumentId, current);
    }
  }

  project(): AccountFifoResult {
    const remainingCost = new CostTally();
    const lots: AccountFifoResult['lots'] = [];
    for (const fragment of this.held) {
      const interval = fragment.interval;
      const remainingQuantity = formatAtoms(interval.end - interval.start);
      const cost = intervalCost(interval);
      const remainingCostUsd = cost === null ? null : formatAtoms(cost);
      remainingCost.add(cost);
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
        if (cost === null || interval.originalCost === null) throw new FifoHistoryError();
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
          remainingCostUsd: formatAtoms(cost),
        });
      } else if (fragment.source.kind === 'carry-in') {
        if (cost === null) throw new FifoHistoryError();
        lots.push({
          sourceKind: 'carry-in',
          ...fragment.source.lot,
          carriedCostUsd: fragment.source.carriedCostUsd,
          remainingQuantity,
          remainingCostUsd: formatAtoms(cost),
        });
      } else {
        lots.push({
          sourceKind: 'reward',
          instrumentId: fragment.instrumentId,
          instrumentName: fragment.instrumentName,
          instrumentSymbol: fragment.instrumentSymbol,
          origin: fragment.origin as Extract<LotOrigin, { kind: 'reward' }>,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
          remainingQuantity,
          remainingCostUsd,
        });
      }
    }
    const incomplete =
      this.consumedCost.incomplete || remainingCost.incomplete || this.unknownRealizedCount > 0;
    const result: AccountFifoResult = {
      summary: {
        grossBuysUsd: formatAtoms(this.grossBuys),
        buyFeesUsd: formatAtoms(this.buyFees),
        grossSalesUsd: formatAtoms(this.grossSales),
        sellFeesUsd: formatAtoms(this.sellFees),
        netSalesUsd: formatAtoms(this.grossSales - this.sellFees),
        consumedCostUsd: this.consumedCost.value,
        realizedUsd: this.unknownRealizedCount > 0 ? null : formatAtoms(this.knownRealized),
        remainingCostUsd: remainingCost.value,
        ...(incomplete
          ? {
              basisCoverage: {
                consumed: this.consumedCost.coverage,
                remaining: remainingCost.coverage,
                realized: {
                  knownSubtotalUsd: formatAtoms(this.knownRealized),
                  unknownCount: this.unknownRealizedCount,
                },
              },
            }
          : {}),
      },
      lots,
      realizations: this.realizations,
      matches: this.matches,
    };
    if (this.participant) {
      result.transferSummary = {
        receivedBasisUsd: this.receivedBasis.value,
        sentBasisUsd: this.sentBasis.value,
        feeConsumedBasisUsd: this.feeConsumedBasis.value,
        fees: [...this.fees.values()]
          .sort((left, right) => compareText(left.instrumentId, right.instrumentId))
          .map((fee) => ({
            instrumentId: fee.instrumentId,
            instrumentName: fee.instrumentName,
            instrumentSymbol: fee.instrumentSymbol,
            quantity: formatAtoms(fee.quantity),
            consumedBasisUsd: fee.basis.value,
            ...(fee.basis.incomplete
              ? {
                  knownBasisSubtotalUsd: formatAtoms(fee.basis.known),
                  unknownCostQuantity: formatAtoms(fee.unknownCostQuantity),
                }
              : {}),
          })),
        ...(this.receivedBasis.incomplete ||
        this.sentBasis.incomplete ||
        this.feeConsumedBasis.incomplete
          ? {
              basisCoverage: {
                received: this.receivedBasis.coverage,
                sent: this.sentBasis.coverage,
                fee: this.feeConsumedBasis.coverage,
              },
            }
          : {}),
      };
    }
    if (this.hasRewardIdentity) {
      const rewardSummary: RewardSummary = {
        activeCount: this.rewardCount,
        declaredBasisUsd: this.rewardBasis.value,
        declaredIncomeUsd:
          this.rewardIncome.incomplete || this.unclassifiedRewards > 0
            ? null
            : formatAtoms(this.rewardIncome.known),
        knownBasisSubtotalUsd: formatAtoms(this.rewardBasis.known),
        knownIncomeSubtotalUsd: formatAtoms(this.knownCategorizedIncome),
        unknownBasisCount: this.rewardBasis.unknownCount,
        unknownIncomeCount: this.rewardIncome.unknownCount,
        unclassifiedCount: this.unclassifiedRewards,
      };
      result.rewardSummary = rewardSummary;
    }
    return result;
  }

  /** The legacy wrapper never receives a fragment and keeps its exact DTO type. */
  projectLegacy(): CarryInFifoResult {
    if (this.participant || this.hasRewardIdentity) throw new FifoHistoryError();
    return this.project() as CarryInFifoResult;
  }
}
