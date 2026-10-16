// GOAL-FORECAST: closed-form projections for a savings goal. Contributions are added on the same
// day of every month, the first one a month from today, and grow at the effective yearly return.
// Figures are plain numbers because a projection is an estimate; stored money enters only through
// estimateOf, and what the goal already has is computed exactly elsewhere (goal-view.ts).

/** Days in an average month, to turn a number of days into months. */
export const DAYS_PER_MONTH = 365.25 / 12;
/** The longest horizon searched for the month a target is reached, in months. */
export const MAX_MONTHS = 1200;
/** Percentage points the pessimistic and optimistic cases move away from the base return. */
export const SCENARIO_SPREAD = 4;

/** The plain number a projection starts from: an estimate of a decimal amount, never a result. */
export const estimateOf = (amount: string) => Number(amount);

export type ScenarioKey = 'pessimistic' | 'base' | 'optimistic';

export const scenarioReturns = (base: number): Record<ScenarioKey, number> => ({
  pessimistic: Math.max(base - SCENARIO_SPREAD, 0),
  base,
  optimistic: base + SCENARIO_SPREAD,
});

/** The monthly growth rate that compounds to the effective yearly return. */
export const monthlyRate = (yearlyPercent: number) => (1 + yearlyPercent / 100) ** (1 / 12) - 1;

/**
 * The value after `months` of growth with `contribution` added on each of the first `payments`
 * monthly anniversaries of today; the part of a month after the last payment only grows.
 */
export function futureValue(
  current: number,
  contribution: number,
  rate: number,
  months: number,
  payments = Math.floor(months),
) {
  return current * (1 + rate) ** months + contribution * paymentsGrowth(rate, months, payments);
}

/** What one unit paid on each of `payments` monthly anniversaries is worth after `months`. */
function paymentsGrowth(rate: number, months: number, payments: number) {
  if (payments <= 0) return 0;
  if (rate === 0) return payments;
  return ((1 + rate) ** (months - payments) * ((1 + rate) ** payments - 1)) / rate;
}

/**
 * The monthly contribution that reaches the target in `months`, zero when growth is enough, and
 * infinite when it is not and no whole month is left to pay in.
 */
export function requiredContribution(
  current: number,
  target: number,
  rate: number,
  months: number,
  payments = Math.floor(months),
) {
  const missing = target - current * (1 + rate) ** months;
  if (missing <= 0) return 0;
  const growth = paymentsGrowth(rate, months, payments);
  return growth > 0 ? missing / growth : Number.POSITIVE_INFINITY;
}

/**
 * Months until the target is reached, 0 when it already is, null when it is not reached within
 * MAX_MONTHS (for example without contributions at zero return).
 */
export function monthsToReach(current: number, target: number, contribution: number, rate: number) {
  if (current >= target) return 0;
  let months: number;
  if (rate === 0) {
    if (contribution <= 0) return null;
    months = (target - current) / contribution;
  } else {
    const floor = current * rate + contribution;
    if (floor <= 0) return null;
    const ratio = (target * rate + contribution) / floor;
    months = Math.log(ratio) / Math.log(1 + rate);
  }
  if (!Number.isFinite(months) || months > MAX_MONTHS) return null;
  // A target reached exactly on a payment can come out a hair above the whole number through
  // floating-point noise and round up to the next month: settle a near-whole answer by checking
  // the plan itself, to a tenth of a cent.
  const whole = Math.round(months);
  if (
    whole > 0 &&
    months > whole &&
    months - whole < 1e-6 &&
    futureValue(current, contribution, rate, whole, whole) >= target - 1e-3
  )
    return whole;
  return months;
}

/** The ISO day `months` whole months after `date`, a short month taking the last day. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const last = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const text = (value: number, width: number) => String(value).padStart(width, '0');
  return `${text(targetYear, 4)}-${text(targetMonth + 1, 2)}-${text(Math.min(day, last), 2)}`;
}

/** The monthly anniversaries of one ISO day that fall on or before a later one. */
export function paymentsBetween(from: string, to: string) {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const months = toYear * 12 + toMonth - (fromYear * 12 + fromMonth);
  if (months <= 0) return 0;
  return addMonths(from, months) <= to ? months : months - 1;
}

const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/**
 * Months from one ISO day to a later one, fractional; zero or less when it has passed. Every
 * monthly anniversary counts as exactly one month, whatever its length in days, so a payment
 * on the deadline has aged zero months; only the days after the last anniversary are prorated.
 */
export function monthsBetween(from: string, to: string) {
  const payments = paymentsBetween(from, to);
  const rest = daysBetween(addMonths(from, payments), to) / DAYS_PER_MONTH;
  return payments + (payments > 0 ? Math.min(rest, 1) : rest);
}
