import {
  type AccountingCurrency,
  FxConverter,
  type FxRates,
  moscowDate,
} from '../fx-rates/fx-conversion';
import { freshness } from '../prices/price-collection';
import type { AssetType, PriceSource, ValuationCurrency } from './asset-classification';
import type { SwapAllocation } from './asset-swap-types';
import type { CapitalReturnAllocation, ReturnedPart } from './capital-return-types';
import type { FifoCarryInInput, FifoTrade } from './fifo';
import {
  canonicalDecimalToAtoms,
  formatAtoms,
  formatPercent,
  formatProduct,
  formatSignedProduct,
} from './money';
import type { AccountFifoResult, LotOrigin } from './owned-transfer-types';
import type { PaidCurrency } from './paid-currency';
import type { FifoSplit } from './share-split-types';

const ATOM_SCALE = 10n ** 30n;
export const DAY_MS = 24 * 3_600_000;

export interface PortfolioInstrument {
  id: string;
  name: string;
  symbol: string | null;
  assetType: AssetType;
  valuationCurrency: ValuationCurrency;
  priceSource: PriceSource;
  /** The security type a T-Bank link names (share, bond, ETF); null for anything else. */
  securityType?: SecurityType | null;
}
export type SecurityType = 'share' | 'bond' | 'etf';
/** A share of an amount in the currency it was paid in (CUR-PAID-RUB). */
export interface NativeAmount {
  currency: PaidCurrency;
  amount: string;
  /** The complete entered payment, rather than a computed share. */
  entered?: boolean;
}
/**
 * Whether a held FIFO lot was bought, however it moved since: an own transfer keeps its origin.
 * A reward, a swap, a coin received without a purchase and an opening (carry-in) lot are not:
 * opening cost is not a recorded purchase. `isBoughtTrade` says whether a buy trade is a purchase:
 * income, gifts received and the cash a sale brought in are buys in FIFO too, but not paid for.
 */
export function isPurchase(
  lot: {
    sourceKind?: string;
    origin?: LotOrigin;
    buyTradeId?: string;
    buyVersion?: number;
  },
  isBoughtTrade: (tradeId: string, version: number) => boolean,
): boolean {
  if (lot.buyTradeId !== undefined) {
    return lot.buyVersion !== undefined && isBoughtTrade(lot.buyTradeId, lot.buyVersion);
  }
  return lot.origin?.kind === 'trade' && isBoughtTrade(lot.origin.tradeId, lot.origin.version);
}

/**
 * What a capital return took off the cost of a lot, at the return's own Moscow day: the lot's
 * `costUsd` is already lowered by it, and in another currency it is taken off at that day's rate.
 */
export interface ReturnedCost {
  costUsd: string;
  at: string;
  native?: NativeAmount;
}

/** A held FIFO fragment with its original acquisition instant (Q1: cost at that date). */
export interface PortfolioLot {
  instrumentId: string;
  quantity: string;
  /** What the units cost now, after any capital return lowered it. */
  costUsd: string | null;
  acquiredAt: string;
  /** The units' purchase as paid, before any capital return. */
  native?: NativeAmount;
  returned?: readonly ReturnedCost[];
  /** Set on a lot bought or carried in as a purchase; a reward, swap or received coin is not. */
  purchase?: true;
  /** COST-ESTIMATE: no purchase price was entered; `costUsd` is its price when it came in. */
  costEstimated?: true;
}
export interface ConsumedCost {
  costUsd: string | null;
  acquiredAt: string;
  native?: NativeAmount;
  returned?: readonly ReturnedCost[];
}
/** A sale or swap: proceeds at its date minus the FIFO cost of what it consumed. */
export interface PortfolioRealization {
  instrumentId: string;
  occurredAt: string;
  proceedsUsd: string | null;
  nativeProceeds?: NativeAmount;
  consumed: readonly ConsumedCost[];
}
export interface PortfolioAccountInput {
  accountId: string;
  name: string;
  assetClass?: 'broker' | 'property' | null;
  coverage: 'covered' | 'not-started' | 'before-coverage';
  lots: readonly PortfolioLot[];
  realizations: readonly PortfolioRealization[];
}
/**
 * ASSET-HIDE: the accounts without the lots and realizations of the assets the owner hid, so no
 * asset, total or realized sum counts them. The books they were made in are not touched.
 */
export function withoutAssets(
  accounts: readonly PortfolioAccountInput[],
  hidden: ReadonlySet<string>,
): PortfolioAccountInput[] {
  if (hidden.size === 0) return [...accounts];
  return accounts.map((account) => ({
    ...account,
    lots: account.lots.filter((lot) => !hidden.has(lot.instrumentId)),
    realizations: account.realizations.filter((item) => !hidden.has(item.instrumentId)),
  }));
}
/** A stored price before the asset's source decides how it is used. */
export interface StoredPrice {
  priceUsd: string;
  observedAt: string;
  source: string;
  /** AST-MANUAL-VALUE: the currency of `priceUsd` for a hand value; USD when absent. */
  currency?: AccountingCurrency;
  /**
   * BPH-SPLIT: when a broker price was read. A broker gives past prices in the units of that
   * day, so splits after `observedAt` up to then are already in it.
   */
  unitsAt?: string;
}
export interface PortfolioPrices {
  market: ReadonlyMap<string, StoredPrice>;
  manual: ReadonlyMap<string, StoredPrice>;
  /** The owner's share splits: a price set before one is per unit of the time it was set. */
  splits?: readonly FifoSplit[];
}
/** A price stated in the report's currency. */
export interface AssetPrice {
  value: string;
  observedAt: string | null;
  source: string;
  status: 'fresh' | 'stale' | 'manual' | 'fixed';
}
export interface AllocationSlice {
  key: string;
  label: string;
  value: string;
  percent: string | null;
}

