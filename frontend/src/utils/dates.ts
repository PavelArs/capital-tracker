/** Dates and times the way the prototype writes them, in UTC as stored: "Oct 2, 2026", "14:05". */
const day = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});
const dayClock = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

type When = string | number | Date;

/** Oct 2, 2026 */
export const dayText = (when: When) => day.format(new Date(when));
/** 14:05 */
export const clockText = (when: When) => clock.format(new Date(when));
/** Oct 2, 14:05 */
export const dayClockText = (when: When) => dayClock.format(new Date(when));

/** The Moscow calendar date of an instant, YYYY-MM-DD: the day the server counts by. */
export const moscowDate = (instant: When) =>
  new Date(new Date(instant).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
