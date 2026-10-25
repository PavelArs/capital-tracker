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
}
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
  const instant = at.toISOString();
  const split = (prices.splits ?? []).reduce(
    (units, item) =>
      item.instrumentId === instrument.id &&
      item.effectiveAt > stored.observedAt &&
      item.effectiveAt <= instant
        ? units * BigInt(item.ratio)
        : units,
    1n,
  );
  // BPR-3: a price a broker reported ages like a market price; a hand value does not.
  const status =
    instrument.priceSource === 'manual' && stored.source === 'manual'
      ? 'manual'
      : freshness(stored.observedAt, at) === 'fresh'
        ? 'fresh'
        : 'stale';
  return {
    price: {
      value: formatAtoms(value / split),
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
  // How many units each unit a buy bought had become by `until`, through the splits since.
  const splitSince = (trade: FifoTrade | undefined, until?: string) =>
    (journal.splits ?? []).reduce(
      (units, split) =>
        trade &&
        split.instrumentId === trade.instrumentId &&
        split.effectiveAt > trade.occurredAt &&
        (until === undefined || split.effectiveAt <= until)
          ? units * BigInt(split.ratio)
          : units,
      1n,
    );
  const share = (tradeId: string, version: number, quantity: string, until?: string) => {
    const trade = paid.get(tradeKey(tradeId, version));
    return nativeShare(trade, quantity, splitSince(trade, until));
  };
  const fromOrigin = (origin: LotOrigin, quantity: string, until?: string) =>
    origin.kind === 'trade'
      ? share(origin.tradeId, origin.version, quantity, until)
      : origin.kind === 'capital-return' && origin.paidCurrency
        ? { currency: origin.paidCurrency, amount: quantity }
        : undefined;
  const returned = (parts: readonly ReturnedPart[] | undefined) =>
    parts?.length
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
  const native = (value: NativeAmount | undefined) => (value ? { native: value } : {});
  const carried = new Map(
    journal.initialLots.map((lot) => [
      lotKey(lot.lotId, lot.openingRevision, lot.ordinal),
      lot.acquiredAt,
    ]),
  );
  const known = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('FIFO evidence without its source');
    return value;
  };
  const lots = fifo.lots.map((lot): PortfolioLot => {
    const acquiredAt =
      'origin' in lot
        ? lot.origin.acquiredAt
        : 'buyTradeId' in lot
          ? lot.occurredAt
          : lot.acquiredAt;
    return {
      instrumentId: lot.instrumentId,
      quantity: lot.remainingQuantity,
      costUsd: lot.remainingCostUsd,
      acquiredAt,
      ...returned(lot.returned),
      ...(isPurchase(lot, isBoughtTrade) ? { purchase: true as const } : {}),
      ...native(
        'origin' in lot
          ? fromOrigin(lot.origin, lot.remainingQuantity, journal.at)
          : 'buyTradeId' in lot
            ? share(lot.buyTradeId, lot.buyVersion, lot.remainingQuantity, journal.at)
            : undefined,
      ),
    };
  });
  const consumed = new Map<string, ConsumedCost[]>();
  for (const match of fifo.matches) {
    const acquiredAt =
      'origin' in match
        ? match.origin.acquiredAt
        : 'buyTradeId' in match
          ? known(trades.get(tradeKey(match.buyTradeId, match.buyVersion)))
          : known(carried.get(lotKey(match.lotId, match.openingRevision, match.ordinal)));
    const key = tradeKey(match.sellTradeId, match.sellVersion);
    // A sale's units are those of its own date.
    const soldAt = trades.get(key);
    const list = consumed.get(key) ?? [];
    list.push({
      costUsd: match.costUsd,
      acquiredAt,
      ...returned(match.returned),
      ...native(
        'origin' in match
          ? fromOrigin(match.origin, match.quantity, soldAt)
          : 'buyTradeId' in match
            ? share(match.buyTradeId, match.buyVersion, match.quantity, soldAt)
            : undefined,
      ),
    });
    consumed.set(key, list);
  }
  const realizations: PortfolioRealization[] = fifo.realizations.map((sale) => {
    const trade = paid.get(tradeKey(sale.sellTradeId, sale.sellVersion));
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
      consumed: consumed.get(tradeKey(sale.sellTradeId, sale.sellVersion)) ?? [],
    };
  });
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
        ...returned(item.returned),
        ...native(fromOrigin(item.origin, item.quantity, swap.occurredAt)),
      })),
    });
  }
  // The share of a return that the cost of the units could not take is realized when it comes.
  for (const { capitalReturnId } of journal.capitalReturns ?? []) {
    const allocation = capitalReturnAllocations.get(capitalReturnId);
    if (!allocation) continue;
    if (allocation.realizedUsd !== null && canonicalDecimalToAtoms(allocation.realizedUsd) === 0n)
      continue;
    realizations.push({
      instrumentId: allocation.instrumentId,
      occurredAt: allocation.occurredAt,
      proceedsUsd: allocation.realizedUsd,
      ...(allocation.realizedNative ? { nativeProceeds: allocation.realizedNative } : {}),
      consumed: [],
    });
  }
  return { ...identity, coverage: 'covered', lots, realizations };
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
}