const typeLabels: Record<AssetType, string> = { crypto: 'Crypto', fiat: 'Cash', manual: 'Manual' };
/** DEP-VALUE: allocation key of all bank deposits in the by-type grouping. */
export const DEPOSITS_TYPE = 'deposits';

/** One bank deposit's worth in the report's currency at scale 60; null without a rate. */
export interface PortfolioDeposit {
  id: string;
  name: string;
  bank: string;
  value: bigint | null;
  /** An account with no rate entered: its value leaves out interest that is not known. */
  interestMissing?: boolean;
}
const NO_RATES: FxRates = { USD: [], EUR: [] };
export const usdOnly = () => new FxConverter(NO_RATES, 'USD');

/** Signed scale-30 decimal (realized results may be negative). */
function signedAtoms(value: string): bigint {
  return value.startsWith('-')
    ? -canonicalDecimalToAtoms(value.slice(1))
    : canonicalDecimalToAtoms(value);
}

/** Positive scale-30 quotient, half away from zero. */
function quotient(numerator: bigint, denominator: bigint): string {
  return formatAtoms((numerator * ATOM_SCALE * 2n + denominator) / (denominator * 2n));
}

/** Valuation rule (product model, section 4): price by the asset's own source, in the
 * report's currency at today's rate. */
export function resolvePrice(
  instrument: PortfolioInstrument,
  prices: PortfolioPrices,
  at: Date,
  fx: FxConverter = usdOnly(),
): { price: AssetPrice | null; missingPrice: 'no-price' | 'no-rate' | null } {
  const today = moscowDate(at);
  if (instrument.priceSource === 'fixed') {
    // One unit of the asset's own currency; a rate is never invented.
    const value = fx.convert(ATOM_SCALE, instrument.valuationCurrency, today);
    if (value === null) return { price: null, missingPrice: 'no-rate' };
    return {
      price: { value: formatAtoms(value), observedAt: null, source: 'fixed', status: 'fixed' },
      missingPrice: null,
    };
  }
  const stored =
    instrument.priceSource === 'market'
      ? instrument.symbol
        ? prices.market.get(instrument.symbol.toUpperCase())
        : undefined
      : prices.manual.get(instrument.id);
  if (!stored) return { price: null, missingPrice: 'no-price' };
  // Stored market prices are in USD; a hand value is in the currency it was set in
  // (AST-MANUAL-VALUE), USD for one stored before hand values had a currency.
  const value = fx.convert(
    canonicalDecimalToAtoms(stored.priceUsd),
    stored.currency ?? 'USD',
    today,
  );
  if (value === null) return { price: null, missingPrice: 'no-rate' };
  // A unit priced before a split became `ratio` units by `at`; rounding down never overstates.
  // A broker price is first put back in the units of its own day (BPH-SPLIT).
  const ratioUntil = (until: string) =>
    (prices.splits ?? []).reduce(
      (units, item) =>
        item.instrumentId === instrument.id &&
        item.effectiveAt > stored.observedAt &&
        item.effectiveAt <= until
          ? units * BigInt(item.ratio)
          : units,
      1n,
    );
  const split = ratioUntil(at.toISOString());
  const restored = stored.unitsAt ? ratioUntil(stored.unitsAt) : 1n;
  // BPR-3: a price a broker reported ages like a market price; a hand value does not.
  const status =
    instrument.priceSource === 'manual' && stored.source === 'manual'
      ? 'manual'
      : freshness(stored.observedAt, at) === 'fresh'
        ? 'fresh'
        : 'stale';
  return {
    price: {
      value: formatAtoms((value * restored) / split),
      observedAt: stored.observedAt,
      source: stored.source,
      status,
    },
    missingPrice: null,
  };
}

/**
 * The price's change since the same moment a day earlier, in the report's currency at each
 * day's rate. A market price older than 2 hours at either moment is not that moment's price.
 */
function priceChange24h(
  instrument: PortfolioInstrument,
  current: AssetPrice | null,
  previous: PortfolioPrices | undefined,
  at: Date,
  fx: FxConverter,
): string | null {
  if (!current || !previous) return null;
  const dayBefore = new Date(at.getTime() - DAY_MS);
  if (instrument.priceSource === 'market') {
    if (current.status !== 'fresh') return null;
    const stored = instrument.symbol
      ? previous.market.get(instrument.symbol.toUpperCase())
      : undefined;
    if (!stored || freshness(stored.observedAt, dayBefore) !== 'fresh') return null;
  }
  const before = resolvePrice(instrument, previous, dayBefore, fx).price;
  if (!before) return null;
  // BPR-3: a broker's price changes only between two fresh readings; a hand value and a broker
  // price are not one series.
  if (
    (current.status === 'manual') !== (before.status === 'manual') ||
    current.status === 'stale' ||
    before.status === 'stale'
  )
    return null;
  const then = canonicalDecimalToAtoms(before.value);
  if (then === 0n) return null;
  return formatPercent(canonicalDecimalToAtoms(current.value) - then, then);
}

const tradeKey = (tradeId: string, version: number) => `${tradeId}:${version}`;
const lotKey = (lotId: string, revision: number, ordinal: number) =>
  `${lotId}:${revision}:${ordinal}`;

/**
 * A buy's amount as paid, shared by quantity, half away from zero. A sale's only fragment is
 * the cash it kept (M9), which holds units of the paid currency itself.
 */
