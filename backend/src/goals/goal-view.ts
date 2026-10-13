import {
  addMonths,
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
}

const cents = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
/** Cents rounded up, for an amount that has to reach a target; a float's noise is not a cent. */
const centsUp = (value: number) => (Math.ceil(value * 100 - 1e-6) / 100).toFixed(2);
/** Cents of a projected figure, or null when the maths left the range of a number. */
const required = (value: number) => (Number.isFinite(value) ? centsUp(value) : null);
const figure = (value: number) => (Number.isFinite(value) ? cents(value) : null);
const percent = (value: number) => value.toFixed(4).replace(/\.?0+$/, '');

/** One goal with its progress and the three return cases (GOAL-FORECAST). */
export function goalView(row: GoalRow, now: PortfolioNow, today: string) {
  const target = Number(row.targetAmount);
  const current = now.value === null ? null : Number(now.value);
  const plan = row.monthlyContribution === null ? 0 : Number(row.monthlyContribution);
  const months = row.deadline === null ? null : monthsBetween(today, row.deadline);
  const payments = row.deadline === null ? 0 : paymentsBetween(today, row.deadline);
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
          };
        });
  const base = scenarios.find((scenario) => scenario.key === 'base');
  let status: GoalStatus;
  if (current === null) status = 'unknown';
  else if (current >= target) status = 'reached';
  else if (months === null) status = 'open';
  else if (months <= 0) status = 'overdue';
  else status = Number(base?.gap) <= 0 ? 'on-track' : 'behind';
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
      current: current === null ? null : cents(current),
      complete: now.complete,
      percent: current === null ? null : cents(Math.min((current / target) * 100, 100)),
      remaining: current === null ? null : cents(Math.max(target - current, 0)),
    },
    status,
    scenarios,
  };
}
