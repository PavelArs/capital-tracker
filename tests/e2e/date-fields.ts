import { type Locator, type Page, expect } from '@playwright/test';

type Scope = Page | Locator;

/** Native date (YYYY-MM-DD) and UTC time values shown for an instant; midnight has no time. */
export function momentParts(instant: string): { date: string; time: string } {
  const iso = new Date(instant).toISOString();
  const time = iso.slice(11, 23);
  return {
    date: iso.slice(0, 10),
    time:
      time === '00:00:00.000'
        ? ''
        : time.endsWith(':00.000')
          ? time.slice(0, 5)
          : time.endsWith('.000')
            ? time.slice(0, 8)
            : time,
  };
}

/** Enters an instant through a calendar date field and its optional UTC time field. */
export async function fillMoment(
  scope: Scope,
  dateLabel: string,
  timeLabel: string,
  instant: string,
): Promise<void> {
  const { date, time } = momentParts(instant);
  await scope.getByLabel(dateLabel, { exact: true }).fill(date);
  await scope.getByLabel(timeLabel, { exact: true }).fill(time);
}

/** Asserts the date and UTC time fields show exactly this instant. */
export async function expectMoment(
  scope: Scope,
  dateLabel: string,
  timeLabel: string,
  instant: string,
): Promise<void> {
  const { date, time } = momentParts(instant);
  await expect(scope.getByLabel(dateLabel, { exact: true })).toHaveValue(date);
  await expect(scope.getByLabel(timeLabel, { exact: true })).toHaveValue(time);
}
