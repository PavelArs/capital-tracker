import { type FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import type { InflationFactor } from '../inflation/inflation-math';
import { canonicalDecimalToAtoms, formatAtoms, formatPercent, formatSignedProduct } from './money';
import { convertAmount, type PortfolioAccountInput } from './portfolio-valuation';

// INFL-REAL-PF: what the held lots cost in today's money. Each lot is carried to today by the
// inflation since the Moscow day it was acquired, so the real profit is the value less that.

const ATOM_SCALE = 10n ** 30n;
const VALUE_SCALE = 10n ** 60n;
const FACTOR_SCALE = 10n ** 10n;

export interface RealReading {
  /** What the held lots cost, each grown by the inflation since its day. */
  costBasis: string;
  /** Value less `costBasis`; null without a price. */
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  /** Some factor reaches past the latest published month or rests on the owner's own rate. */
  estimated: boolean;
}

/** A value as the scale-60 product `projectPortfolio` writes it. */
const valueAtoms = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * VALUE_SCALE + BigInt(fraction.padEnd(60, '0'));
};

const reading = (cost: bigint, value: bigint | null, estimated: boolean): RealReading => {
  const result = value === null ? null : value - cost * ATOM_SCALE;
  return {
    costBasis: formatAtoms(cost),
    unrealizedPnl: result === null ? null : formatSignedProduct(result),
    unrealizedReturnPercent:
      result === null || cost <= 0n ? null : formatPercent(result, cost * ATOM_SCALE),
    estimated,
  };
};

/**
 * The real cost and real profit of each held asset and of all of them together. An asset is
 * null when one of its lots has no cost, no rate or no factor (a partial sum would read as a
 * smaller cost and a larger profit); the total is null when any held asset is.
 */
export function realReadings(
  assets: readonly { instrumentId: string; value: string | null }[],
  accounts: readonly PortfolioAccountInput[],
  fx: FxConverter,
  factorOf: (day: string) => InflationFactor | null,
) {
  const costs = new Map<string, { cost: bigint; estimated: boolean } | null>();
  for (const account of accounts)
    for (const lot of account.lots) {
      if (canonicalDecimalToAtoms(lot.quantity) === 0n) continue;
      const entry = costs.get(lot.instrumentId);
      if (entry === null) continue;
      const base =
        lot.costUsd === null ? null : convertAmount(fx, lot.costUsd, lot.acquiredAt, lot.native);
      const factor = base === null ? null : factorOf(moscowDate(lot.acquiredAt));
      if (base === null || factor === null) {
        costs.set(lot.instrumentId, null);
        continue;
      }
      const grown = (base * BigInt(Math.round(factor.factor * 1e10))) / FACTOR_SCALE;
      costs.set(lot.instrumentId, {
        cost: (entry?.cost ?? 0n) + grown,
        estimated: (entry?.estimated ?? false) || factor.estimated,
      });
    }
  const byAsset = new Map<string, RealReading | null>();
  let total: { cost: bigint; value: bigint | null; estimated: boolean } | null = {
    cost: 0n,
    value: 0n,
    estimated: false,
  };
  for (const asset of assets) {
    if (!costs.has(asset.instrumentId)) continue;
    const entry = costs.get(asset.instrumentId) ?? null;
    if (entry === null) {
      byAsset.set(asset.instrumentId, null);
      total = null;
      continue;
    }
    const value = asset.value === null ? null : valueAtoms(asset.value);
    byAsset.set(asset.instrumentId, reading(entry.cost, value, entry.estimated));
    if (total !== null)
      total = {
        cost: total.cost + entry.cost,
        value: total.value === null || value === null ? null : total.value + value,
        estimated: total.estimated || entry.estimated,
      };
  }
  return {
    byAsset,
    total:
      total === null || byAsset.size === 0
        ? null
        : reading(total.cost, total.value, total.estimated),
  };
}
