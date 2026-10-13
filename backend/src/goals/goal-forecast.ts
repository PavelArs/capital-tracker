// GOAL-FORECAST: closed-form projections for a savings goal. Contributions are added at the end
// of every month and grow at the effective yearly return. Figures are plain numbers because a
// projection is an estimate; stored money never passes through here.

/** Days in an average month, to turn a number of days into months. */
export const DAYS_PER_MONTH = 365.25 / 12;
/** The longest horizon searched for the month a target is reached, in months. */
export const MAX_MONTHS = 1200;
/** Percentage points the pessimistic and optimistic cases move away from the base return. */
export const SCENARIO_SPREAD = 4;

export type ScenarioKey = 'pessimistic' | 'base' | 'optimistic';

export const scenarioReturns = (base: number): Record<ScenarioKey, number> => ({
  pessimistic: Math.max(base - SCENARIO_SPREAD, 0),
  base,
  optimistic: base + SCENARIO_SPREAD,
});

/** The monthly growth rate that compounds to the effective yearly return. */
export const monthlyRate = (yearlyPercent: number) => (1 + yearlyPercent / 100) ** (1 / 12) - 1;

/** The value after `months` of growth with `contribution` added every month. */
export function futureValue(current: number, contribution: number, rate: number, months: number) {
  if (rate === 0) return current + contribution * months;
  const growth = (1 + rate) ** months;
  return current * growth + (contribution * (growth - 1)) / rate;
}

/** The monthly contribution that reaches the target in `months`; zero when growth is enough. */
export function requiredContribution(
  current: number,
  target: number,
  rate: number,
  months: number,
) {
  if (months <= 0) return Math.max(target - current, 0);
  const growth = (1 + rate) ** months;
  const missing = target - current * growth;
  if (missing <= 0) return 0;
  return rate === 0 ? missing / months : (missing * rate) / (growth - 1);
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
  return Number.isFinite(months) && months <= MAX_MONTHS ? months : null;
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

/** Months from one ISO day to a later one, fractional; zero or less when it has passed. */
export function monthsBetween(from: string, to: string) {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 / DAYS_PER_MONTH
  );
}