function nativeShare(
  trade: FifoTrade | undefined,
  quantity: string,
  split = 1n,
): NativeAmount | undefined {
  if (!trade?.paid) return undefined;
  if (trade.side !== 'buy') return { currency: trade.paid.currency, amount: quantity };
  const total = canonicalDecimalToAtoms(trade.paid.gross) + canonicalDecimalToAtoms(trade.paid.fee);
  // The buy's units, counted in the units its part is given in after any splits since.
  const whole = canonicalDecimalToAtoms(trade.quantity) * split;
  const part = canonicalDecimalToAtoms(quantity);
  return {
    currency: trade.paid.currency,
    amount: formatAtoms((total * part * 2n + whole) / (whole * 2n)),
    entered: part === whole,
  };
}

/**
 * One covered account's FIFO result as dated lots and realizations. A transferred, rewarded
 * or swapped fragment keeps its original acquisition instant, and a fragment of a buy paid in
 * RUB or EUR its share of the amount paid. `linkedTrades` are the other connected accounts'
 * trades, where transferred fragments were bought.
 */
export function portfolioAccount(
  identity: Pick<PortfolioAccountInput, 'accountId' | 'name' | 'assetClass'>,
  fifo: Pick<AccountFifoResult, 'lots' | 'realizations' | 'matches'>,
  journal: {
    trades: readonly FifoTrade[];
    initialLots: readonly FifoCarryInInput[];
    swaps?: readonly { swapId: string; outgoingInstrumentId: string; occurredAt: string }[];
    capitalReturns?: readonly { capitalReturnId: string }[];
    linkedTrades?: readonly FifoTrade[];
    /** The owner's share splits, and the instant the lots are valued at (all splits if none). */
    splits?: readonly FifoSplit[];
    at?: string;
  },
  swapAllocations: ReadonlyMap<string, SwapAllocation> = new Map(),
  capitalReturnAllocations: ReadonlyMap<string, CapitalReturnAllocation> = new Map(),
): PortfolioAccountInput {
  const trades = new Map(
    journal.trades.map((trade) => [tradeKey(trade.tradeId, trade.version), trade.occurredAt]),
  );
  const paid = new Map(
    [...(journal.linkedTrades ?? []), ...journal.trades]
      .filter((trade) => trade.paid)
      .map((trade) => [tradeKey(trade.tradeId, trade.version), trade]),
  );
  // A purchase is a buy with no purpose; the cash a sale brought in is a buy of the sale's trade.
  const bought = new Set(
    [...(journal.linkedTrades ?? []), ...journal.trades]
      .filter((trade) => trade.side === 'buy' && trade.purpose === undefined)
      .map((trade) => tradeKey(trade.tradeId, trade.version)),
  );
  const isBoughtTrade = (tradeId: string, version: number) =>
    bought.has(tradeKey(tradeId, version));
  const share = (tradeId: string, version: number, quantity: string, until?: string) => {
    const trade = paid.get(tradeKey(tradeId, version));
    return nativeShare(trade, quantity, splitSince(journal.splits ?? [], trade, until));
  };
  const fromOrigin = (origin: LotOrigin, quantity: string, until?: string) =>
    origin.kind === 'trade'
      ? share(origin.tradeId, origin.version, quantity, until)
      : origin.kind === 'capital-return' && origin.paidCurrency
        ? { currency: origin.paidCurrency, amount: quantity }
        : undefined;
  // What its source paid for a lot or match, in the currency it was paid in.
  const sourceNative = (item: FifoLot | FifoMatch, quantity: string, until?: string) =>
    'origin' in item
      ? fromOrigin(item.origin, quantity, until)
      : 'buyTradeId' in item
        ? share(item.buyTradeId, item.buyVersion, quantity, until)
        : undefined;
  const carried = new Map(
    journal.initialLots.map((lot) => [
      lotKey(lot.lotId, lot.openingRevision, lot.ordinal),
      lot.acquiredAt,
    ]),
  );
  const matchAcquiredAt = (match: FifoMatch) =>
    'origin' in match
      ? match.origin.acquiredAt
      : 'buyTradeId' in match
        ? known(trades.get(tradeKey(match.buyTradeId, match.buyVersion)))
        : known(carried.get(lotKey(match.lotId, match.openingRevision, match.ordinal)));
  const lots = fifo.lots.map(
    (lot): PortfolioLot => ({
      instrumentId: lot.instrumentId,
      quantity: lot.remainingQuantity,
      costUsd: lot.remainingCostUsd,
      acquiredAt: lotAcquiredAt(lot),
      ...returnedField(lot.returned),
      ...(isPurchase(lot, isBoughtTrade) ? { purchase: true as const } : {}),
      ...nativeField(sourceNative(lot, lot.remainingQuantity, journal.at)),
    }),
  );
  const consumed = new Map<string, ConsumedCost[]>();
  for (const match of fifo.matches) {
    const acquiredAt = matchAcquiredAt(match);
    const key = tradeKey(match.sellTradeId, match.sellVersion);
    // A sale's units are those of its own date.
    const soldAt = trades.get(key);
    const list = consumed.get(key) ?? [];
    list.push({
      costUsd: match.costUsd,
      acquiredAt,
      ...returnedField(match.returned),
      ...nativeField(sourceNative(match, match.quantity, soldAt)),
    });
    consumed.set(key, list);
  }
  const realizations: PortfolioRealization[] = fifo.realizations.map((sale) =>
    saleRealization(
      sale,
      paid.get(tradeKey(sale.sellTradeId, sale.sellVersion)),
      consumed.get(tradeKey(sale.sellTradeId, sale.sellVersion)) ?? [],
    ),
  );
  // A swap realizes its outgoing asset: consideration minus principal and fee basis.
  for (const swap of journal.swaps ?? []) {
    const allocation = swapAllocations.get(swap.swapId);
    if (!allocation) continue;
    realizations.push({
      instrumentId: swap.outgoingInstrumentId,
      occurredAt: swap.occurredAt,
      proceedsUsd: allocation.considerationUsd,
      consumed: allocation.items.map((item) => ({
        costUsd: item.costUsd,
        acquiredAt: item.origin.acquiredAt,
        ...returnedField(item.returned),
        ...nativeField(fromOrigin(item.origin, item.quantity, swap.occurredAt)),
      })),
    });
  }
  // The share of a return that the cost of the units could not take is realized when it comes.
  for (const { capitalReturnId } of journal.capitalReturns ?? []) {
    const realization = capitalReturnRealization(capitalReturnAllocations.get(capitalReturnId));
    if (realization) realizations.push(realization);
  }
  return { ...identity, coverage: 'covered', lots, realizations };
}

