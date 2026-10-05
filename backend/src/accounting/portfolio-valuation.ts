import {
  type AccountingCurrency,
  FxConverter,
  type FxRates,
  moscowDate,
} from '../fx-rates/fx-conversion';
import { freshness } from '../prices/price-collection';
import type { AssetType, PriceSource, ValuationCurrency } from './asset-classification';
import type { SwapAllocation } from './asset-swap-types';
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
}
/** A held FIFO fragment with its original acquisition instant (Q1: cost at that date). */
export interface PortfolioLot {
  instrumentId: string;
  quantity: string;
  costUsd: string | null;
  acquiredAt: string;
  native?: NativeAmount;
}
export interface ConsumedCost {
  costUsd: string | null;
  acquiredAt: string;
  native?: NativeAmount;
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
  coverage: 'covered' | 'not-started' | 'before-coverage';
  lots: readonly PortfolioLot[];
  realizations: readonly PortfolioRealization[];
}
/** A stored price before the asset's source decides how it is used. */
export interface StoredPrice {
  priceUsd: string;
  observedAt: string;
  source: string;
}
export interface PortfolioPrices {
  market: ReadonlyMap<string, StoredPrice>;
  manual: ReadonlyMap<string, StoredPrice>;
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
  // Stored market and manual prices are in USD.
  const value = fx.convert(canonicalDecimalToAtoms(stored.priceUsd), 'USD', today);
  if (value === null) return { price: null, missingPrice: 'no-rate' };
  const status =
    instrument.priceSource === 'manual'
      ? 'manual'
      : freshness(stored.observedAt, at) === 'fresh'
        ? 'fresh'
        : 'stale';
  return {
    price: {
      value: formatAtoms(value),
      observedAt: stored.observedAt,
      source: stored.source,
      status,
    },
    missingPrice: null,
  };
}

/**
 * The price's change since the same moment a day earlier, in the report's currency at each
 * day's rate. A market price older than 2 hours at that moment is not that day's price.
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
    const stored = instrument.symbol
      ? previous.market.get(instrument.symbol.toUpperCase())
      : undefined;
    if (!stored || freshness(stored.observedAt, dayBefore) !== 'fresh') return null;
  }
  const before = resolvePrice(instrument, previous, dayBefore, fx).price;
  if (!before) return null;
  const then = canonicalDecimalToAtoms(before.value);
  if (then === 0n) return null;
  return formatPercent(canonicalDecimalToAtoms(current.value) - then, then);
}

const tradeKey = (tradeId: string, version: number) => `${tradeId}:${version}`;
const lotKey = (lotId: string, revision: number, ordinal: number) =>
  `${lotId}:${revision}:${ordinal}`;

/** A buy's amount as paid, shared by quantity, half away from zero. */
function nativeShare(trade: FifoTrade | undefined, quantity: string): NativeAmount | undefined {
  if (!trade?.paid || trade.side !== 'buy') return undefined;
  const total = canonicalDecimalToAtoms(trade.paid.gross) + canonicalDecimalToAtoms(trade.paid.fee);
  const whole = canonicalDecimalToAtoms(trade.quantity);
  const part = canonicalDecimalToAtoms(quantity);
  return {
    currency: trade.paid.currency,
    amount: formatAtoms((total * part * 2n + whole) / (whole * 2n)),
  };
}

/**
 * One covered account's FIFO result as dated lots and realizations. A transferred, rewarded
 * or swapped fragment keeps its original acquisition instant, and a fragment of a buy paid in
 * RUB or EUR its share of the amount paid. `linkedTrades` are the other connected accounts'
 * trades, where transferred fragments were bought.
 */
