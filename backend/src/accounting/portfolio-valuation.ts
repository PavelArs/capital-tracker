import { freshness } from '../prices/price-collection';
import type { AssetType, PriceSource, ValuationCurrency } from './asset-classification';
import type { HistoricalPosition } from './historical-accounting';
import {
  canonicalDecimalToAtoms,
  formatAtoms,
  formatPercent,
  formatProduct,
  formatSignedProduct,
} from './money';

const ATOM_SCALE = 10n ** 30n;

export interface PortfolioInstrument {
  id: string;
  name: string;
  symbol: string | null;
  assetType: AssetType;
  valuationCurrency: ValuationCurrency;
  priceSource: PriceSource;
}
export interface PortfolioRealization {
  instrumentId: string;
  realizedUsd: string | null;
}
export interface PortfolioAccountInput {
  accountId: string;
  name: string;
  coverage: 'covered' | 'not-started' | 'before-coverage';
  positions: readonly HistoricalPosition[];
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
export interface AssetPrice {
  priceUsd: string;
  observedAt: string | null;
  source: string;
  status: 'fresh' | 'stale' | 'manual' | 'fixed';
}
export interface AllocationSlice {
  key: string;
  label: string;
  valueUsd: string;
  percent: string | null;
}

const typeLabels: Record<AssetType, string> = { crypto: 'Crypto', fiat: 'Cash', manual: 'Manual' };

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

/** Valuation rule (product model, section 4): price by the asset's own source. */
export function resolvePrice(
  instrument: PortfolioInstrument,
  prices: PortfolioPrices,
  at: Date,
): { price: AssetPrice | null; missingPrice: 'no-price' | 'no-rate' | null } {
  if (instrument.priceSource === 'fixed') {
    // EUR and RUB need Bank of Russia rates (M5); a rate is never invented.
    if (instrument.valuationCurrency !== 'USD') return { price: null, missingPrice: 'no-rate' };
    return {
      price: { priceUsd: '1', observedAt: null, source: 'fixed', status: 'fixed' },
      missingPrice: null,
    };
  }
  if (instrument.priceSource === 'market') {
    const stored = instrument.symbol ? prices.market.get(instrument.symbol.toUpperCase()) : null;
    if (!stored) return { price: null, missingPrice: 'no-price' };
    const status = freshness(stored.observedAt, at) === 'fresh' ? 'fresh' : 'stale';
    return { price: { ...stored, status }, missingPrice: null };
  }
  const stored = prices.manual.get(instrument.id);
  if (!stored) return { price: null, missingPrice: 'no-price' };
  return { price: { ...stored, status: 'manual' }, missingPrice: null };
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
        valueUsd: formatProduct(value),
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

/** Whole-portfolio valuation from one database snapshot (portfolio-valuation, PV-1..4). */
export function projectPortfolio(
  at: Date,
  instruments: readonly PortfolioInstrument[],
  accounts: readonly PortfolioAccountInput[],
  prices: PortfolioPrices,
) {
  const unavailableAccountCount = accounts.filter(
    (account) => account.coverage === 'before-coverage',
  ).length;
  const resolved = new Map(instruments.map((item) => [item.id, resolvePrice(item, prices, at)]));
  const byAccount = new Map<string, { label: string; value: bigint }>();
  const accountValues = new Map<string, { value: bigint; missing: number }>();
  const holdings = new Map<
    string,
    { accountId: string; accountName: string; quantity: bigint; value: bigint | null }[]
  >();
  const totals = new Map<
    string,
    { quantity: bigint; knownCost: bigint; unknownQuantity: bigint }
  >();
  for (const account of accounts) {
    const summary = { value: 0n, missing: 0 };
    for (const position of account.positions) {
      const quantity = canonicalDecimalToAtoms(position.quantity);
      if (quantity === 0n) continue;
      const price = resolved.get(position.instrumentId)?.price ?? null;
      const value = price ? quantity * canonicalDecimalToAtoms(price.priceUsd) : null;
      if (value === null) summary.missing++;
      else summary.value += value;
      const list = holdings.get(position.instrumentId) ?? [];
      list.push({ accountId: account.accountId, accountName: account.name, quantity, value });
      holdings.set(position.instrumentId, list);
      const total = totals.get(position.instrumentId) ?? {
        quantity: 0n,
        knownCost: 0n,
        unknownQuantity: 0n,
      };
      total.quantity += quantity;
      const unknown = position.unknownCostQuantity
        ? canonicalDecimalToAtoms(position.unknownCostQuantity)
        : 0n;
      total.unknownQuantity += unknown;
      total.knownCost += canonicalDecimalToAtoms(
        position.costUsd ?? position.knownCostSubtotalUsd ?? '0',
      );
      totals.set(position.instrumentId, total);
    }
    accountValues.set(account.accountId, summary);
    if (summary.value > 0n) add(byAccount, account.accountId, account.name, summary.value);
  }
  const realized = new Map<string, { known: bigint; unknown: number }>();
  for (const account of accounts) {
    for (const realization of account.realizations) {
      const entry = realized.get(realization.instrumentId) ?? { known: 0n, unknown: 0 };
      if (realization.realizedUsd === null) entry.unknown++;
      else entry.known += signedAtoms(realization.realizedUsd);
      realized.set(realization.instrumentId, entry);
    }
  }

  let subtotal = 0n;
  let missingPriceCount = 0;
  let stalePriceCount = 0;
  let knownCost = 0n;
  let unknownCostCount = 0;
  let unrealized = 0n;
  let unrealizedComplete = true;
  let knownRealized = 0n;
  let unknownRealizedCount = 0;
  const byType = new Map<string, { label: string; value: bigint }>();
  const byAsset = new Map<string, { label: string; value: bigint }>();
  const assets = instruments.map((instrument) => {
    const { price, missingPrice } = resolved.get(instrument.id)!;
    const total = totals.get(instrument.id) ?? { quantity: 0n, knownCost: 0n, unknownQuantity: 0n };
    const held = total.quantity > 0n;
    const knownQuantity = total.quantity - total.unknownQuantity;
    const value = price ? total.quantity * canonicalDecimalToAtoms(price.priceUsd) : null;
    const cost = total.unknownQuantity > 0n ? null : total.knownCost;
    const result = held && value !== null && cost !== null ? value - cost * ATOM_SCALE : null;
    const realization = realized.get(instrument.id) ?? { known: 0n, unknown: 0 };
    if (held) {
      if (value === null) missingPriceCount++;
      else {
        subtotal += value;
        add(byAsset, instrument.id, instrument.name, value);
        add(byType, instrument.assetType, typeLabels[instrument.assetType], value);
      }
      if (price?.status === 'stale') stalePriceCount++;
      knownCost += total.knownCost;
      if (cost === null) unknownCostCount++;
      if (result === null) unrealizedComplete = false;
      else unrealized += result;
    }
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
      // Nothing held is a known zero whatever the price.
      valueUsd: !held ? '0' : value === null ? null : formatProduct(value),
      value,
      held,
      costBasisUsd: cost === null ? null : formatAtoms(cost),
      knownCostSubtotalUsd: formatAtoms(total.knownCost),
      unknownCostQuantity: formatAtoms(total.unknownQuantity),
      averageBuyPriceUsd: knownQuantity > 0n ? quotient(total.knownCost, knownQuantity) : null,
      unrealizedPnlUsd: result === null ? null : formatSignedProduct(result),
      unrealizedReturnPercent:
        result === null || cost === null || cost === 0n
          ? null
          : formatPercent(result, cost * ATOM_SCALE),
      realizedPnlUsd: realization.unknown > 0 ? null : formatAtoms(realization.known),
      knownRealizedSubtotalUsd: formatAtoms(realization.known),
      unknownRealizedCount: realization.unknown,
      holdings: (holdings.get(instrument.id) ?? [])
        .sort(
          (left, right) =>
            (left.quantity < right.quantity ? 1 : left.quantity > right.quantity ? -1 : 0) ||
            left.accountName.localeCompare(right.accountName, 'en'),
        )
        .map((holding) => ({
          accountId: holding.accountId,
          accountName: holding.accountName,
          quantity: formatAtoms(holding.quantity),
          valueUsd: holding.value === null ? null : formatProduct(holding.value),
        })),
    };
  });
  // Held and priced by value, held without a price, then everything else by name.
  const rank = (asset: (typeof assets)[number]) => (!asset.held ? 2 : asset.value === null ? 1 : 0);
  assets.sort(
    (left, right) =>
      rank(left) - rank(right) ||
      (left.value !== null && right.value !== null && left.value !== right.value
        ? left.value < right.value
          ? 1
          : -1
        : 0) ||
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) ||
      left.instrumentId.localeCompare(right.instrumentId),
  );