type FifoLot = AccountFifoResult['lots'][number];
type FifoMatch = AccountFifoResult['matches'][number];

/** How many units each unit a buy bought had become by `until`, through the splits since. */
function splitSince(
  splits: readonly FifoSplit[],
  trade: FifoTrade | undefined,
  until?: string,
): bigint {
  return splits.reduce(
    (units, split) =>
      trade &&
      split.instrumentId === trade.instrumentId &&
      split.effectiveAt > trade.occurredAt &&
      (until === undefined || split.effectiveAt <= until)
        ? units * BigInt(split.ratio)
        : units,
    1n,
  );
}

function returnedField(parts: readonly ReturnedPart[] | undefined) {
  return parts?.length
    ? {
        returned: parts.map(
          (part): ReturnedCost => ({
            costUsd: part.usd,
            at: part.occurredAt,
            ...(part.native ? { native: part.native } : {}),
          }),
        ),
      }
    : {};
}

const nativeField = (value: NativeAmount | undefined) => (value ? { native: value } : {});

function known<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('FIFO evidence without its source');
  return value;
}

function lotAcquiredAt(lot: FifoLot): string {
  if ('origin' in lot) return lot.origin.acquiredAt;
  return 'buyTradeId' in lot ? lot.occurredAt : lot.acquiredAt;
}

/** A sale's proceeds and, for one paid in RUB or EUR, what it brought in that currency. */
function saleRealization(
  sale: AccountFifoResult['realizations'][number],
  trade: FifoTrade | undefined,
  consumed: readonly ConsumedCost[],
): PortfolioRealization {
  const sold = trade?.paid;
  // Cash a buy spent (M9) is realized at the units it paid, in the paid currency.
  const spent = trade?.instrumentId !== sale.instrumentId;
  return {
    instrumentId: sale.instrumentId,
    occurredAt: sale.occurredAt,
    proceedsUsd: sale.netUsd,
    ...(sold
      ? {
          nativeProceeds: {
            currency: sold.currency,
            amount: spent
              ? sale.quantity
              : formatAtoms(
                  canonicalDecimalToAtoms(sold.gross) - canonicalDecimalToAtoms(sold.fee),
                ),
          },
        }
      : {}),
    consumed,
  };
}

/** What a capital return realized beyond the cost it lowered; none when that is zero. */
function capitalReturnRealization(
  allocation: CapitalReturnAllocation | undefined,
): PortfolioRealization | null {
  if (!allocation) return null;
  if (allocation.realizedUsd !== null && canonicalDecimalToAtoms(allocation.realizedUsd) === 0n)
    return null;
  return {
    instrumentId: allocation.instrumentId,
    occurredAt: allocation.occurredAt,
    proceedsUsd: allocation.realizedUsd,
    ...(allocation.realizedNative ? { nativeProceeds: allocation.realizedNative } : {}),
    consumed: [],
  };
}

function slices(values: Map<string, { label: string; value: bigint }>, subtotal: bigint) {
  return [...values]
    .map(([key, { label, value }]) => ({ key, label, value }))
    .sort(
      (left, right) =>
        (left.value < right.value ? 1 : left.value > right.value ? -1 : 0) ||
        left.label.localeCompare(right.label, 'en') ||
        left.key.localeCompare(right.key),
    )
    .map(
      ({ key, label, value }): AllocationSlice => ({
        key,
        label,
        value: formatProduct(value),
        percent: subtotal === 0n ? null : formatPercent(value, subtotal),
      }),
    );
}

function add(
  map: Map<string, { label: string; value: bigint }>,
  key: string,
  label: string,
  value: bigint,
) {
  const entry = map.get(key) ?? { label, value: 0n };
  entry.value += value;
  map.set(key, entry);
}

interface CostTotals {
  quantity: bigint;
  knownCost: bigint;
  unknownQuantity: bigint;
  missingRateQuantity: bigint;
  /** COST-ESTIMATE: quantity costed at its price on arrival. */
  estimatedQuantity: bigint;
}

const noCost = (): CostTotals => ({
  quantity: 0n,
  knownCost: 0n,
  unknownQuantity: 0n,
  missingRateQuantity: 0n,
  estimatedQuantity: 0n,
});

/** The quantity whose cost is known in the report's currency. */
const knownQuantityOf = (total: CostTotals) =>
  total.quantity - total.unknownQuantity - total.missingRateQuantity;

function addLotCost(totals: Map<string, CostTotals>, instrumentId: string, lot: CostTotals) {
  const total = totals.get(instrumentId) ?? noCost();
  total.quantity += lot.quantity;
  total.knownCost += lot.knownCost;
  total.unknownQuantity += lot.unknownQuantity;
  total.missingRateQuantity += lot.missingRateQuantity;
  total.estimatedQuantity += lot.estimatedQuantity;
  totals.set(instrumentId, total);
}
interface RealizedTotals {
  known: bigint;
  unknown: number;
  missingRate: number;
}

