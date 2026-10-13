import type { Goal, GoalCurrency, GoalScenario, GoalStatus } from '@api/goals.api';
import type { BadgeTone } from '@/ui/Badge';
import { dayText } from '@/utils/dates';
import { currencySymbols, DASH } from '../portfolio/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 1, 2026" from a calendar date, the way the rest of the app writes dates. */
export const dateText = (date: string): string => dayText(`${date}T00:00:00Z`);

/** "Oct 2026" from a calendar date. */
export function monthYear(date: string): string {
  const [year, month] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Whole months from one calendar date's month to another's. */
const monthsFrom = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

/** "3 years 2 months", "1 year", "5 months". */
export function span(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years > 0 ? `${years} ${years === 1 ? 'year' : 'years'}` : '',
    rest > 0 ? `${rest} ${rest === 1 ? 'month' : 'months'}` : '',
  ].filter(Boolean);
  return parts.join(' ') || 'under a month';
}

/** An exact decimal string as whole cents, without a floating-point number in between. */
function toCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return 0n;
  const cents = BigInt(match[2] + (match[3] ?? '').padEnd(2, '0').slice(0, 2));
  return match[1] ? -cents : cents;
}

/**
 * A sum in whole units, grouped by thousands: $22,000,000 or ₽150,000. Goals are round sums, so
 * cents are left out (rounded half up); the prototype writes them this way.
 */
export function wholeMoney(value: string | null, currency: GoalCurrency): string {
  if (value === null) return DASH;
  const cents = toCents(value);
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = (abs + 50n) / 100n;
  const grouped = units.toString().replace(/\B(?=(\d{3})+$)/g, ',');
  return `${negative && units > 0n ? '-' : ''}${currencySymbols[currency]}${grouped}`;
}

/** The difference of two decimal strings, as a decimal string with two decimals. */
export function difference(larger: string, smaller: string): string {
  const cents = toCents(larger) - toCents(smaller);
  const negative = cents < 0n;
  const text = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${text.slice(0, -2)}.${text.slice(-2)}`;
}

const isPositive = (value: string | null): value is string => value !== null && toCents(value) > 0n;

/** A yearly return without trailing zeros: "8", "7.5". */
export function rateText(percent: string): string {
  return percent.includes('.') ? percent.replace(/0+$/, '').replace(/\.$/, '') : percent;
}

export const statusTone: Record<GoalStatus, BadgeTone> = {
  reached: 'pos',
  'on-track': 'pos',
  behind: 'warn',
  overdue: 'neg',
  open: 'info',
  unknown: 'muted',
};

export const statusText: Record<GoalStatus, string> = {
  reached: 'Reached',
  'on-track': 'On track',
  behind: 'Behind',
  overdue: 'Overdue',
  open: 'No date',
  unknown: 'Not known',
};

export const scenarioText: Record<GoalScenario['key'], string> = {
  pessimistic: 'Pessimistic',
  base: 'Base',
  optimistic: 'Optimistic',
};

/** The sentence under a goal: where it stands and what it takes, from the base case. */
export function verdict(goal: Goal): string {
  const money = (value: string | null) => wholeMoney(value, goal.currency);
  const base = goal.scenarios.find((scenario) => scenario.key === 'base');
  const planned = isPositive(goal.monthlyContribution) ? goal.monthlyContribution : null;
  const { current, remaining } = goal.progress;
  switch (goal.status) {
    case 'reached': {
      const above = current === null ? null : difference(current, goal.targetAmount);
      return isPositive(above)
        ? `Reached. Your net worth is ${money(above)} above it.`
        : 'Reached.';
    }
    case 'unknown':
      return current === null
        ? 'Nothing in this currency could be valued yet, so the progress is not known.'
        : 'Some assets have no price or rate, so the value is understated and the plan cannot be judged yet.';
    case 'on-track': {
      if (planned !== null && base?.reachedOn) {
        const early = goal.deadline ? monthsFrom(base.reachedOn, goal.deadline) : 0;
        return `On track. ${money(planned)} a month gets there by ${monthYear(base.reachedOn)}${
          early > 0 ? `, ${span(early)} early` : ''
        }.`;
      }
      return `On track. The portfolio grows to the sum by ${
        goal.deadline ? monthYear(goal.deadline) : 'then'
      } without further contributions.`;
    }
    case 'behind': {
      const needs = base?.requiredMonthly ?? null;
      if (needs === null || goal.deadline === null)
        return 'Behind. No monthly payment is left before the date.';
      const short = difference(needs, goal.monthlyContribution ?? '0');
      const head = planned !== null ? `Behind by ${money(short)} a month. ` : 'Behind. ';
      const tail =
        planned === null
          ? ''
          : base?.reachedOn
            ? `; at ${money(planned)} it takes until ${monthYear(base.reachedOn)}`
            : `; at ${money(planned)} it is not reached in 100 years`;
      return `${head}Reaching it by ${monthYear(goal.deadline)} needs ${money(needs)} a month${tail}.`;
    }
    case 'overdue': {
      const date = goal.deadline ? `The date, ${dateText(goal.deadline)}, has passed. ` : '';
      const left = `${money(remaining)} to go.`;
      const later =
        planned !== null && base?.reachedOn
          ? ` At ${money(planned)} a month you get there in ${monthYear(base.reachedOn)}.`
          : '';
      return `${date}${left}${later}`;
    }
    case 'open': {
      if (base?.reachedOn && base.monthsToTarget !== null) {
        const when = `${monthYear(base.reachedOn)}, in ${span(base.monthsToTarget)}`;
        return planned !== null
          ? `At ${money(planned)} a month you get there in ${when}.`
          : `The portfolio alone gets there in ${when}.`;
      }
      return 'At this pace it takes more than 100 years. Put in more each month or expect a higher return.';
    }
  }
}

/** Open goals first, by date (none last), then the reached ones. */
export function ordered(goals: readonly Goal[]): Goal[] {
  const rank = (goal: Goal) => (goal.status === 'reached' ? 1 : 0);
  return [...goals].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
      a.name.localeCompare(b.name),
  );
}

const MOSCOW_OFFSET_MS = 3 * 3_600_000;

/** Today's calendar date in Moscow, the day the server counts a goal's deadline by. */
export const today = () => new Date(Date.now() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