export function portfolioAccount(
  identity: { accountId: string; name: string },
  fifo: Pick<AccountFifoResult, 'lots' | 'realizations' | 'matches'>,
  journal: {
    trades: readonly FifoTrade[];
    initialLots: readonly FifoCarryInInput[];
    swaps?: readonly { swapId: string; outgoingInstrumentId: string; occurredAt: string }[];
    linkedTrades?: readonly FifoTrade[];
  },
  swapAllocations: ReadonlyMap<string, SwapAllocation> = new Map(),
): PortfolioAccountInput {
  const trades = new Map(
    journal.trades.map((trade) => [tradeKey(trade.tradeId, trade.version), trade.occurredAt]),
  );
  const paid = new Map(
    [...(journal.linkedTrades ?? []), ...journal.trades]
      .filter((trade) => trade.paid)
      .map((trade) => [tradeKey(trade.tradeId, trade.version), trade]),
  );
  const fromOrigin = (origin: LotOrigin, quantity: string) =>
    origin.kind === 'trade'
      ? nativeShare(paid.get(tradeKey(origin.tradeId, origin.version)), quantity)
      : undefined;
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
      ...native(
        'origin' in lot
          ? fromOrigin(lot.origin, lot.remainingQuantity)
          : 'buyTradeId' in lot
            ? nativeShare(paid.get(tradeKey(lot.buyTradeId, lot.buyVersion)), lot.remainingQuantity)
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
    const list = consumed.get(key) ?? [];
    list.push({
      costUsd: match.costUsd,
      acquiredAt,
      ...native(
        'origin' in match
          ? fromOrigin(match.origin, match.quantity)
          : 'buyTradeId' in match
            ? nativeShare(paid.get(tradeKey(match.buyTradeId, match.buyVersion)), match.quantity)
            : undefined,
      ),
    });
    consumed.set(key, list);
  }
  const realizations: PortfolioRealization[] = fifo.realizations.map((sale) => {
    const sold = paid.get(tradeKey(sale.sellTradeId, sale.sellVersion))?.paid;
    return {
      instrumentId: sale.instrumentId,
      occurredAt: sale.occurredAt,
      proceedsUsd: sale.netUsd,
      ...(sold
        ? {
            nativeProceeds: {
              currency: sold.currency,
              amount: formatAtoms(
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
        ...native(fromOrigin(item.origin, item.quantity)),
      })),
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
interface RealizedTotals {
  known: bigint;
  unknown: number;
  missingRate: number;
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
) {
  const today = moscowDate(at);
  // An amount paid in RUB or EUR is exact in its own currency and converts from it; USD
  // figures stay the USD amounts derived at the trade's date (CUR-PAID-RUB).
  const toCurrency = (usd: string, instant: string, native?: NativeAmount) =>
    native && fx.currency !== 'USD'
      ? fx.convert(signedAtoms(native.amount), native.currency, moscowDate(instant))
      : fx.convert(signedAtoms(usd), 'USD', moscowDate(instant));
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
      const total = totals.get(lot.instrumentId) ?? {
        quantity: 0n,
        knownCost: 0n,
        unknownQuantity: 0n,
        missingRateQuantity: 0n,
      };
      total.quantity += quantity;
      if (lot.costUsd === null) total.unknownQuantity += quantity;
      else {
        const cost = toCurrency(lot.costUsd, lot.acquiredAt, lot.native);
        if (cost === null) total.missingRateQuantity += quantity;
        else total.knownCost += cost;
      }
      totals.set(lot.instrumentId, total);
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
        ...realization.consumed.map((item) =>
          item.costUsd === null
            ? null
            : { usd: item.costUsd, at: item.acquiredAt, native: item.native, sign: -1n },
        ),
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
  let unrealizedComplete = true;
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
      if (result === null) unrealizedComplete = false;
      else unrealized += result;
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
      averageBuyPrice: knownQuantity > 0n ? quotient(total.knownCost, knownQuantity) : null,
      unrealizedPnl: result === null ? null : formatSignedProduct(result),
      unrealizedReturnPercent:
        result === null || cost === null || cost === 0n
          ? null
          : formatPercent(result, cost * ATOM_SCALE),
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

  const available = unavailableAccountCount === 0;
  const complete = available && missingPriceCount === 0;
  const costComplete = available && unknownCostCount === 0 && missingRateCount === 0;
  return {
    at: at.toISOString(),
    currency: fx.currency as AccountingCurrency,
    rates: fx.ratesOn(today),
    completeness: complete ? ('complete' as const) : ('incomplete' as const),
    totalValue: complete ? formatProduct(subtotal) : null,
    pricedSubtotal: formatProduct(subtotal),
    missingPriceCount,
    stalePriceCount,
    unavailableAccountCount,
    costBasis: costComplete ? formatAtoms(knownCost) : null,
    knownCostSubtotal: formatAtoms(knownCost),
    unknownCostCount,
    missingRateCount,
    unrealizedPnl: available && unrealizedComplete ? formatSignedProduct(unrealized) : null,
    unrealizedReturnPercent:
      available && unrealizedComplete && costComplete && knownCost !== 0n
        ? formatPercent(unrealized, knownCost * ATOM_SCALE)
        : null,
    realizedPnl: available && unknownRealizedCount === 0 ? formatAtoms(knownRealized) : null,
    knownRealizedSubtotal: formatAtoms(knownRealized),
    unknownRealizedCount,
    assets: assets.map(({ sortValue: _value, held: _held, ...asset }) => {
      const allocation = byAsset.get(asset.instrumentId);
      return {
        ...asset,
        allocationPercent:
          allocation && subtotal > 0n ? formatPercent(allocation.value, subtotal) : null,
      };
    }),
    allocation: {
      complete,
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