/**
 * A cost or proceeds amount in the converter's currency at its own Moscow day's rate; an amount
 * paid in RUB or EUR is exact in its own currency and converts from it (CUR-PAID-RUB).
 */
export function convertAmount(
  fx: FxConverter,
  usd: string,
  instant: string,
  native?: NativeAmount,
): bigint | null {
  return native && fx.currency !== 'USD'
    ? fx.convert(signedAtoms(native.amount), native.currency, moscowDate(instant))
    : fx.convert(signedAtoms(usd), 'USD', moscowDate(instant));
}

/**
 * What a lot cost in the converter's currency: its purchase at its day's rate, less each capital
 * return at that return's own day's rate. Null when the cost is unknown or a rate is missing.
 */
export function lotCostIn(
  fx: FxConverter,
  lot: Pick<PortfolioLot, 'costUsd' | 'acquiredAt' | 'native' | 'returned'>,
): bigint | null {
  if (lot.costUsd === null) return null;
  const returned = lot.returned ?? [];
  let before = signedAtoms(lot.costUsd);
  for (const part of returned) before += signedAtoms(part.costUsd);
  let total = convertAmount(fx, formatAtoms(before), lot.acquiredAt, lot.native);
  if (total === null) return null;
  for (const part of returned) {
    const taken = convertAmount(fx, part.costUsd, part.at, part.native);
    if (taken === null) return null;
    total -= taken;
  }
  return total;
}

type Holding = { accountId: string; accountName: string; quantity: bigint };
type Groups = Map<string, { label: string; value: bigint }>;

/** One held lot's units and its cost in the report's currency, known or not. */
function lotAmounts(lot: PortfolioLot, quantity: bigint, fx: FxConverter): CostTotals {
  const cost = lotCostIn(fx, lot);
  return {
    quantity,
    knownCost: cost ?? 0n,
    unknownQuantity: lot.costUsd === null ? quantity : 0n,
    missingRateQuantity: lot.costUsd !== null && cost === null ? quantity : 0n,
    estimatedQuantity: lot.costEstimated ? quantity : 0n,
  };
}

/** Each held lot's units per asset and account, and its cost in the report's currency. */
function collectLots(accounts: readonly PortfolioAccountInput[], fx: FxConverter) {
  const holdings = new Map<string, Map<string, Holding>>();
  const totals = new Map<string, CostTotals>();
  const investmentTotals = new Map<string, CostTotals>();
  for (const account of accounts) {
    for (const lot of account.lots) {
      const quantity = canonicalDecimalToAtoms(lot.quantity);
      if (quantity === 0n) continue;
      const perAccount = holdings.get(lot.instrumentId) ?? new Map();
      const holding = perAccount.get(account.accountId) ?? {
        accountId: account.accountId,
        accountName: account.name,
        quantity: 0n,
      };
      holding.quantity += quantity;
      perAccount.set(account.accountId, holding);
      holdings.set(lot.instrumentId, perAccount);
      const amounts = lotAmounts(lot, quantity, fx);
      addLotCost(totals, lot.instrumentId, amounts);
      if (account.assetClass !== 'property')
        addLotCost(investmentTotals, lot.instrumentId, amounts);
    }
  }
  return { holdings, totals, investmentTotals };
}

/** One sale's proceeds (+) and the costs it consumed (-), each at its own day; null if unknown. */
function realizationAmounts(realization: PortfolioRealization) {
  return [
    realization.proceedsUsd === null
      ? null
      : {
          usd: realization.proceedsUsd,
          at: realization.occurredAt,
          native: realization.nativeProceeds,
          sign: 1n,
        },
    ...realization.consumed.flatMap((item) => {
      if (item.costUsd === null) return [null];
      // A return that lowered the units' cost came back before the sale: their cost is what
      // they cost at their own day less what each return took off at its day.
      let gross = signedAtoms(item.costUsd);
      for (const part of item.returned ?? []) gross += signedAtoms(part.costUsd);
      return [
        {
          usd: item.returned?.length ? formatAtoms(gross) : item.costUsd,
          at: item.acquiredAt,
          native: item.native,
          sign: -1n,
        },
        ...(item.returned ?? []).map((part) => ({
          usd: part.costUsd,
          at: part.at,
          native: part.native,
          sign: 1n,
        })),
      ];
    }),
  ];
}

/** One sale's result in the report's currency; null when a cost or a rate is missing. */
function realizationResult(
  realization: PortfolioRealization,
  fx: FxConverter,
): { result: bigint | null; missingRate: boolean } {
  const amounts = realizationAmounts(realization);
  if (!amounts.every((amount) => amount !== null)) return { result: null, missingRate: false };
  let result = 0n;
  for (const amount of amounts) {
    // An amount paid in RUB or EUR is exact in its own currency and converts from it; USD
    // figures stay the USD amounts derived at the trade's date (CUR-PAID-RUB).
    const converted = convertAmount(fx, amount!.usd, amount!.at, amount!.native);
    if (converted === null) return { result: null, missingRate: true };
    result += amount!.sign * converted;
  }
  return { result, missingRate: false };
}

function realizedTotals(
  accounts: readonly PortfolioAccountInput[],
  fx: FxConverter,
): Map<string, RealizedTotals> {
  const realized = new Map<string, RealizedTotals>();
  for (const account of accounts) {
    for (const realization of account.realizations) {
      const entry = realized.get(realization.instrumentId) ?? {
        known: 0n,
        unknown: 0,
        missingRate: 0,
      };
      const { result, missingRate } = realizationResult(realization, fx);
      if (result === null) {
        entry.unknown++;
        if (missingRate) entry.missingRate++;
      } else entry.known += result;
      realized.set(realization.instrumentId, entry);
    }
  }
  return realized;
}

