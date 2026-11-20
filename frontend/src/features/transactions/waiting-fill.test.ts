import { describe, expect, it } from 'vitest';
import { minuteBefore } from './waiting-fill';

// BYBIT-P2P: the purchase a waiting Bybit buy paid with is dated a minute before it, in UTC as
// the Add transaction window takes it. Synthetic instants only.
describe('BYBIT-P2P minuteBefore', () => {
  it.each([
    ['inside a minute', '2026-11-20T18:05:37.000Z', '2026-11-20', '18:04'],
    ['on the minute', '2026-11-20T18:05:00.000Z', '2026-11-20', '18:04'],
    // 21:00 UTC is midnight in Moscow: the purchase stays on the Moscow day before the trade.
    ['at Moscow midnight', '2026-11-30T21:00:10.000Z', '2026-11-30', '20:59'],
    ['across a month end in UTC', '2026-12-01T00:00:20.000Z', '2026-11-30', '23:59'],
    ['across a year end', '2027-01-01T00:00:00.000Z', '2026-12-31', '23:59'],
  ])('BYBIT-P2P %s', (_case, at, date, time) => {
    const before = minuteBefore(at);
    expect(before).toEqual({ date, time });
    expect(Date.parse(`${before.date}T${before.time}:00.000Z`)).toBeLessThan(Date.parse(at));
  });
});
