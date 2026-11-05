import {
  addMonths,
  estimateOf,
  futureValue,
  monthlyRate,
  monthsBetween,
  monthsToReach,
  paymentsBetween,
  requiredContribution,
  type ScenarioKey,
  scenarioReturns,
} from './goal-forecast';
import type { GoalCurrency } from './goal-input';

export interface GoalRow {
  id: string;
  name: string;
  currency: GoalCurrency;
  targetAmount: string;
  deadline: string | null;
  expectedReturnPercent: string;
  monthlyContribution: string | null;
  createdAt: string;
}

/**
 * The portfolio's value in the goal's currency. Assets without a price or rate are left out of
 * it and make it incomplete; the value is null only when nothing could be valued.
 */
export interface PortfolioNow {
  value: string | null;
  complete: boolean;
  /** Held assets valued at a stored market price older than 2 hours (goals-35). */
  stalePrices: number;
}

export type GoalStatus = 'reached' | 'on-track' | 'behind' | 'overdue' | 'open' | 'unknown';

export interface GoalScenario {
  key: ScenarioKey;
  returnPercent: string;
  /** What to add every month to reach the target by the deadline; null without a deadline. */
  requiredMonthly: string | null;
  /** Months of the planned contribution until the target; null when it is never reached. */
  monthsToTarget: number | null;
  reachedOn: string | null;
  projectedAtDeadline: string | null;
  /** Target minus the projection at the deadline; negative is a surplus. */
  gap: string | null;
  /** Whether the unrounded projection reaches the target by the deadline; null without one. */
  metByDeadline: boolean | null;
  /** The value after ten years of the planned contribution; only for a goal without a date. */
  projectedIn10Years: string | null;
}

/**
 * A whole number of cents as a plain decimal string, also past 1e21 where `toFixed` turns to
 * exponent form; null when the maths left the range of a number.
 */
function centsText(hundredths: number): string | null {
  if (!Number.isFinite(hundredths)) return null;
  const atoms = BigInt(hundredths);
  const digits = (atoms < 0n ? -atoms : atoms).toString().padStart(3, '0');
  return `${atoms < 0n ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// A projection is an estimate in plain numbers, rounded never in the owner's favour: what is still
// needed (a contribution, a gap) up to the cent, what the plan is expected to have down. A float's
// noise is not a cent. Null when the maths left the range of a number.
const required = (value: number) =>
  Number.isFinite(value) ? centsText(Math.ceil(value * 100 - 1e-6)) : null;
export const expected = (value: number) =>
  Number.isFinite(value) ? centsText(Math.floor(value * 100 + 1e-6)) : null;
const percent = (value: number) => value.toFixed(4).replace(/\.?0+$/, '');

/** Signed decimal text of any scale, exactly: `units` parts of `unit`. */
interface Exact {
  units: bigint;
  unit: bigint;
}

function exact(value: string): Exact {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(`${whole}${fraction}`);
  return { units: negative ? -units : units, unit: 10n ** BigInt(fraction.length) };
}

/** numerator / denominator rounded toward minus infinity; the denominator is positive. */
function floorDiv(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n ? quotient - 1n : quotient;
}

/** Hundredths as fixed two-place text: cents of an amount, or a percent to two places. */
function hundredthsText(value: bigint) {
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${fraction}`;
}

/**
 * Progress in exact decimals, never better than it is: what the portfolio has is rounded down to
 * the cent, what is still missing up, and the share of the sum down, so it reads 100% only once
 * the sum is reached. Beyond the sum the share is the real one (goals-03): 147% is 147%.
 */
function progressOf(value: Exact, target: Exact) {
  // Both sides over one denominator: value / target = have / need.
  const have = value.units * target.unit;
  const need = target.units * value.unit;
  const denominator = value.unit * target.unit;
  const reached = have >= need;
  const share = floorDiv(have * 10000n, need);
  const missing = -floorDiv((have - need) * 100n, denominator);
  return {
    reached,
    current: hundredthsText(floorDiv(value.units * 100n, value.unit)),
    percent: hundredthsText(share),
    remaining: hundredthsText(missing > 0n ? missing : 0n),
  };
}

/**
 * What a yearly inflation figure rests on beyond the published months: months the owner typed in
 * and months estimated at the trend. An effective rate is not an official one (GOAL-REAL-FROM).
 */
export interface InflationFrom {
  ownMonths: boolean;
  estimated: boolean;
}

/** The projection in today's money: the returns count after inflation (GOAL-REAL). */
export interface GoalReal {
  /** The yearly inflation the returns were corrected by, in percent. */
  inflationPercent: string;
  /** What that figure rests on; the owner's own rate rests on nothing derived. */
  from: InflationFrom;
  /** The base case's return after that inflation, in percent; known even with no cases. */
  returnPercent: string;
  status: GoalStatus;
  scenarios: GoalScenario[];
}

/** Yearly inflation of the goal's currency in percent, per basis; null: no figure for that basis. */
export interface YearlyInflation {
  official: number | null;
  personal: number | null;
  /** What the official figure rests on; absent: published months alone. */
  officialFrom?: InflationFrom;
}

const PUBLISHED: InflationFrom = { ownMonths: false, estimated: false };