/** Each account's priced value and how many of its assets have no price. */
function accountTotals(
  accounts: readonly PortfolioAccountInput[],
  holdings: ReadonlyMap<string, ReadonlyMap<string, Holding>>,
  valueAt: (instrumentId: string, quantity: bigint) => bigint | null,
  byAccount: Groups,
) {
  const accountValues = new Map<string, { value: bigint; missing: number }>();
  for (const account of accounts) {
    const summary = { value: 0n, missing: 0 };
    for (const [instrumentId, perAccount] of holdings) {
      const holding = perAccount.get(account.accountId);
      if (!holding) continue;
      const value = valueAt(instrumentId, holding.quantity);
      if (value === null) summary.missing++;
      else summary.value += value;
    }
    accountValues.set(account.accountId, summary);
    if (summary.value > 0n) add(byAccount, account.accountId, account.name, summary.value);
  }
  return accountValues;
}

interface PortfolioSums {
  subtotal: bigint;
  missingPriceCount: number;
  stalePriceCount: number;
  knownCost: bigint;
  unknownCostCount: number;
  estimatedCostCount: number;
  missingRateCount: number;
  unrealized: bigint;
  unrealizedCost: bigint;
  unrealizedComplete: boolean;
  // The same result over the coins whose cost is known, for a portfolio that is only partly known.
  knownUnrealized: bigint;
  knownUnrealizedCost: bigint;
  knownUnrealizedAssets: number;
  knownRealized: bigint;
  unknownRealizedCount: number;
}

/** A held asset's value, price state and cost in the portfolio's sums and allocation. */
function addHeldAsset(
  sums: PortfolioSums,
  groups: { byAsset: Groups; byType: Groups },
  instrument: PortfolioInstrument,
  price: AssetPrice | null,
  value: bigint | null,
  total: CostTotals,
) {
  if (value === null) sums.missingPriceCount++;
  else {
    sums.subtotal += value;
    add(groups.byAsset, instrument.id, instrument.name, value);
    add(groups.byType, instrument.assetType, typeLabels[instrument.assetType], value);
  }
  if (price?.status === 'stale') sums.stalePriceCount++;
  sums.knownCost += total.knownCost;
  if (total.unknownQuantity > 0n) sums.unknownCostCount++;
  if (total.estimatedQuantity > 0n) sums.estimatedCostCount++;
}

/** The unrealized result of the investment (not property) units of one held asset. */
function addInvestment(
  sums: PortfolioSums,
  investment: CostTotals | undefined,
  worth: (quantity: bigint) => bigint | null,
) {
  if (!investment) return;
  const investmentValue = worth(investment.quantity);
  sums.unrealizedCost += investment.knownCost;
  if (
    investmentValue === null ||
    investment.unknownQuantity > 0n ||
    investment.missingRateQuantity > 0n
  )
    sums.unrealizedComplete = false;
  else sums.unrealized += investmentValue - investment.knownCost * ATOM_SCALE;
  // A coin without a price stays out of the known result, as of the known value: it is
  // counted in missingPriceCount and said so in the notes, but does not empty the rest.
  const investmentKnown = knownQuantityOf(investment);
  const investmentKnownValue = worth(investmentKnown);
  if (investmentKnown > 0n && investmentKnownValue !== null) {
    sums.knownUnrealized += investmentKnownValue - investment.knownCost * ATOM_SCALE;
    sums.knownUnrealizedCost += investment.knownCost;
    sums.knownUnrealizedAssets++;
  }
}

function compareHoldings(left: Holding, right: Holding): number {
  return (
    (left.quantity < right.quantity ? 1 : left.quantity > right.quantity ? -1 : 0) ||
    left.accountName.localeCompare(right.accountName, 'en')
  );
}

/** An asset's cost and its value less cost, whole and over the quantity whose cost is known. */
function assetResults(
  total: CostTotals,
  value: bigint | null,
  worth: (quantity: bigint) => bigint | null,
) {
  const held = total.quantity > 0n;
  const knownQuantity = knownQuantityOf(total);
  const cost =
    total.unknownQuantity > 0n || total.missingRateQuantity > 0n ? null : total.knownCost;
  const result = held && value !== null && cost !== null ? value - cost * ATOM_SCALE : null;
  // Value less cost over the quantity whose cost is known; the rest stays out, named as unknown.
  const knownValue = worth(knownQuantity);
  const knownResult =
    held && knownQuantity > 0n && knownValue !== null
      ? knownValue - total.knownCost * ATOM_SCALE
      : null;
  return { held, knownQuantity, cost, result, knownResult };
}

/** The accounts holding an asset, most units first, each with its value. */
function holdingRows(holdings: Iterable<Holding>, worth: (quantity: bigint) => bigint | null) {
  return [...holdings].sort(compareHoldings).map((holding) => {
    const holdingValue = worth(holding.quantity);
    return {
      accountId: holding.accountId,
      accountName: holding.accountName,
      quantity: formatAtoms(holding.quantity),
      value: holdingValue === null ? null : formatProduct(holdingValue),
    };
  });
}

