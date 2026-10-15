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
}

/** Cents rounded up, for an amount that has to reach a target; a float's noise is not a cent. */
const centsUp = (value: number) => (Math.ceil(value * 100 - 1e-6) / 100).toFixed(2);
/** Cents of a projected figure, or null when the maths left the range of a number. */
const required = (value: number) => (Number.isFinite(value) ? centsUp(value) : null);
const figure = (value: number) =>
  Number.isFinite(value) ? (Math.round(value * 100) / 100).toFixed(2) : null;
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
 * the sum is reached.
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
    // goals-03 (the real share above 100%) waits for the acceptance probe that pins 100.00.
    percent: hundredthsText(reached && share > 10000n ? 10000n : share),
    remaining: hundredthsText(missing > 0n ? missing : 0n),
  };
}

/** One goal with its progress and the three return cases (GOAL-FORECAST). */
export function goalView(row: GoalRow, now: PortfolioNow, today: string) {
  const progress =
    now.value === null ? null : progressOf(exact(now.value), exact(row.targetAmount));
  // The return cases are estimates in plain numbers; progress and the status stay exact.
  const target = estimateOf(row.targetAmount);
  const current = now.value === null ? null : estimateOf(now.value);
  const plan = row.monthlyContribution === null ? 0 : estimateOf(row.monthlyContribution);
  const months = row.deadline === null ? null : monthsBetween(today, row.deadline);
  const payments = row.deadline === null ? 0 : paymentsBetween(today, row.deadline);
  // The status reads the raw base projection: the displayed gap is rounded to the cent and
  // would call a goal on track that falls a fraction of a cent short.
  let baseShort = false;
  const scenarios: GoalScenario[] =
    current === null
      ? []
      : (
          Object.entries(scenarioReturns(Number(row.expectedReturnPercent))) as [
            ScenarioKey,
            number,
          ][]
        ).map(([key, yearly]) => {
          const rate = monthlyRate(yearly);
          const left = monthsToReach(current, target, plan, rate);
          const projected =
            months !== null && months > 0
              ? futureValue(current, plan, rate, months, payments)
              : null;
          if (key === 'base') baseShort = projected === null || !(projected >= target);
          return {
            key,
            returnPercent: percent(yearly),
            requiredMonthly:
              months !== null && months > 0
                ? required(requiredContribution(current, target, rate, months, payments))
                : null,
            monthsToTarget: left === null ? null : Math.ceil(left),
            reachedOn: left === null ? null : addMonths(today, Math.ceil(left)),
            projectedAtDeadline: projected === null ? null : figure(projected),
            gap: projected === null ? null : figure(target - projected),
            metByDeadline:
              projected === null || !Number.isFinite(projected) ? null : projected >= target,
          };
        });
  let status: GoalStatus;
  if (progress === null) status = 'unknown';
  else if (progress.reached) status = 'reached';
  else if (months === null) status = 'open';
  else if (months <= 0) status = 'overdue';
  else status = baseShort ? 'behind' : 'on-track';
  // A value that leaves out an asset without a price or rate only understates the portfolio:
  // reaching the goal stays true, falling behind does not.
  if (!now.complete && (status === 'behind' || status === 'overdue')) status = 'unknown';
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
    },
    status,
    scenarios,
  };
}