  const available = unavailableAccountCount === 0;
  const complete = available && missingPriceCount === 0;
  const costComplete = available && unknownCostCount === 0;
  return {
    at: at.toISOString(),
    quoteCurrency: 'USD' as const,
    completeness: complete ? ('complete' as const) : ('incomplete' as const),
    totalValueUsd: complete ? formatProduct(subtotal) : null,
    pricedSubtotalUsd: formatProduct(subtotal),
    missingPriceCount,
    stalePriceCount,
    unavailableAccountCount,
    costBasisUsd: costComplete ? formatAtoms(knownCost) : null,
    knownCostSubtotalUsd: formatAtoms(knownCost),
    unknownCostCount,
    unrealizedPnlUsd: available && unrealizedComplete ? formatSignedProduct(unrealized) : null,
    unrealizedReturnPercent:
      available && unrealizedComplete && costComplete && knownCost !== 0n
        ? formatPercent(unrealized, knownCost * ATOM_SCALE)
        : null,
    realizedPnlUsd: available && unknownRealizedCount === 0 ? formatAtoms(knownRealized) : null,
    knownRealizedSubtotalUsd: formatAtoms(knownRealized),
    unknownRealizedCount,
    assets: assets.map(({ value: _value, held: _held, ...asset }) => {
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
        pricedValueUsd:
          account.coverage === 'before-coverage' ? null : formatProduct(summary.value),
        missingPriceCount: summary.missing,
      };
    }),
  };
}
