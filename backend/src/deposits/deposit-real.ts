import { canonicalDecimalToAtoms } from '../accounting/money';
import {
  type InflationFactor,
  type InflationSeries,
  officialFactor,
  personalFactor,
} from '../inflation/inflation-math';
import type { StatedFlow } from '../portfolio-snapshots/capital-flows';
import { realProfit } from '../portfolio-snapshots/real-profit';
import { valueAtoms } from '../portfolio-snapshots/snapshot-series';
import {
  centsText,
  type DepositMovement,
  type DepositTerms,
  type InterestPeriod,
} from './deposit-interest';

// INFL-DEPOSIT: what a deposit earns after inflation, in its own currency. The money put in is
// carried to the day by the same inflation factors as the portfolio's real profit (INFL-REAL),
// so a deposit and the Dashboard never disagree about what a year of inflation costs.

const ATOM_SCALE = 10n ** 30n;
const FACTOR_STEP = 10n ** 10n;

/** One way of reading inflation: the factor between two days and the yearly figure. */
export interface InflationReading {
  factor: (from: string, to: string) => InflationFactor | null;
  /** Inflation over the year ending on a day in percent; null when the figures do not reach. */
  yearPercent: (day: string) => number | null;
  /** Own-rate reading only: false when the currency has no own rate and this is the official one. */
  ownRate?: boolean;
}

export interface InflationReadings {
  official: InflationReading;
  personal: InflationReading;
}

/** The same day a year earlier (29 February goes to the 28th). */
const yearBefore = (day: string) => {
  const rest = day.slice(4);
  return `${Number(day.slice(0, 4)) - 1}${rest === '-02-29' ? '-02-28' : rest}`;
};

/** The two readings of a currency; with no own rate set, the own-rate one is the official one. */
export function inflationReadings(
  series: InflationSeries,
  ownRate: string | null,
): InflationReadings {
  const official: InflationReading = {
    factor: (from, to) => officialFactor(series, from, to),
    // The year ending on the day asked: a past view never reads months published after it.
    yearPercent: (day) => {
      const year = officialFactor(series, yearBefore(day), day);
      return year === null ? null : (year.factor - 1) * 100;
    },
  };
  if (ownRate === null) return { official, personal: { ...official, ownRate: false } };
  const annual = Number(ownRate);
  return {
    official,
    personal: {
      factor: (from, to) => personalFactor(annual, from, to),
      yearPercent: () => annual,
      ownRate: true,
    },
  };
}

export interface DepositReal {
  /** Inflation over a year in percent, two places; null when the series is too short. */
  inflationPercent: string | null;
  /** The deposit's yearly rate after that inflation, in percent; null unless it is active. */
  ratePercent: string | null;
  /** What it has earned, less the inflation on all the money put in; null without a factor. */
  gain: string | null;
  /** A factor reaches past the latest published month or rests on the owner's own rate. */
  estimated: boolean;
  ownRate?: boolean;
}

const COMPOUNDING_PER_YEAR = { daily: 365, monthly: 12, quarterly: 4, 'at-end': 1 } as const;

/** The yearly rate in percent once interest that joins the deposit earns interest itself. */
export function effectiveRatePercent(
  ratePercent: string,
  terms: Pick<DepositTerms, 'capitalized' | 'payout'>,
): number {
  const rate = Number(ratePercent);
  if (!terms.capitalized) return rate;
  const times = COMPOUNDING_PER_YEAR[terms.payout];
  return ((1 + rate / 100 / times) ** times - 1) * 100;
}

/** A scale-60 amount as cents (the money is exact to the cent; only the factor is a ratio). */
const centsOfProduct = (text: string) => centsText(valueAtoms(text) / ATOM_SCALE);

export interface RealDepositInput {
  /** What the deposit is worth on the day, in its currency. */
  balance: string;
  active: boolean;
  ratePercent: string;
  terms: Pick<DepositTerms, 'capitalized' | 'payout'>;
  /** Everything recorded up to the day. */
  movements: readonly DepositMovement[];
  asOf: string;
}

/** The deposit after inflation by one reading, or all nulls where the series does not reach. */
export function depositReal(input: RealDepositInput, reading: InflationReading): DepositReal {
  // Money into the deposit is money put in; a withdrawal or paid-out interest is money taken out.
  const flows: StatedFlow[] = input.movements.map((movement) => ({
    at: Date.parse(`${movement.date}T00:00:00Z`),
    rateDate: movement.date,
    amount:
      (movement.kind === 'topup' ? 1n : -1n) *
      canonicalDecimalToAtoms(movement.amount) *
      ATOM_SCALE,
  }));
  const profit = realProfit(input.balance, false, flows, (day) => reading.factor(day, input.asOf));
  const inflation = reading.yearPercent(input.asOf);
  const rate =
    input.active && inflation !== null
      ? ((1 + effectiveRatePercent(input.ratePercent, input.terms) / 100) / (1 + inflation / 100) -
          1) *
        100
      : null;
  return {
    inflationPercent: inflation === null ? null : inflation.toFixed(2),
    ratePercent: rate === null ? null : rate.toFixed(2),
    gain: profit?.profit == null ? null : centsOfProduct(profit.profit),
    estimated: profit?.estimated ?? false,
    ...(reading.ownRate === undefined ? {} : { ownRate: reading.ownRate }),
  };
}

/**
 * The interest of each period less what inflation took from the money held at its start. A
 * movement inside a period counts from the next one.
 */
export function periodsAfterInflation(
  periods: readonly InterestPeriod[],
  balances: ReadonlyMap<string, bigint>,
  reading: InflationReading,
): (string | null)[] {
  return periods.map((period) => {
    const factor = reading.factor(period.from, period.to);
    const held = balances.get(period.from);
    if (factor === null || held === undefined) return null;
    const lost = (held * (BigInt(Math.round(factor.factor * 1e10)) - FACTOR_STEP)) / FACTOR_STEP;
    return centsText(canonicalDecimalToAtoms(period.interest) - lost);
  });
}