/** One asset's row: its value, cost, results and the accounts holding it. */
function assetRow(input: {
  instrument: PortfolioInstrument;
  resolved: ReturnType<typeof resolvePrice>;
  priceChange24hPercent: string | null;
  total: CostTotals;
  value: bigint | null;
  realization: RealizedTotals;
  holdings: Iterable<Holding>;
  worth: (quantity: bigint) => bigint | null;
}) {
  const { instrument, total, value, realization, worth } = input;
  const { price, missingPrice } = input.resolved;
  const { held, knownQuantity, cost, result, knownResult } = assetResults(total, value, worth);
  return {
    instrumentId: instrument.id,
    name: instrument.name,
    symbol: instrument.symbol,
    assetType: instrument.assetType,
    valuationCurrency: instrument.valuationCurrency,
    priceSource: instrument.priceSource,
    securityType: instrument.securityType ?? null,
    quantity: formatAtoms(total.quantity),
    price,
    missingPrice: price ? null : missingPrice,
    priceChange24hPercent: input.priceChange24hPercent,
    // Nothing held is a known zero whatever the price.
    value: !held ? '0' : value === null ? null : formatProduct(value),
    sortValue: value,
    held,
    costBasis: cost === null ? null : formatAtoms(cost),
    knownCostSubtotal: formatAtoms(total.knownCost),
    unknownCostQuantity: formatAtoms(total.unknownQuantity),
    // COST-ESTIMATE: of the quantity with a cost, how much is costed at its price on arrival.
    estimatedCostQuantity: formatAtoms(total.estimatedQuantity),
    missingRateQuantity: formatAtoms(total.missingRateQuantity),
    knownCostQuantity: formatAtoms(knownQuantity),
    averageBuyPrice: knownQuantity > 0n ? quotient(total.knownCost, knownQuantity) : null,
    unrealizedPnl: result === null ? null : formatSignedProduct(result),
    unrealizedReturnPercent:
      result === null || cost === null || cost === 0n
        ? null
        : formatPercent(result, cost * ATOM_SCALE),
    knownUnrealizedPnl: knownResult === null ? null : formatSignedProduct(knownResult),
    knownUnrealizedReturnPercent:
      knownResult === null || total.knownCost === 0n
        ? null
        : formatPercent(knownResult, total.knownCost * ATOM_SCALE),
    realizedPnl: realization.unknown > 0 ? null : formatAtoms(realization.known),
    knownRealizedSubtotal: formatAtoms(realization.known),
    unknownRealizedCount: realization.unknown,
    holdings: holdingRows(input.holdings, worth),
  };
}

type SortableAsset = {
  held: boolean;
  sortValue: bigint | null;
  name: string;
  instrumentId: string;
};

// Held and priced by value, held without a price, then everything else by name.
const assetRank = (asset: SortableAsset) => (!asset.held ? 2 : asset.sortValue === null ? 1 : 0);

function compareAssets(left: SortableAsset, right: SortableAsset): number {
  return (
    assetRank(left) - assetRank(right) ||
    (left.sortValue !== null && right.sortValue !== null && left.sortValue !== right.sortValue
      ? left.sortValue < right.sortValue
        ? 1
        : -1
      : 0) ||
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) ||
    left.instrumentId.localeCompare(right.instrumentId)
  );
}

/** DEP-VALUE: the deposits' value in the sums and allocation, and what of them is unknown. */
function addDeposits(
  deposits: readonly PortfolioDeposit[],
  sums: PortfolioSums,
  groups: { byAsset: Groups; byType: Groups; byAccount: Groups },
) {
  let depositValue = 0n;
  let unratedDepositCount = 0;
  let interestMissingDepositCount = 0;
  for (const deposit of deposits) {
    if (deposit.interestMissing) interestMissingDepositCount++;
    if (deposit.value === null) unratedDepositCount++;
    else if (deposit.value > 0n) {
      depositValue += deposit.value;
      sums.subtotal += deposit.value;
      add(groups.byAsset, `deposit:${deposit.id}`, deposit.name, deposit.value);
      add(groups.byType, DEPOSITS_TYPE, 'Bank deposits', deposit.value);
      add(groups.byAccount, `bank:${deposit.bank}`, deposit.bank, deposit.value);
    }
  }
  return { depositValue, unratedDepositCount, interestMissingDepositCount };
}

/** The portfolio's totals, each null while what it depends on is unknown. */
function portfolioTotals(
  sums: PortfolioSums,
  deposited: ReturnType<typeof addDeposits>,
  state: {
    unavailableAccountCount: number;
    investmentAvailable: boolean;
    complete: boolean;
    costComplete: boolean;
    available: boolean;
  },
) {
  const { complete, costComplete, available, investmentAvailable } = state;
  const { depositValue, unratedDepositCount, interestMissingDepositCount } = deposited;
  const unrealizedKnown = investmentAvailable && sums.unrealizedComplete;
  const partlyKnown = investmentAvailable && sums.knownUnrealizedAssets > 0;
  return {
    // The total of an account whose interest is missing is a floor: it stays a figure, marked
    // incomplete so history and goals do not take it for exact.
    completeness:
      complete && interestMissingDepositCount === 0
        ? ('complete' as const)
        : ('incomplete' as const),
    totalValue: complete ? formatProduct(sums.subtotal) : null,
    pricedSubtotal: formatProduct(sums.subtotal),
    missingPriceCount: sums.missingPriceCount,
    stalePriceCount: sums.stalePriceCount,
    unavailableAccountCount: state.unavailableAccountCount,
    depositsValue: formatProduct(depositValue),
    unratedDepositCount,
    interestMissingDepositCount,
    costBasis: costComplete ? formatAtoms(sums.knownCost) : null,
    knownCostSubtotal: formatAtoms(sums.knownCost),
    unknownCostCount: sums.unknownCostCount,
    // COST-ESTIMATE: held assets part of whose cost is an estimate.
    estimatedCostCount: sums.estimatedCostCount,
    missingRateCount: sums.missingRateCount,
    unrealizedPnl: unrealizedKnown ? formatSignedProduct(sums.unrealized) : null,
    unrealizedReturnPercent:
      unrealizedKnown && sums.unrealizedCost !== 0n
        ? formatPercent(sums.unrealized, sums.unrealizedCost * ATOM_SCALE)
        : null,
    knownUnrealizedPnl: partlyKnown ? formatSignedProduct(sums.knownUnrealized) : null,
    knownUnrealizedReturnPercent:
      partlyKnown && sums.knownUnrealizedCost !== 0n
        ? formatPercent(sums.knownUnrealized, sums.knownUnrealizedCost * ATOM_SCALE)
        : null,
    realizedPnl:
      available && sums.unknownRealizedCount === 0 ? formatAtoms(sums.knownRealized) : null,
    knownRealizedSubtotal: formatAtoms(sums.knownRealized),
    unknownRealizedCount: sums.unknownRealizedCount,
  };
}