function addLotCost(totals: Map<string, CostTotals>, instrumentId: string, lot: CostTotals) {
  const total = totals.get(instrumentId) ?? {
    quantity: 0n,
    knownCost: 0n,
    unknownQuantity: 0n,
    missingRateQuantity: 0n,
  };
  total.quantity += lot.quantity;
  total.knownCost += lot.knownCost;
  total.unknownQuantity += lot.unknownQuantity;
  total.missingRateQuantity += lot.missingRateQuantity;
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
  // An amount paid in RUB or EUR is exact in its own currency and converts from it; USD
  // figures stay the USD amounts derived at the trade's date (CUR-PAID-RUB).
  const toCurrency = (usd: string, instant: string, native?: NativeAmount) =>
    convertAmount(fx, usd, instant, native);
  const unavailableAccountCount = accounts.filter(
    (account) => account.coverage === 'before-coverage',
  ).length;
  const resolved = new Map(
    instruments.map((item) => [item.id, resolvePrice(item, prices, at, fx)]),
  );
  const byAccount = new Map<string, { label: string; value: bigint }>();
  const accountValues = new Map<string, { value: bigint; missing: number }>();
  const holdings = new Map<
    string,
    Map<string, { accountId: string; accountName: string; quantity: bigint }>
  >();
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
      const cost = lotCostIn(fx, lot);
      const amounts = {
        quantity,
        knownCost: cost ?? 0n,
        unknownQuantity: lot.costUsd === null ? quantity : 0n,
        missingRateQuantity: lot.costUsd !== null && cost === null ? quantity : 0n,
      };
      addLotCost(totals, lot.instrumentId, amounts);
      if (account.assetClass !== 'property')
        addLotCost(investmentTotals, lot.instrumentId, amounts);
    }
  }
  const valueAt = (instrumentId: string, quantity: bigint) => {
    const price = resolved.get(instrumentId)?.price ?? null;
    return price ? quantity * canonicalDecimalToAtoms(price.value) : null;
  };
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
  const realized = new Map<string, RealizedTotals>();
  for (const account of accounts) {
    for (const realization of account.realizations) {
      const entry = realized.get(realization.instrumentId) ?? {
        known: 0n,
        unknown: 0,
        missingRate: 0,
      };
      let result: bigint | null = null;
      let missingRate = false;
      const amounts = [
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
      if (amounts.every((amount) => amount !== null)) {
        result = 0n;
        for (const amount of amounts) {
          const converted = toCurrency(amount!.usd, amount!.at, amount!.native);
          if (converted === null) {
            missingRate = true;
            result = null;
            break;
          }
          result += amount!.sign * converted;
        }
      }
      if (result === null) {
        entry.unknown++;
        if (missingRate) entry.missingRate++;
      } else entry.known += result;
      realized.set(realization.instrumentId, entry);
    }
  }

  let subtotal = 0n;
  let missingPriceCount = 0;
  let stalePriceCount = 0;
  let knownCost = 0n;
  let unknownCostCount = 0;
  let missingRateCount = 0;
  let unrealized = 0n;
  let unrealizedCost = 0n;
  let unrealizedComplete = true;
  // The same result over the coins whose cost is known, for a portfolio that is only partly known.
  let knownUnrealized = 0n;
  let knownUnrealizedCost = 0n;
  let knownUnrealizedAssets = 0;
  let knownRealized = 0n;
  let unknownRealizedCount = 0;
  const byType = new Map<string, { label: string; value: bigint }>();
  const byAsset = new Map<string, { label: string; value: bigint }>();
  const assets = instruments.map((instrument) => {
    const { price, missingPrice } = resolved.get(instrument.id)!;
    const total = totals.get(instrument.id) ?? {
      quantity: 0n,
      knownCost: 0n,
      unknownQuantity: 0n,
      missingRateQuantity: 0n,
    };
    const held = total.quantity > 0n;
    const knownQuantity = total.quantity - total.unknownQuantity - total.missingRateQuantity;
    const value = valueAt(instrument.id, total.quantity);
    const cost =
      total.unknownQuantity > 0n || total.missingRateQuantity > 0n ? null : total.knownCost;
    const result = held && value !== null && cost !== null ? value - cost * ATOM_SCALE : null;
    // Value less cost over the quantity whose cost is known; the rest stays out, named as unknown.
    const knownValue = valueAt(instrument.id, knownQuantity);
    const knownResult =
      held && knownQuantity > 0n && knownValue !== null
        ? knownValue - total.knownCost * ATOM_SCALE
        : null;
    const realization = realized.get(instrument.id) ?? { known: 0n, unknown: 0, missingRate: 0 };
    if (held) {
      if (value === null) missingPriceCount++;
      else {
        subtotal += value;
        add(byAsset, instrument.id, instrument.name, value);
        add(byType, instrument.assetType, typeLabels[instrument.assetType], value);
      }
      if (price?.status === 'stale') stalePriceCount++;
      knownCost += total.knownCost;
      if (total.unknownQuantity > 0n) unknownCostCount++;
      const investment = investmentTotals.get(instrument.id);
      if (investment) {
        const investmentValue = valueAt(instrument.id, investment.quantity);
        unrealizedCost += investment.knownCost;
        if (
          investmentValue === null ||
          investment.unknownQuantity > 0n ||
          investment.missingRateQuantity > 0n
        )
          unrealizedComplete = false;
        else unrealized += investmentValue - investment.knownCost * ATOM_SCALE;
      }
      // A coin without a price stays out of the known result, as of the known value: it is
      // counted in missingPriceCount and said so in the notes, but does not empty the rest.
      const investmentKnown = investment
        ? investment.quantity - investment.unknownQuantity - investment.missingRateQuantity
        : 0n;
      const investmentKnownValue = valueAt(instrument.id, investmentKnown);
      if (investmentKnown > 0n && investmentKnownValue !== null && investment) {
        knownUnrealized += investmentKnownValue - investment.knownCost * ATOM_SCALE;
        knownUnrealizedCost += investment.knownCost;
        knownUnrealizedAssets++;
      }
    }
    if ((held && total.missingRateQuantity > 0n) || realization.missingRate > 0) missingRateCount++;
    knownRealized += realization.known;
    unknownRealizedCount += realization.unknown;
    return {
      instrumentId: instrument.id,
      name: instrument.name,
      symbol: instrument.symbol,
      assetType: instrument.assetType,
      valuationCurrency: instrument.valuationCurrency,
      priceSource: instrument.priceSource,
      quantity: formatAtoms(total.quantity),
      price,
      missingPrice: price ? null : missingPrice,
      priceChange24hPercent: priceChange24h(instrument, price, previous, at, fx),
      // Nothing held is a known zero whatever the price.
      value: !held ? '0' : value === null ? null : formatProduct(value),
      sortValue: value,
      held,
      costBasis: cost === null ? null : formatAtoms(cost),
      knownCostSubtotal: formatAtoms(total.knownCost),
      unknownCostQuantity: formatAtoms(total.unknownQuantity),
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
      holdings: [...(holdings.get(instrument.id)?.values() ?? [])]
        .sort(
          (left, right) =>
            (left.quantity < right.quantity ? 1 : left.quantity > right.quantity ? -1 : 0) ||
            left.accountName.localeCompare(right.accountName, 'en'),
        )
        .map((holding) => {
          const holdingValue = valueAt(instrument.id, holding.quantity);
          return {
            accountId: holding.accountId,
            accountName: holding.accountName,
            quantity: formatAtoms(holding.quantity),
            value: holdingValue === null ? null : formatProduct(holdingValue),
          };
        }),
    };
  });
  // Held and priced by value, held without a price, then everything else by name.
  const rank = (asset: (typeof assets)[number]) =>
    !asset.held ? 2 : asset.sortValue === null ? 1 : 0;
  assets.sort(
    (left, right) =>
      rank(left) - rank(right) ||
      (left.sortValue !== null && right.sortValue !== null && left.sortValue !== right.sortValue
        ? left.sortValue < right.sortValue
          ? 1
          : -1
        : 0) ||
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) ||
      left.instrumentId.localeCompare(right.instrumentId),
  );

  let depositValue = 0n;
  let unratedDepositCount = 0;
  let interestMissingDepositCount = 0;
  for (const deposit of deposits) {
    if (deposit.interestMissing) interestMissingDepositCount++;
    if (deposit.value === null) unratedDepositCount++;
    else if (deposit.value > 0n) {
      depositValue += deposit.value;
      subtotal += deposit.value;
      add(byAsset, `deposit:${deposit.id}`, deposit.name, deposit.value);
      add(byType, DEPOSITS_TYPE, 'Bank deposits', deposit.value);
      add(byAccount, `bank:${deposit.bank}`, deposit.bank, deposit.value);
    }
  }
  const available = unavailableAccountCount === 0;
  const investmentAvailable = !accounts.some(
    (account) => account.assetClass !== 'property' && account.coverage === 'before-coverage',
  );
  const complete = available && missingPriceCount === 0 && unratedDepositCount === 0;
  const costComplete = available && unknownCostCount === 0 && missingRateCount === 0;
  return {
    at: at.toISOString(),
    currency: fx.currency as AccountingCurrency,
    rates: fx.ratesOn(today),
    staleRates: fx.staleRatesOn(today),
    // The total of an account whose interest is missing is a floor: it stays a figure, marked
    // incomplete so history and goals do not take it for exact.
    completeness:
      complete && interestMissingDepositCount === 0
        ? ('complete' as const)
        : ('incomplete' as const),
    totalValue: complete ? formatProduct(subtotal) : null,
    pricedSubtotal: formatProduct(subtotal),
    missingPriceCount,
    stalePriceCount,
    unavailableAccountCount,
    depositsValue: formatProduct(depositValue),
    unratedDepositCount,
    interestMissingDepositCount,
    costBasis: costComplete ? formatAtoms(knownCost) : null,
    knownCostSubtotal: formatAtoms(knownCost),
    unknownCostCount,
    missingRateCount,
    unrealizedPnl:
      investmentAvailable && unrealizedComplete ? formatSignedProduct(unrealized) : null,
    unrealizedReturnPercent:
      investmentAvailable && unrealizedComplete && unrealizedCost !== 0n
        ? formatPercent(unrealized, unrealizedCost * ATOM_SCALE)
        : null,
    knownUnrealizedPnl:
      investmentAvailable && knownUnrealizedAssets > 0
        ? formatSignedProduct(knownUnrealized)
        : null,
    knownUnrealizedReturnPercent:
      investmentAvailable && knownUnrealizedAssets > 0 && knownUnrealizedCost !== 0n
        ? formatPercent(knownUnrealized, knownUnrealizedCost * ATOM_SCALE)
        : null,
    realizedPnl: available && unknownRealizedCount === 0 ? formatAtoms(knownRealized) : null,
    knownRealizedSubtotal: formatAtoms(knownRealized),
    unknownRealizedCount,
    assets: assets.map(({ sortValue: _value, held: _held, ...asset }) => {
      const allocation = byAsset.get(asset.instrumentId);
      return {
        ...asset,
        allocationPercent:
          allocation && subtotal > 0n && interestMissingDepositCount === 0
            ? formatPercent(allocation.value, subtotal)
            : null,
      };
    }),
    allocation: {
      complete: complete && interestMissingDepositCount === 0,
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
