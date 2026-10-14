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
  addMonths,
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

/** An exact amount carried by a factor, to the same scale; the factor is the only rounding. */
const carry = (atoms: bigint, factor: number) =>
  (atoms * BigInt(Math.round(factor * 1e10))) / FACTOR_STEP;

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

/** A figure in the money of a day asked: estimated where its inflation reaches past the published months. */
export interface TodaysMoney {
  amount: string;
  estimated: boolean;
}

export interface ChartValues {
  balance: string;
  invested: string;
  /** A factor used reaches past the latest published month or rests on the owner's own rate. */
  estimated: boolean;
}

export interface DepositChartPoint {
  date: string;
  /** What the deposit is worth on the day, in its currency. */
  balance: string;
  /** Money put in less taken out up to the day, in its currency. */
  invested: string;
  /** The two figures in the money of the day asked, by each reading; null where a factor is unknown. */
  real: { official: ChartValues | null; personal: ChartValues | null };
}

// Money put in is positive; a withdrawal or paid-out interest is money taken out, as in depositReal.
const signed = (movement: DepositMovement) =>
  (movement.kind === 'topup' ? 1n : -1n) * canonicalDecimalToAtoms(movement.amount);

/** The figures of one day in the money of the day asked, or null where the series does not reach. */
function realPoint(
  date: string,
  balance: bigint,
  flows: readonly DepositMovement[],
  asOf: string,
  reading: InflationReading,
): ChartValues | null {
  const held = reading.factor(date, asOf);
  if (held === null) return null;
  let invested = 0n;
  let estimated = held.estimated;
  for (const flow of flows) {
    const factor = reading.factor(flow.date, asOf);
    if (factor === null) return null;
    invested += carry(signed(flow), factor.factor);
    estimated = estimated || factor.estimated;
  }
  return {
    balance: centsText(carry(balance, held.factor)),
    invested: centsText(invested),
    estimated,
  };
}

const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * The days a chart samples: each month from the start, every movement day, the day before each
 * movement (so its jump is drawn on the day, not as a slope from the last month) and the day asked.
 * In order and without repeats, none after the day asked, none before the start.
 */
export function chartDates(
  start: string,
  asOf: string,
  movementDates: readonly string[],
): string[] {
  const dates = new Set<string>([asOf]);
  for (let months = 0; ; months++) {
    const date = addMonths(start, months);
    if (date > asOf) break;
    dates.add(date);
  }
  for (const date of movementDates) {
    if (date > asOf) continue;
    dates.add(date);
    if (dayBefore(date) >= start) dates.add(dayBefore(date));
  }
  return [...dates].sort();
}

/**
 * The deposit day by day at the dates given: its value and the money put in, nominal and in the
 * money of `asOf` by each reading. Money put in is carried from its own day to `asOf`, the same
 * factors as the gain above (INFL-DEPOSIT-CHART).
 */
export function depositChart(
  dates: readonly string[],
  balances: ReadonlyMap<string, bigint>,
  movements: readonly DepositMovement[],
  asOf: string,
  readings: InflationReadings,
): DepositChartPoint[] {
  return dates.map((date) => {
    const balance = balances.get(date) ?? 0n;
    const flows = movements.filter((movement) => movement.date <= date);
    const invested = flows.reduce((sum, flow) => sum + signed(flow), 0n);
    return {
      date,
      balance: centsText(balance),
      invested: centsText(invested),
      real: {
        official: realPoint(date, balance, flows, asOf, readings.official),
        personal: realPoint(date, balance, flows, asOf, readings.personal),
      },
    };
  });
}

/**
 * A balance on the end date in the money of `asOf`: the inflation between the two days takes
 * part of it. Null by a reading where the day asked is after the end (no span to carry).
 */
export function inTodaysMoney(
  balance: string,
  asOf: string,
  end: string,
  readings: InflationReadings,
): { official: TodaysMoney | null; personal: TodaysMoney | null } {
  const atoms = canonicalDecimalToAtoms(balance);
  const at = (reading: InflationReading): TodaysMoney | null => {
    const factor = reading.factor(asOf, end);
    return factor === null
      ? null
      : { amount: centsText(carry(atoms, 1 / factor.factor)), estimated: factor.estimated };
  };
  return { official: at(readings.official), personal: at(readings.personal) };
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
