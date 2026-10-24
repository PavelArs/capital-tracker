import type { FifoReward, RewardSummary } from './asset-reward-types';
import { swapAtoms } from './asset-swap-fifo';
import type { FifoSwap, SwapAllocation, SwapSummary } from './asset-swap-types';
import type {
  CapitalReturnAllocation,
  CapitalReturnAllocationItem,
  CapitalReturnSummary,
  FifoCapitalReturn,
  ReturnedPart,
} from './capital-return-types';
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
  CapitalReturnSaleMatch,
  LotOrigin,
  ReceivedSaleMatch,
  RewardSaleMatch,
  SwapSaleMatch,
  TransferAllocationItem,
  TransferArrival,
  TransferFeeSummary,
} from './owned-transfer-types';
import type { PaidCurrency } from './paid-currency';
import { settlementLeg } from './trade-settlement';

type Source =
  | { kind: 'trade'; trade: FifoTrade }
  | { kind: 'carry-in'; lot: FifoCarryInInput; carriedCostUsd: string }
  | { kind: 'reward'; reward: FifoReward }
  | { kind: 'swap'; swap: FifoSwap }
  | { kind: 'capital-return'; capitalReturn: FifoCapitalReturn };

/** What one capital return took off a fragment's cost, in the fragment's own quantity range. */
interface ReturnSlice {
  capitalReturnId: string;
  version: number;
  occurredAt: string;
  currency: PaidCurrency | null;
  usd: LotInterval;
  native: LotInterval | null;
}

/**
 * `interval` is the fragment's place in its original lot and never moves: it orders fragments
 * and names the origin. `cost` holds what the units cost now, rebased by every capital return,
 * and covers the same quantity as `interval`; `returns` say what the returns took.
 */
export interface BookFragment {
  source: Source;
  origin: LotOrigin;
  arrival: TransferArrival | null;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  interval: LotInterval;
  cost: LotInterval;
  /** What the units were paid in RUB or EUR, still held after the returns; null when in USD. */
  paidCost: PaidCost | null;
  returns: readonly ReturnSlice[];
}

interface PaidCost {
  currency: PaidCurrency;
  cost: LotInterval;
}

export interface BookPortion {
  fragment: BookFragment;
  interval: LotInterval;
  cost: bigint | null;
  costInterval: LotInterval;
  paidCost: PaidCost | null;
  returns: readonly ReturnSlice[];
}

type Returned = { returned: ReturnedPart[] } | Record<string, never>;

/** The part of its cost the returns took off the taken units, for the lot or match. */
export function portionReturned(portion: { returns: readonly ReturnSlice[] }): Returned {
  return returnedParts(portion.returns);
}

function returnedParts(returns: readonly ReturnSlice[]): Returned {
  const parts: ReturnedPart[] = [];
  for (const slice of returns) {
    const usd = intervalCost(slice.usd);
    const native = slice.native === null ? null : intervalCost(slice.native);
    if (usd === null || (usd === 0n && !native)) continue;
    parts.push({
      capitalReturnId: slice.capitalReturnId,
      version: slice.version,
      occurredAt: slice.occurredAt,
      usd: formatAtoms(usd),
      ...(slice.currency !== null && native !== null
        ? { native: { currency: slice.currency, amount: formatAtoms(native) } }
        : {}),
    });
  }
  return parts.length ? { returned: parts } : {};
}

/** A fresh fragment: its cost is its place in the original lot until a return lowers it. */
function fragmentOf(
  fields: Omit<BookFragment, 'cost' | 'returns' | 'paidCost'>,
  paidCost: PaidCost | null = null,
): BookFragment {
  return { ...fields, cost: fields.interval, paidCost, returns: [] };
}

