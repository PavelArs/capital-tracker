import { describe, expect, it } from 'vitest';
import { isCalendarDay, periodOf, presetOf, presets } from './period';

describe('OPS-PERIOD: the period of the list', () => {
  it('reads two real UTC days and ignores anything else', () => {
    expect(periodOf('2026-10-01', '2026-10-11')).toEqual({ from: '2026-10-01', to: '2026-10-11' });
    expect(periodOf('2026-10-01', null)).toEqual({ from: '2026-10-01' });
    expect(periodOf(null, '2026-10-11')).toEqual({ to: '2026-10-11' });
    expect(periodOf(null, null)).toBeUndefined();
    expect(periodOf('2026-02-30', 'soon')).toBeUndefined();
    // An end before the start names no days.
    expect(periodOf('2026-10-11', '2026-10-01')).toBeUndefined();
    expect(isCalendarDay('2024-02-29')).toBe(true);
    expect(isCalendarDay('2025-02-29')).toBe(false);
  });

  it('knows the presets from their days, counted back from today', () => {
    const today = '2026-10-11';
    const ranges = Object.fromEntries(presets.map(({ key, range }) => [key, range(today)]));
    expect(ranges).toEqual({
      '7d': { from: '2026-10-05' },
      '30d': { from: '2026-09-12' },
      month: { from: '2026-10-01' },
      '90d': { from: '2026-07-14' },
      year: { from: '2026-01-01' },
      'last-year': { from: '2025-01-01', to: '2025-12-31' },
    });
    expect(presetOf({ from: '2026-09-12' }, today)).toBe('30d');
    expect(presetOf({ from: '2026-09-13' }, today)).toBeUndefined();
    expect(presetOf(undefined, today)).toBeUndefined();
  });
});
