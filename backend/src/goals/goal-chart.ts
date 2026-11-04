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
import {
  expected,
  type GoalRow,
  type PortfolioNow,
  realReturnPercent,
  type YearlyInflation,
} from './goal-view';

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
 * projection at the deadline. Empty while the portfolio has no priced value in the goal's
 * currency or once the deadline has passed. Says how many held prices are stale, as the value did.
 * With the yearly inflation it carries the same cases in today's money too (GOAL-REAL), one
 * reading per basis, each running as far as its own base case needs.
 */
export function goalForecast(
  row: GoalRow,
  now: PortfolioNow,
  today: string,
  inflation?: YearlyInflation,
) {
  const nominal = scenarioReturns(Number(row.expectedReturnPercent));
  const reading = (rate: number | null | undefined): GoalForecastPoint[] | null => {
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= -100) return null;
    return pointsOf(
      row,
      now,
      today,
      Object.fromEntries(
        Object.entries(nominal).map(([key, yearly]) => [key, realReturnPercent(yearly, rate)]),
      ) as Record<ScenarioKey, number>,
    );
  };
  return {
    currency: row.currency,
    asOf: today,
    complete: now.complete,
    // The forecast's own valuation: the page's goal read may have seen other prices.
    stalePrices: now.stalePrices,
    points: pointsOf(row, now, today, nominal),
    real: { official: reading(inflation?.official), personal: reading(inflation?.personal) },
  };
}

function pointsOf(
  row: GoalRow,
  now: PortfolioNow,
  today: string,
  returns: Record<ScenarioKey, number>,
): GoalForecastPoint[] {
  // Forecast the priced subset; completeness still identifies the excluded value.
  if (now.value === null) return [];
  const current = Number(now.value);
  const target = Number(row.targetAmount);
  const plan = row.monthlyContribution === null ? 0 : Number(row.monthlyContribution);
  const rates = Object.entries(returns).map(
    ([key, yearly]) => [key as ScenarioKey, monthlyRate(yearly)] as const,
  );

  let anniversaries: number;
  let end: { on: string; months: number; payments: number } | null = null;
  if (row.deadline !== null) {
    const months = monthsBetween(today, row.deadline);
    if (months <= 0) return [];
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
        expected(futureValue(current, plan, rate, elapsed, payments)),
      ]),
    ]) as GoalForecastPoint;
  const points = months.map((month) => point(addMonths(today, month), month, month));
  if (end) points.push(point(end.on, end.months, end.payments));
  return points;
}