/**
 * Whole-portfolio valuation from one database snapshot (portfolio-valuation, PV-1..4) in one
 * accounting currency (CUR-*): costs at each acquisition date's rate, proceeds at each sale
 * date's rate and current values at today's rate.
 */
export function projectPortfolio(
  at: Date,
  instruments: readonly PortfolioInstrument[],
  accounts: readonly PortfolioAccountInput[],
  prices: PortfolioPrices,
  fx: FxConverter = usdOnly(),
  /** Prices stored at or before 24 hours ago, for each price's daily change. */
  previous?: PortfolioPrices,
  /** DEP-VALUE: bank deposits, which add to the value but have no price, lots or cost. */
  deposits: readonly PortfolioDeposit[] = [],
) {
  const today = moscowDate(at);
  const unavailableAccountCount = accounts.filter(
    (account) => account.coverage === 'before-coverage',
  ).length;
  const resolved = new Map(
    instruments.map((item) => [item.id, resolvePrice(item, prices, at, fx)]),
  );
  const byAccount: Groups = new Map();
  const { holdings, totals, investmentTotals } = collectLots(accounts, fx);
  const valueAt = (instrumentId: string, quantity: bigint) => {
    const price = resolved.get(instrumentId)?.price ?? null;
    return price ? quantity * canonicalDecimalToAtoms(price.value) : null;
  };
  const accountValues = accountTotals(accounts, holdings, valueAt, byAccount);
  const realized = realizedTotals(accounts, fx);

  const sums: PortfolioSums = {
    subtotal: 0n,
    missingPriceCount: 0,
    stalePriceCount: 0,
    knownCost: 0n,
    unknownCostCount: 0,
    estimatedCostCount: 0,
    missingRateCount: 0,
    unrealized: 0n,
    unrealizedCost: 0n,
    unrealizedComplete: true,
    knownUnrealized: 0n,
    knownUnrealizedCost: 0n,
    knownUnrealizedAssets: 0,
    knownRealized: 0n,
    unknownRealizedCount: 0,
  };
  const byType: Groups = new Map();
  const byAsset: Groups = new Map();
  const assets = instruments.map((instrument) => {
    const instrumentResolved = resolved.get(instrument.id)!;
    const total = totals.get(instrument.id) ?? noCost();
    const held = total.quantity > 0n;
    const value = valueAt(instrument.id, total.quantity);
    const worth = (quantity: bigint) => valueAt(instrument.id, quantity);
    const realization = realized.get(instrument.id) ?? { known: 0n, unknown: 0, missingRate: 0 };
    if (held) {
      addHeldAsset(sums, { byAsset, byType }, instrument, instrumentResolved.price, value, total);
      addInvestment(sums, investmentTotals.get(instrument.id), worth);
    }
    if ((held && total.missingRateQuantity > 0n) || realization.missingRate > 0)
      sums.missingRateCount++;
    sums.knownRealized += realization.known;
    sums.unknownRealizedCount += realization.unknown;
    return assetRow({
      instrument,
      resolved: instrumentResolved,
      priceChange24hPercent: priceChange24h(instrument, instrumentResolved.price, previous, at, fx),
      total,
      value,
      realization,
      holdings: holdings.get(instrument.id)?.values() ?? [],
      worth,
    });
  });
  assets.sort(compareAssets);

  const deposited = addDeposits(deposits, sums, { byAsset, byType, byAccount });
  const { subtotal } = sums;
  const available = unavailableAccountCount === 0;
  const investmentAvailable = !accounts.some(
    (account) => account.assetClass !== 'property' && account.coverage === 'before-coverage',
  );
  const complete = available && sums.missingPriceCount === 0 && deposited.unratedDepositCount === 0;
  const costComplete = available && sums.unknownCostCount === 0 && sums.missingRateCount === 0;
  return {
    at: at.toISOString(),
    currency: fx.currency as AccountingCurrency,
    rates: fx.ratesOn(today),
    staleRates: fx.staleRatesOn(today),
    ...portfolioTotals(sums, deposited, {
      unavailableAccountCount,
      investmentAvailable,
      complete,
      costComplete,
      available,
    }),
    assets: assets.map(({ sortValue: _value, held: _held, ...asset }) => {
      const allocation = byAsset.get(asset.instrumentId);
      return {
        ...asset,
        allocationPercent:
          // NW-SHARE-ESTIMATE: of the known part while interest is missing; the allocation says
          // it is incomplete.
          allocation && subtotal > 0n ? formatPercent(allocation.value, subtotal) : null,
      };
    }),
    allocation: {
      complete: complete && deposited.interestMissingDepositCount === 0,
      byAsset: slices(byAsset, subtotal),
      byType: slices(byType, subtotal),
      byAccount: slices(byAccount, subtotal),
    },
    accounts: accounts.map((account) => {
      const summary = accountValues.get(account.accountId)!;
      return {
        accountId: account.accountId,
        name: account.name,
        coverage: account.coverage,
        pricedValue: account.coverage === 'before-coverage' ? null : formatProduct(summary.value),
        missingPriceCount: summary.missing,
      };
    }),
  };
}
