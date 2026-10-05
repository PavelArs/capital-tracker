import type { FifoReward, RewardSummary } from './asset-reward-types';
import { swapAtoms } from './asset-swap-fifo';
import type { FifoSwap, SwapAllocation, SwapSummary } from './asset-swap-types';
import { CostTally } from './cost-evidence';
import type { CarryInFifoResult, FifoCarryInInput, FifoTrade } from './fifo';
import {
  FifoHistoryError,
  intervalCost,
  type LotInterval,
  lotInterval,
  takePrefix,
} from './fifo-lot-interval';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type {
  AccountFifoResult,
  LotOrigin,
  ReceivedSaleMatch,
  RewardSaleMatch,
  SwapSaleMatch,
  TransferAllocationItem,
  TransferArrival,
  TransferFeeSummary,
} from './owned-transfer-types';
import { settlementLeg } from './trade-settlement';

type Source =
  | { kind: 'trade'; trade: FifoTrade }
  | { kind: 'carry-in'; lot: FifoCarryInInput; carriedCostUsd: string }
  | { kind: 'reward'; reward: FifoReward }
  | { kind: 'swap'; swap: FifoSwap };

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
      : origin.kind === 'reward'
        ? origin.rewardId
        : origin.swapId;
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

/**
 * A trade's cash side as a trade in the cash asset (M9): what a sale kept, bought at its net
 * proceeds, or what a buy spent, sold at its share of the buy's cost. It shares the trade's
 * identity and instant and never counts as a buy or sale of its own in the summary.
 */
function cashSide(trade: FifoTrade): FifoTrade | null {
  const leg = settlementLeg(trade);
  if (!leg || !trade.settlement) return null;
  return {
    tradeId: trade.tradeId,
    version: trade.version,
    instrumentId: trade.settlement.instrumentId,
    instrumentName: trade.settlement.instrumentName,
    instrumentSymbol: trade.settlement.instrumentSymbol,
    side: trade.side === 'buy' ? 'sell' : 'buy',
    occurredAt: trade.occurredAt,
    orderWithinTimestamp: trade.orderWithinTimestamp,
    quantity: formatAtoms(leg.quantity),
    grossUsd: formatAtoms(leg.usd),
    feeUsd: '0',
  };
}

