import { formatSignedProduct } from '../accounting/money';
import { moscowDate } from '../fx-rates/fx-conversion';
import type { InflationFactor } from '../inflation/inflation-math';
import { profitToDate, type StatedFlow } from './capital-flows';

// INFL-REAL: profit after inflation. Money put in is carried to today by the inflation since
// the day it came in, so a deposit of a year ago has to earn that year's inflation just to
// break even. Real profit is the value today less all the money put in, in today's money.
// A day is the Moscow calendar day, as for the rate of each flow.

const FACTOR_SCALE = 10n ** 10n;

export interface RealProfit {
  /** All money put in less taken out, each amount carried to today by inflation. */
  invested: string;
  /** Value less `invested`; null when no held asset is priced. */
  profit: string | null;
  /** Share of `invested`; null when it is not above zero. */
  profitPercent: string | null;
  /** Some factor reaches past the latest published month or rests on the owner's own rate. */
  estimated: boolean;
}

/**
 * Real profit to date for the flows up to now, or null when the value, a flow's amount or a
 * flow's factor is unknown: a partial sum would read as a smaller cost and a larger profit.
 */
export function realProfit(
  value: string | null,
  unpriced: boolean,
  flows: readonly StatedFlow[],
  factorOf: (day: string) => InflationFactor | null,
): RealProfit | null {
  if (value === null) return null;
  let invested = 0n;
  let estimated = false;
  for (const flow of flows) {
    if (flow.amount === null) return null;
    const factor = factorOf(moscowDate(new Date(flow.at)));
    if (factor === null) return null;
    estimated ||= factor.estimated;
    invested += (flow.amount * BigInt(Math.round(factor.factor * 1e10))) / FACTOR_SCALE;
  }
  const text = formatSignedProduct(invested);
  return { invested: text, ...profitToDate(value, text, unpriced), estimated };
}
