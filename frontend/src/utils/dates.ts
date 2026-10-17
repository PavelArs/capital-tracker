/**
 * Calendar dates, "Oct 2, 2026", are days the server counts by and read in UTC, so a date like
 * "2026-10-02" stays that day. Moments (when something happened, loaded, synced or changed) show
 * in the browser's own zone, with no zone named: "14:05", "Oct 2, 14:05", "Oct 2, 2026, 14:05".
 */
const day = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayClock = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const moment = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
// en-CA writes YYYY-MM-DD.
const localDay = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const utcClock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

type When = string | number | Date;

/** Oct 2, 2026 */
export const dayText = (when: When) => day.format(new Date(when));
/** 14:05, local */
export const clockText = (when: When) => clock.format(new Date(when));
/** Oct 2, 14:05, local */
export const dayClockText = (when: When) => dayClock.format(new Date(when));
/** Oct 2, 2026, 14:05, local */
export const momentText = (when: When) => moment.format(new Date(when));
/** The local calendar date of an instant, YYYY-MM-DD. */
export const localDate = (when: When) => localDay.format(new Date(when));
/** 14:05 in UTC: transactions are entered and listed by UTC time. */
export const utcClockText = (when: When) => utcClock.format(new Date(when));

/** The Moscow calendar date of an instant, YYYY-MM-DD (UTC+3 all year): the day the server counts by. */
export const moscowDate = (instant: When) =>
  new Date(new Date(instant).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