/** The yearly return of a case once the yearly inflation is taken off it, in percent. */
export const realReturnPercent = (yearly: number, inflation: number) =>
  ((1 + yearly / 100) / (1 + inflation / 100) - 1) * 100;

/** The progress in exact decimals, from the portfolio's value now. */
type Progress = ReturnType<typeof progressOf> | null;

/**
 * The status and the three return cases for yearly returns already chosen: nominal ones, or ones
 * corrected by inflation (the target and the contribution stay as entered either way).
 */
function projection(
  row: GoalRow,
  now: PortfolioNow,
  today: string,
  progress: Progress,
  returns: Record<ScenarioKey, number>,
) {
  // The return cases are estimates in plain numbers; progress and the status stay exact.
  const target = estimateOf(row.targetAmount);
  const current = now.value === null ? null : estimateOf(now.value);
  const plan = row.monthlyContribution === null ? 0 : estimateOf(row.monthlyContribution);
  const months = row.deadline === null ? null : monthsBetween(today, row.deadline);
  const payments = row.deadline === null ? 0 : paymentsBetween(today, row.deadline);
  // The deadline is a Moscow day and counts in full (goals-28): on that day the goal is still
  // open, judged on the value now with no payment left; it is overdue from the next day.
  const passed = row.deadline !== null && row.deadline < today;
  const horizon = months === null || passed ? null : Math.max(months, 0);
  // The status reads the raw base projection, not the gap shown to the cent.
  let baseShort = false;
  const scenarios: GoalScenario[] =
    current === null
      ? []
      : (Object.entries(returns) as [ScenarioKey, number][]).map(([key, yearly]) => {
          const rate = monthlyRate(yearly);
          const raw = monthsToReach(current, target, plan, rate);
          // A float can round a value just short of the sum up to it: until the exact progress
          // says reached, the sum is at least a month away, never this month.
          const left = raw === null || progress?.reached ? raw : Math.max(raw, 1);
          const projected =
            horizon === null ? null : futureValue(current, plan, rate, horizon, payments);
          const tenYears =
            row.deadline === null ? futureValue(current, plan, rate, 120, 120) : null;
          if (key === 'base') baseShort = projected === null || !(projected >= target);
          return {
            key,
            returnPercent: percent(yearly),
            requiredMonthly:
              horizon === null
                ? null
                : required(requiredContribution(current, target, rate, horizon, payments)),
            monthsToTarget: left === null ? null : Math.ceil(left),
            reachedOn: left === null ? null : addMonths(today, Math.ceil(left)),
            projectedAtDeadline: projected === null ? null : expected(projected),
            gap: projected === null ? null : required(target - projected),
            metByDeadline:
              projected === null || !Number.isFinite(projected) ? null : projected >= target,
            projectedIn10Years: tenYears === null ? null : expected(tenYears),
          };
        });
  let status: GoalStatus;
  if (progress === null) status = 'unknown';
  else if (progress.reached) status = 'reached';
  else if (months === null) status = 'open';
  else if (passed) status = 'overdue';
  else status = baseShort ? 'behind' : 'on-track';
  // A value that leaves out an asset without a price or rate only understates the portfolio:
  // reaching the goal stays true, falling behind does not.
  if (!now.complete && (status === 'behind' || status === 'overdue')) status = 'unknown';
  return { status, scenarios };
}

/**
 * One goal with its progress and the three return cases (GOAL-FORECAST). With the yearly
 * inflation of its currency it also carries the same cases in today's money (GOAL-REAL), one
 * reading per basis, as the other pages do: the target keeps its value, the contribution stays
 * as entered, and each nominal return is corrected by the inflation.
 */
export function goalView(
  row: GoalRow,
  now: PortfolioNow,
  today: string,
  inflation?: YearlyInflation,
) {
  const progress =
    now.value === null ? null : progressOf(exact(now.value), exact(row.targetAmount));
  const nominal = scenarioReturns(Number(row.expectedReturnPercent));
  const reading = (rate: number | null | undefined, from: InflationFrom): GoalReal | null => {
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= -100) return null;
    const returns = Object.fromEntries(
      Object.entries(nominal).map(([key, yearly]) => [key, realReturnPercent(yearly, rate)]),
    ) as Record<ScenarioKey, number>;
    return {
      inflationPercent: percent(rate),
      from,
      returnPercent: percent(returns.base),
      ...projection(row, now, today, progress, returns),
    };
  };
  const { status, scenarios } = projection(row, now, today, progress, nominal);
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    targetAmount: row.targetAmount,
    deadline: row.deadline,
    expectedReturnPercent: row.expectedReturnPercent,
    monthlyContribution: row.monthlyContribution,
    createdAt: row.createdAt,
    asOf: today,
    progress: {
      current: progress?.current ?? null,
      complete: now.complete,
      percent: progress?.percent ?? null,
      remaining: progress?.remaining ?? null,
      stalePrices: now.stalePrices,
    },
    status,
    scenarios,
    real: {
      official: reading(inflation?.official, inflation?.officialFrom ?? PUBLISHED),
      personal: reading(inflation?.personal, PUBLISHED),
    },
  };
}
