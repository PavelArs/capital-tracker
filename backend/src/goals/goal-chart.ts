import {
  addMonths,
  futureValue,
  monthlyRate,
  monthsBetween,
  monthsToReach,
  paymentsBetween,
  type ScenarioKey,
  scenarioReturns,
} from './goal-forecast';
import { centsText, type GoalRow, type PortfolioNow } from './goal-view';

/** Without a deadline the chart runs a year past the month the base case gets there. */
const AFTER_REACHED = 12;
/** The shortest horizon of a goal without a deadline, in months. */
const MIN_HORIZON = 24;
/** Without a deadline and never reached by the base case, the chart stops after 50 years. */
const NEVER_HORIZON = 600;
/** The most points a chart gets; a longer horizon keeps every n-th month. */
const MAX_POINTS = 240;

export type GoalForecastPoint = { on: string } & Record<ScenarioKey, string | null>;

/**
 * GOAL-CHART: the three return cases month by month from today, with the same formulas, rates
 * and payment days as the goal's forecast, so the last point of a goal with a deadline is its
 * projection at the deadline. Empty while the portfolio has no complete value in the goal's
 * currency or once the deadline has passed.
 */
export function goalForecast(row: GoalRow, now: PortfolioNow, today: string) {
  const empty = {
    currency: row.currency,
    asOf: today,
    complete: now.complete,
    points: [] as GoalForecastPoint[],
  };
  // A value that leaves out an asset without a price or rate would understate every point.
  if (now.value === null || !now.complete) return empty;
  const current = Number(now.value);
  const target = Number(row.targetAmount);
  const plan = row.monthlyContribution === null ? 0 : Number(row.monthlyContribution);
  const returns = scenarioReturns(Number(row.expectedReturnPercent));
  const rates = Object.entries(returns).map(
    ([key, yearly]) => [key as ScenarioKey, monthlyRate(yearly)] as const,
  );

  let anniversaries: number;
  let end: { on: string; months: number; payments: number } | null = null;
  if (row.deadline !== null) {
    const months = monthsBetween(today, row.deadline);
    if (months <= 0) return empty;
    const payments = paymentsBetween(today, row.deadline);
    anniversaries = payments;
    // A deadline between two payment days closes the chart with its own point.
    if (addMonths(today, payments) < row.deadline) end = { on: row.deadline, months, payments };
  } else {
    const left = monthsToReach(current, target, plan, monthlyRate(returns.base));
    anniversaries =
      left === null
        ? NEVER_HORIZON
        : Math.max(MIN_HORIZON, Math.min(Math.ceil(left) + AFTER_REACHED, NEVER_HORIZON));
  }

  const step = Math.max(1, Math.ceil(anniversaries / MAX_POINTS));
  const months = Array.from({ length: Math.floor(anniversaries / step) + 1 }, (_, i) => i * step);
  if (months.at(-1) !== anniversaries) months.push(anniversaries);
  const point = (on: string, elapsed: number, payments: number) =>
    Object.fromEntries([
      ['on', on],
      ...rates.map(([key, rate]) => [
        key,
        centsText(Math.round(futureValue(current, plan, rate, elapsed, payments) * 100)),
      ]),
    ]) as GoalForecastPoint;
  const points = months.map((month) => point(addMonths(today, month), month, month));
  if (end) points.push(point(end.on, end.months, end.payments));
  return { ...empty, points };
}
