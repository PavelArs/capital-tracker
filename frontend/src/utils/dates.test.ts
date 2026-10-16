import { describe, expect, it } from 'vitest';
import { moscowDate } from './dates';

describe('moscowDate', () => {
  it('settings-07 gives the Moscow calendar day, which starts at 21:00 UTC the day before', () => {
    expect(moscowDate(new Date('2026-10-31T20:59:59Z'))).toBe('2026-10-31');
    expect(moscowDate(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01');
    expect(moscowDate('2026-12-31T23:30:00Z')).toBe('2027-01-01');
  });
});