function swapItem(kind: 'principal' | 'fee', portion: BookPortion): TransferAllocationItem {
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
  private hasSwapIdentity = false;
  private swapCount = 0;
  private readonly swapConsideration = new CostTally();
  private readonly swapPrincipalBasis = new CostTally();
  private readonly swapFeeBasis = new CostTally();
  private swapKnownRealized = 0n;
  private swapUnknownRealizedCount = 0;
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

  markSwapIdentity(): void {
    this.hasSwapIdentity = true;
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

  /** A swap is one chronology event, with an explicit gross acquisition and one fee debit. */
  applySwap(swap: FifoSwap): SwapAllocation {
    this.occupy(swap.occurredAt, swap.orderWithinTimestamp);
    const { outgoing, incoming, fee, consideration } = swapAtoms(swap);
    const principal = this.consume(swap.outgoingInstrumentId, outgoing);
    let feePortions: BookPortion[] = [];
    if (swap.feeSource === 'held') {
      if (swap.feeInstrumentId === null) throw new FifoHistoryError();
      feePortions = this.consume(swap.feeInstrumentId, fee);
    }

    const fragment: BookFragment = {
      source: { kind: 'swap', swap },
      origin: {
        accountId: this.accountId,
        kind: 'swap',
        swapId: swap.swapId,
        version: swap.version,
        acquiredAt: swap.occurredAt,
        orderWithinTimestamp: swap.orderWithinTimestamp,
        originalQuantity: swap.incomingQuantity,
        originalCostUsd: swap.considerationUsd,
      },
      arrival: null,
      instrumentId: swap.incomingInstrumentId,
      instrumentName: swap.incomingInstrumentName,
      instrumentSymbol: swap.incomingInstrumentSymbol,
      interval: lotInterval(incoming, consideration),
    };
    if (swap.feeSource === 'incoming') {
      this.limits.match?.();
      const { taken, remainder } = takePrefix(fragment.interval, fee);
      feePortions = [{ fragment, interval: taken, cost: intervalCost(taken) }];
      fragment.interval = remainder;
    }
    if (fragment.interval.start < fragment.interval.end) this.append(fragment);

    const principalBasis = new CostTally();
    for (const portion of principal) principalBasis.add(portion.cost);
    const feeBasis = new CostTally();
    for (const portion of feePortions) feeBasis.add(portion.cost);
    const complete = consideration !== null && !principalBasis.incomplete && !feeBasis.incomplete;
    const realized = complete ? consideration - principalBasis.known - feeBasis.known : null;
    this.hasSwapIdentity = true;
    this.swapCount++;
    this.swapConsideration.add(consideration);
    for (const portion of principal) this.swapPrincipalBasis.add(portion.cost);
    for (const portion of feePortions) this.swapFeeBasis.add(portion.cost);
    if (realized === null) this.swapUnknownRealizedCount++;
    else this.swapKnownRealized += realized;
    return {
      swapId: swap.swapId,
      considerationUsd: swap.considerationUsd,
      principalBasisUsd: principalBasis.value,
      feeConsumedBasisUsd: feeBasis.value,
      realizedUsd: realized === null ? null : formatAtoms(realized),
      coverage: {
        consideration: {
          knownSubtotalUsd: consideration === null ? '0' : formatAtoms(consideration),
          unknownCount: consideration === null ? 1 : 0,
        },
        principal: principalBasis.coverage,
        fee: feeBasis.coverage,
        realized: {
          knownSubtotalUsd: realized === null ? '0' : formatAtoms(realized),
          unknownCount: realized === null ? 1 : 0,
        },
      },
      items: [
        ...principal.map((portion) => swapItem('principal', portion)),
        ...feePortions.map((portion) => swapItem('fee', portion)),
      ],
    };
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
    const cash = cashSide(trade);
    if (trade.side === 'buy') {
      // The account's cash pays first (OPS-BUY-CASH).
      if (cash) this.sell(cash);
      this.buy(trade, gross + fee);
      this.grossBuys += gross;
      this.buyFees += fee;
      return;
    }
    this.sell(trade);
    this.grossSales += gross;
    this.sellFees += fee;
    // The proceeds stay in the account as cash (OPS-SELL-CASH).
    if (cash) this.buy(cash, canonicalDecimalToAtoms(cash.grossUsd));
  }

  private buy(trade: FifoTrade, cost: bigint): void {
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
      interval: lotInterval(canonicalDecimalToAtoms(trade.quantity), cost),
    });
  }

  private sell(trade: FifoTrade): void {
    const gross = canonicalDecimalToAtoms(trade.grossUsd);
    const fee = canonicalDecimalToAtoms(trade.feeUsd);
    const portions = this.consume(trade.instrumentId, canonicalDecimalToAtoms(trade.quantity));
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
      } else if (fragment.source.kind === 'reward') {
        const match: RewardSaleMatch = {
          ...common,
          sourceKind: 'reward',
          origin: fragment.origin as Extract<LotOrigin, { kind: 'reward' }>,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
        };
        this.matches.push(match);
      } else {
        const match: SwapSaleMatch = {
          ...common,
          sourceKind: 'swap',
          origin: fragment.origin as Extract<LotOrigin, { kind: 'swap' }>,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
        };
        this.matches.push(match);
      }
    }
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
      } else if (fragment.source.kind === 'reward') {
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
      } else {
        lots.push({
          sourceKind: 'swap',
          instrumentId: fragment.instrumentId,
          instrumentName: fragment.instrumentName,
          instrumentSymbol: fragment.instrumentSymbol,
          origin: fragment.origin as Extract<LotOrigin, { kind: 'swap' }>,
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
    if (this.hasSwapIdentity) {
      const swapSummary: SwapSummary = {
        activeCount: this.swapCount,
        considerationUsd: this.swapConsideration.value,
        principalBasisUsd: this.swapPrincipalBasis.value,
        feeConsumedBasisUsd: this.swapFeeBasis.value,
        realizedUsd: this.swapUnknownRealizedCount > 0 ? null : formatAtoms(this.swapKnownRealized),
        coverage: {
          consideration: this.swapConsideration.coverage,
          principal: this.swapPrincipalBasis.coverage,
          fee: this.swapFeeBasis.coverage,
          realized: {
            knownSubtotalUsd: formatAtoms(this.swapKnownRealized),
            unknownCount: this.swapUnknownRealizedCount,
          },
        },
      };
      result.swapSummary = swapSummary;
    }
    return result;
  }

  /** The legacy wrapper never receives a fragment and keeps its exact DTO type. */
  projectLegacy(): CarryInFifoResult {
    if (this.participant || this.hasRewardIdentity || this.hasSwapIdentity)
      throw new FifoHistoryError();
    return this.project() as CarryInFifoResult;
  }
}
