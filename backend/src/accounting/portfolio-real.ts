import { type FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import type { InflationFactor } from '../inflation/inflation-math';
import { personalReading } from '../portfolio-snapshots/real-profit';
import {
  canonicalDecimalToAtoms,
  formatAtoms,
  formatPercent,
  formatProduct,
  formatSignedProduct,
} from './money';
import {
  convertAmount,
  lotCostIn,
  type PortfolioAccountInput,
  type PortfolioLot,
} from './portfolio-valuation';

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
 * What one lot cost in the report currency at its day's rate, less what a capital return took
 * off at its own day's; null without a cost or a rate.
 */
const paidOf = (lot: PortfolioLot, fx: FxConverter) => lotCostIn(fx, lot);

/**
 * What one lot cost, carried to today by the inflation since its day. Null when the lot has no
 * cost, no rate or no factor.
 */
function grownCost(
  lot: PortfolioLot,
  fx: FxConverter,
  factorOf: (day: string) => InflationFactor | null,
): { cost: bigint; percent: string; estimated: boolean } | null {
  if (lot.costUsd === null) return null;
  const factor = factorOf(moscowDate(lot.acquiredAt));
  if (factor === null) return null;
  const scale = (value: InflationFactor) => BigInt(Math.round(value.factor * 1e10));
  const scaled = scale(factor);
  // What came back by a capital return is carried from its own day, not from the purchase day:
  // the money was not tied up after it came in.
  let gross = canonicalDecimalToAtoms(lot.costUsd);
  for (const part of lot.returned ?? []) gross += canonicalDecimalToAtoms(part.costUsd);
  const bought = convertAmount(fx, formatAtoms(gross), lot.acquiredAt, lot.native);
  if (bought === null) return null;
  let cost = (bought * scaled) / FACTOR_SCALE;
  let estimated = factor.estimated;
  for (const part of lot.returned ?? []) {
    const returned = convertAmount(fx, part.costUsd, part.at, part.native);
    const back = factorOf(moscowDate(part.at));
    if (returned === null || back === null) return null;
    cost -= (returned * scale(back)) / FACTOR_SCALE;
    estimated = estimated || back.estimated;
  }
  return {
    cost,
    percent: formatPercent(scaled - FACTOR_SCALE, FACTOR_SCALE),
    estimated,
  };
}

/**
 * The real cost and real profit of each held asset and of all of them together. An asset is
 * null when one of its lots has no cost, no rate or no factor (a partial sum would read as a
 * smaller cost and a larger profit); the total is null when any held asset is, and when the
 * portfolio is not `complete` (an account before its coverage hides holdings, so the nominal
 * cost and profit are unknown too).
 */
export function realReadings(
  assets: readonly { instrumentId: string; value: string | null }[],
  accounts: readonly PortfolioAccountInput[],
  fx: FxConverter,
  factorOf: (day: string) => InflationFactor | null,
  complete = true,
) {
  const costs = new Map<string, { cost: bigint; estimated: boolean } | null>();
  for (const account of accounts)
    for (const lot of account.lots) {
      if (canonicalDecimalToAtoms(lot.quantity) === 0n) continue;
      const entry = costs.get(lot.instrumentId);
      if (entry === null) continue;
      const grown = grownCost(lot, fx, factorOf);
      if (grown === null) {
        costs.set(lot.instrumentId, null);
        continue;
      }
      costs.set(lot.instrumentId, {
        cost: (entry?.cost ?? 0n) + grown.cost,
        estimated: (entry?.estimated ?? false) || grown.estimated,
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
      total === null || byAsset.size === 0 || !complete
        ? null
        : reading(total.cost, total.value, total.estimated),
  };
}

/** One purchase (a FIFO lot still held) read on its own. */
export interface LotAfterInflation {
  accountId: string;
  accountName: string;
  acquiredAt: string;
  quantity: string;
  /** What it cost at its day's rate; null without a cost or a rate. */
  paid: string | null;
  /** The lot's quantity at today's price; null without a price. */
  value: string | null;
  nominalPnl: string | null;
  real: {
    official: LotReading | null;
    personal: (LotReading & { ownRate: boolean }) | null;
  };
}
/** A lot's `RealReading`, with the inflation since its day in percent. */
export interface LotReading extends RealReading {
  inflationPercent: string;
}

/**
 * INFL-REAL-LOTS: each held lot of one asset, newest first, with what it cost in today's money
 * and the profit over it. A lot with no cost, no rate or no factor is unread on its own; the
 * others still read. A currency with no own rate follows the official one (`ownRate: false`).
 */
export function lotsAfterInflation(input: {
  instrumentId: string;
  accounts: readonly PortfolioAccountInput[];
  fx: FxConverter;
  /** One unit's price in the report currency; null without a price. */
  price: string | null;
  official: (day: string) => InflationFactor | null;
  personal: ((day: string) => InflationFactor | null) | null;
}): LotAfterInflation[] {
  const { instrumentId, accounts, fx, price } = input;
  const unit = price === null ? null : canonicalDecimalToAtoms(price);
  const rows: LotAfterInflation[] = [];
  for (const account of accounts)
    for (const lot of account.lots) {
      // Only purchases are listed: a reward or a received coin has no price paid to show.
      if (lot.instrumentId !== instrumentId || lot.purchase !== true) continue;
      const quantity = canonicalDecimalToAtoms(lot.quantity);
      if (quantity === 0n) continue;
      const value = unit === null ? null : quantity * unit;
      const read = (factorOf: (day: string) => InflationFactor | null) => {
        const grown = grownCost(lot, fx, factorOf);
        return grown === null
          ? null
          : { inflationPercent: grown.percent, ...reading(grown.cost, value, grown.estimated) };
      };
      const official = read(input.official);
      const paid = paidOf(lot, fx);
      rows.push({
        accountId: account.accountId,
        accountName: account.name,
        acquiredAt: lot.acquiredAt,
        quantity: lot.quantity,
        paid: paid === null ? null : formatAtoms(paid),
        value: value === null ? null : formatProduct(value),
        nominalPnl:
          value === null || paid === null ? null : formatSignedProduct(value - paid * ATOM_SCALE),
        real: {
          official,
          personal: personalReading(
            official,
            () => (input.personal === null ? null : read(input.personal)),
            input.personal !== null,
          ),
        },
      });
    }
  return rows.sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
}
