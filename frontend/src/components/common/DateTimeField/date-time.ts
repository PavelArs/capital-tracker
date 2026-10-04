// Calendar date plus optional UTC time, exchanged as the canonical UTC instant
// string the backend already accepts (YYYY-MM-DDTHH:mm:ss.sssZ).

const canonical = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const timeInput = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

export const MIDNIGHT = '00:00:00.000';

function normalize(value: string): string {
  if (canonical.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

/** Date part (YYYY-MM-DD) for a native date input, or '' when there is none. */
export function datePart(value: string): string {
  return canonical.exec(normalize(value))?.[1] ?? '';
}

/** Full UTC time of day (HH:mm:ss.sss), or '' when there is no date. */
export function utcTimeOfDay(value: string): string {
  const match = canonical.exec(normalize(value));
  return match ? `${match[2]}:${match[3]}:${match[4]}.${match[5]}` : '';
}

/** Shortest native time input value; midnight (the date-only default) is empty. */
export function timePart(value: string): string {
  const time = utcTimeOfDay(value);
  if (!time || time === MIDNIGHT) return '';
  if (time.endsWith(':00.000')) return time.slice(0, 5);
  if (time.endsWith('.000')) return time.slice(0, 8);
  return time;
}

/** Native time input step that keeps the shown precision valid. */
export function timeStep(time: string): number | undefined {
  if (time.length > 8) return 0.001;
  if (time.length > 5) return 1;
  return undefined;
}

/** Native time input value (HH:mm[:ss[.s]]) to HH:mm:ss.sss; '' is midnight. */
export function fullTime(time: string): string {
  const match = timeInput.exec(time);
  if (!match) return MIDNIGHT;
  const [, hours, minutes, seconds = '00', fraction = ''] = match;
  return `${hours}:${minutes}:${seconds}.${fraction.padEnd(3, '0')}`;
}

/** Combine a date input value and a full UTC time of day into the instant. */
export function combine(date: string, time: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T${time || MIDNIGHT}Z` : '';
}

/** Today's UTC date at 00:00 UTC, optionally shifted by whole days. */
export function utcDay(offsetDays = 0, now = new Date()): string {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
  return day.toISOString();
}

/** dd.mm.yyyy, plus the UTC time when it is not midnight. */
export function formatUtcMoment(value: string): string {
  const date = datePart(value);
  if (!date) return value;
  const [year, month, day] = date.split('-');
  const time = timePart(value);
  return `${day}.${month}.${year}${time ? ` ${time} UTC` : ''}`;
}
