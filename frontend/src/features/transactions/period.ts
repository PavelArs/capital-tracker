import type { OperationRange } from '@api/operations.api';

/** OPS-PERIOD: the period of the Transactions list, UTC days (YYYY-MM-DD) in the address. */
export const calendarDay = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(value: string | null): value is string {
  if (!value || !calendarDay.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The period named by ?from= and ?to=; a day that is no date, or an end before the start, is ignored. */
export function periodOf(from: string | null, to: string | null): OperationRange | undefined {
  const start = isCalendarDay(from) ? from : undefined;
  const end = isCalendarDay(to) ? to : undefined;
  if (start && end && start > end) return undefined;
  if (!start && !end) return undefined;
  // One shape and key order, so the same period is the same cached read.
  return { ...(start && { from: start }), ...(end && { to: end }) };
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const shifted = (today: string, days: number) =>
  dayOf(new Date(Date.parse(`${today}T00:00:00.000Z`) - days * 86_400_000));

export const presets: { key: string; label: string; range: (today: string) => OperationRange }[] = [
  { key: '7d', label: 'Last 7 days', range: (today) => ({ from: shifted(today, 6) }) },
  { key: '30d', label: 'Last 30 days', range: (today) => ({ from: shifted(today, 29) }) },
  { key: 'month', label: 'This month', range: (today) => ({ from: `${today.slice(0, 7)}-01` }) },
  { key: '90d', label: 'Last 90 days', range: (today) => ({ from: shifted(today, 89) }) },
  { key: 'year', label: 'This year', range: (today) => ({ from: `${today.slice(0, 4)}-01-01` }) },
  {
    key: 'last-year',
    label: 'Last year',
    range: (today) => {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    },
  },
];

/** The preset a period is, if it is one. */
export function presetOf(period: OperationRange | undefined, today: string): string | undefined {
  if (!period) return undefined;
  return presets.find(({ range }) => {
    const wanted = range(today);
    return wanted.from === period.from && wanted.to === period.to;
  })?.key;
}