/** Take the first `quantity` units of a fragment, with their cost and what returns took. */
function takeFromFragment(fragment: BookFragment, quantity: bigint): BookPortion {
  const place = takePrefix(fragment.interval, quantity);
  const cost = takePrefix(fragment.cost, quantity);
  const paid = fragment.paidCost && {
    currency: fragment.paidCost.currency,
    ...takePrefix(fragment.paidCost.cost, quantity),
  };
  const taken: ReturnSlice[] = [];
  const kept: ReturnSlice[] = [];
  for (const slice of fragment.returns) {
    const usd = takePrefix(slice.usd, quantity);
    const native = slice.native === null ? null : takePrefix(slice.native, quantity);
    taken.push({ ...slice, usd: usd.taken, native: native?.taken ?? null });
    kept.push({ ...slice, usd: usd.remainder, native: native?.remainder ?? null });
  }
  fragment.interval = place.remainder;
  fragment.cost = cost.remainder;
  if (paid) fragment.paidCost = { currency: paid.currency, cost: paid.remainder };
  fragment.returns = kept;
  return {
    fragment,
    interval: place.taken,
    cost: intervalCost(cost.taken),
    costInterval: cost.taken,
    paidCost: paid ? { currency: paid.currency, cost: paid.taken } : null,
    returns: taken,
  };
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
        : origin.kind === 'swap'
          ? origin.swapId
          : origin.capitalReturnId;
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
    ...portionReturned(portion),
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
  private hasCapitalReturnIdentity = false;
  private capitalReturnCount = 0;
  private capitalReturnAmount = 0n;
  private readonly capitalReturnApplied = new CostTally();
  private readonly capitalReturnRealized = new CostTally();
  private capitalReturnUnknownCost = 0;
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
    this.append(
      fragmentOf({
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
      }),
    );
  }

  markRewardIdentity(): void {
    this.hasRewardIdentity = true;
  }

  markSwapIdentity(): void {
    this.hasSwapIdentity = true;
  }

  markCapitalReturnIdentity(): void {
    this.hasCapitalReturnIdentity = true;
  }

  /**
   * A share split: every held unit of the security becomes `ratio` units. Each fragment's place
   * in its lot is scaled, so the lot's cost (and what returns took) divides over the new units
   * exactly as before: cost × (end × r) / (quantity × r) is the same integer.
   */
  applySplit(instrumentId: string, ratio: bigint): void {
    const scale = (interval: LotInterval): LotInterval =>
      lotInterval(
        interval.originalQuantity * ratio,
        interval.originalCost,
        interval.start * ratio,
        interval.end * ratio,
      );
    for (const fragment of this.queues.get(instrumentId) ?? []) {
      fragment.interval = scale(fragment.interval);
      fragment.cost = scale(fragment.cost);
      if (fragment.paidCost)
        fragment.paidCost = { ...fragment.paidCost, cost: scale(fragment.paidCost.cost) };
      fragment.returns = fragment.returns.map((slice) => ({
        ...slice,
        usd: scale(slice.usd),
        native: slice.native === null ? null : scale(slice.native),
      }));
    }
  }

  /**
   * Part of what the held units cost came back as cash. Every fragment of the asset takes a
   * share by its units, to the last atom; a share above a fragment's remaining cost is realized
   * at once and leaves its cost at zero. A fragment of unknown cost stays unknown (missing is
   * not zero), and so does the result of the return.
   */
  applyCapitalReturn(capitalReturn: FifoCapitalReturn): CapitalReturnAllocation {
    this.occupy(capitalReturn.occurredAt, capitalReturn.orderWithinTimestamp);
    const amount = canonicalDecimalToAtoms(capitalReturn.amount);
    const amountUsd = canonicalDecimalToAtoms(capitalReturn.amountUsd);
    const currency = capitalReturn.paidCurrency;
    if (
      amount <= 0n ||
      amountUsd <= 0n ||
      capitalReturn.cashInstrumentId === capitalReturn.instrumentId
    )
      throw new FifoHistoryError();
    const queue = this.queues.get(capitalReturn.instrumentId) ?? [];
    let total = 0n;
    for (const fragment of queue) total += fragment.interval.end - fragment.interval.start;
    if (total <= 0n) throw new FifoHistoryError();

    const items: CapitalReturnAllocationItem[] = [];
    const applied = new CostTally();
    let realized = 0n;
    let realizedNative = 0n;
    let unknown = 0;
    let before = 0n;
    for (const fragment of queue) {
      const length = fragment.interval.end - fragment.interval.start;
      const after = before + length;
      const share = (amountUsd * after) / total - (amountUsd * before) / total;
      const nativeShare =
        currency === null ? 0n : (amount * after) / total - (amount * before) / total;
      before = after;
      const cost = intervalCost(fragment.cost);
      if (cost === null) {
        unknown++;
        applied.add(null);
        items.push({
          instrumentId: fragment.instrumentId,
          quantity: formatAtoms(length),
          appliedUsd: null,
          excessUsd: null,
        });
        continue;
      }
      const taken = share < cost ? share : cost;
      const excess = share - taken;
      // Paid in the currency the return comes in, the units' cost in it is lowered by the paid
      // amount itself, not by what the dollar figure implies: rates moved between the two days.
      const paidCost =
        currency !== null && fragment.paidCost?.currency === currency
          ? intervalCost(fragment.paidCost.cost)
          : null;
      const nativeTaken =
        paidCost !== null
          ? nativeShare < paidCost
            ? nativeShare
            : paidCost
          : share === 0n
            ? 0n
            : (nativeShare * taken) / share;
      realized += excess;
      realizedNative += nativeShare - nativeTaken;
      applied.add(taken);
      items.push({
        instrumentId: fragment.instrumentId,
        quantity: formatAtoms(length),
        appliedUsd: formatAtoms(taken),
        excessUsd: formatAtoms(excess),
      });
      if (taken === 0n && nativeTaken === 0n) continue;
      this.limits.match?.();
      fragment.cost = lotInterval(length, cost - taken);
      if (paidCost !== null && fragment.paidCost)
        fragment.paidCost = {
          currency: fragment.paidCost.currency,
          cost: lotInterval(length, paidCost - nativeTaken),
        };
      fragment.returns = [
        ...fragment.returns,
        {
          capitalReturnId: capitalReturn.capitalReturnId,
          version: capitalReturn.version,
          occurredAt: capitalReturn.occurredAt,
          currency,
          usd: lotInterval(length, taken),
          native: currency === null ? null : lotInterval(length, nativeTaken),
        },
      ];
    }

    this.append(
      fragmentOf({
        source: { kind: 'capital-return', capitalReturn },
        origin: {
          accountId: this.accountId,
          kind: 'capital-return',
          capitalReturnId: capitalReturn.capitalReturnId,
          version: capitalReturn.version,
          acquiredAt: capitalReturn.occurredAt,
          orderWithinTimestamp: capitalReturn.orderWithinTimestamp,
          originalQuantity: capitalReturn.amount,
          originalCostUsd: capitalReturn.amountUsd,
          paidCurrency: currency,
        },
        arrival: null,
        instrumentId: capitalReturn.cashInstrumentId,
        instrumentName: capitalReturn.cashInstrumentName,
        instrumentSymbol: capitalReturn.cashInstrumentSymbol,
        interval: lotInterval(amount, amountUsd),
      }),
    );

    this.hasCapitalReturnIdentity = true;
    this.capitalReturnCount++;
    this.capitalReturnAmount += amountUsd;
    this.capitalReturnUnknownCost += unknown;
    this.capitalReturnApplied.add(unknown > 0 ? null : applied.known);
    this.capitalReturnRealized.add(unknown > 0 ? null : realized);
    if (unknown > 0) this.unknownRealizedCount++;
    else this.knownRealized += realized;
    return {
      capitalReturnId: capitalReturn.capitalReturnId,
      version: capitalReturn.version,
      instrumentId: capitalReturn.instrumentId,
      occurredAt: capitalReturn.occurredAt,
      amountUsd: capitalReturn.amountUsd,
      appliedUsd: unknown > 0 ? null : formatAtoms(applied.known),
      realizedUsd: unknown > 0 ? null : formatAtoms(realized),
      realizedNative:
        unknown > 0 || currency === null ? null : { currency, amount: formatAtoms(realizedNative) },
      unknownCostCount: unknown,
      items,
    };
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
    this.append(
      fragmentOf({
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
      }),
    );
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

    const fragment: BookFragment = fragmentOf({
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
    });
    if (swap.feeSource === 'incoming') {
      this.limits.match?.();
      feePortions = [takeFromFragment(fragment, fee)];
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
    const quantity = canonicalDecimalToAtoms(trade.quantity);
    // A buy paid in RUB or EUR keeps what it cost in that currency, so a return paid in it is
    // taken off in rubles or euros too, whatever the rate did between the two days.
    const paid =
      trade.side === 'buy' && trade.paid
        ? {
            currency: trade.paid.currency,
            cost: lotInterval(
              quantity,
              canonicalDecimalToAtoms(trade.paid.gross) + canonicalDecimalToAtoms(trade.paid.fee),
            ),
          }
        : null;
    this.append(
      fragmentOf(
        {
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
        },
        paid,
      ),
    );
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
        ...portionReturned(portion),
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
      } else if (fragment.source.kind === 'swap') {
        const match: SwapSaleMatch = {
          ...common,
          sourceKind: 'swap',
          origin: fragment.origin as Extract<LotOrigin, { kind: 'swap' }>,
          intervalStart: formatAtoms(interval.start),
          intervalEnd: formatAtoms(interval.end),
        };
        this.matches.push(match);
      } else {
        const match: CapitalReturnSaleMatch = {
          ...common,
          sourceKind: 'capital-return',
          origin: fragment.origin as Extract<LotOrigin, { kind: 'capital-return' }>,
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
      portions.push(takeFromFragment(fragment, matched));
      remaining -= matched;
      if (fragment.interval.start === fragment.interval.end) {
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
        cost: portion.costInterval,
        paidCost: portion.paidCost,
        returns: portion.returns,
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
      const cost = intervalCost(fragment.cost);
      const remainingCostUsd = cost === null ? null : formatAtoms(cost);
      remainingCost.add(cost);
      const returned = returnedParts(fragment.returns);
      if (fragment.arrival) {
        lots.push({
          ...returned,
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
          ...returned,
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
          ...returned,
          sourceKind: 'carry-in',
          ...fragment.source.lot,
          carriedCostUsd: fragment.source.carriedCostUsd,
          remainingQuantity,
          remainingCostUsd: formatAtoms(cost),
        });
      } else if (fragment.source.kind === 'reward') {
        lots.push({
          ...returned,
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
      } else if (fragment.source.kind === 'swap') {
        lots.push({
          ...returned,
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
      } else {
        lots.push({
          ...returned,
          sourceKind: 'capital-return',
          instrumentId: fragment.instrumentId,
          instrumentName: fragment.instrumentName,
          instrumentSymbol: fragment.instrumentSymbol,
          origin: fragment.origin as Extract<LotOrigin, { kind: 'capital-return' }>,
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
    if (this.hasCapitalReturnIdentity) {
      const capitalReturnSummary: CapitalReturnSummary = {
        activeCount: this.capitalReturnCount,
        amountUsd: formatAtoms(this.capitalReturnAmount),
        appliedUsd: this.capitalReturnApplied.value,
        realizedUsd: this.capitalReturnRealized.value,
        unknownCostCount: this.capitalReturnUnknownCost,
      };
      result.capitalReturnSummary = capitalReturnSummary;
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
    if (
      this.participant ||
      this.hasRewardIdentity ||
      this.hasSwapIdentity ||
      this.hasCapitalReturnIdentity
    )
      throw new FifoHistoryError();
    return this.project() as CarryInFifoResult;
  }
}
