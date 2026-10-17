import { describe, expect, it } from 'vitest';
import { clockText, dayClockText, localDate, momentText, moscowDate } from './dates';

describe('moscowDate', () => {
  it('settings-07 gives the Moscow calendar day, which starts at 21:00 UTC the day before', () => {
    expect(moscowDate(new Date('2026-10-31T20:59:59Z'))).toBe('2026-10-31');
    expect(moscowDate(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01');
    expect(moscowDate('2026-12-31T23:30:00Z')).toBe('2027-01-01');
  });
});

describe('moments in the local zone (the tests run at UTC+5)', () => {
  it('shows an instant in local time, without a zone, and dates it by the local day', () => {
    expect(clockText('2026-10-31T19:05:00Z')).toBe('00:05');
    expect(dayClockText('2026-10-31T19:05:00Z')).toBe('Nov 1, 00:05');
    expect(momentText('2026-12-31T19:05:00Z')).toBe('Jan 1, 2027, 00:05');
    expect(localDate('2026-10-31T18:59:00Z')).toBe('2026-10-31');
    expect(localDate('2026-10-31T19:00:00Z')).toBe('2026-11-01');
  });
});
