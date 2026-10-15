import { buildSeries, officialFactor, personalFactor } from '../inflation/inflation-math';
import type { StatedFlow } from './capital-flows';
import { personalReading, realProfit } from './real-profit';

const SCALE = 10n ** 60n;
const flow = (iso: string, amount: number | null): StatedFlow => ({
  at: Date.parse(iso),
  amount: amount === null ? null : BigInt(amount) * SCALE,
});
const TO = '2026-03-01';

describe('real profit (INFL-REAL)', () => {
  // One percent a month from 2025-01 to 2026-02, so a day's level is known up to Feb 2026.
  const changes = new Map<string, number>();
  for (let month = 0; month < 14; month++) {
    const year = 2025 + Math.floor(month / 12);
    changes.set(`${year}-${String((month % 12) + 1).padStart(2, '0')}`, 1);
  }
  const series = buildSeries(changes);
  const official = (day: string) => officialFactor(series, day, TO);

  it('INFL-REAL-OFFICIAL grows each deposit by the inflation since its day and takes it from the value', () => {
    const flows = [flow('2025-03-15T00:00:00.000Z', 1000), flow('2025-09-15T00:00:00.000Z', 500)];
    const result = realProfit('1700', false, flows, official);
    // 1000 over 12 months and 500 over 6 months of 1% a month, plus the estimated 15 days to March.
    expect(result).not.toBeNull();
    const march = Number(official('2025-03-15')?.factor);
    const september = Number(official('2025-09-15')?.factor);
    const invested = 1000 * march + 500 * september;
    expect(Number(result?.invested)).toBeCloseTo(invested, 6);
    expect(Number(result?.profit)).toBeCloseTo(1700 - invested, 6);
    expect(Number(result?.profitPercent)).toBeCloseTo(((1700 - invested) / invested) * 100, 1);
    expect(result?.estimated).toBe(true);
  });

  it('INFL-REAL-WITHDRAWAL lowers the money put in at its own factor', () => {
    const flows = [flow('2025-03-15T00:00:00.000Z', 1000), flow('2025-09-15T00:00:00.000Z', -400)];
    const result = realProfit('700', false, flows, official);
    const invested =
      1000 * Number(official('2025-03-15')?.factor) - 400 * Number(official('2025-09-15')?.factor);
    expect(Number(result?.invested)).toBeCloseTo(invested, 6);
  });

  it('INFL-REAL-PERSONAL carries money forward at the owner own yearly rate', () => {
    const flows = [flow('2025-03-01T00:00:00.000Z', 1000)];
    const result = realProfit('1100', false, flows, (day) => personalFactor(10, day, TO));
    // 365 days at 10% a year.
    expect(Number(result?.invested)).toBeCloseTo(1100, 6);
    expect(Number(result?.profit)).toBeCloseTo(0, 6);
  });

  it('INFL-REAL-UNKNOWN is unknown when one deposit has no inflation factor', () => {
    const before = [flow('2008-01-15T00:00:00.000Z', 100), flow('2025-03-15T00:00:00.000Z', 100)];
    expect(realProfit('300', false, before, official)).toBeNull();
    expect(realProfit(null, false, [flow('2025-03-15T00:00:00.000Z', 100)], official)).toBeNull();
  });

  it('INVESTED-RATED leaves money without a Bank of Russia rate out of the money put in', () => {
    const flows = [flow('2025-03-15T00:00:00.000Z', 100), flow('2025-04-15T00:00:00.000Z', null)];
    const result = realProfit('300', false, flows, official);
    const invested = 100 * Number(official('2025-03-15')?.factor);
    expect(Number(result?.invested)).toBeCloseTo(invested, 6);
    expect(Number(result?.profit)).toBeCloseTo(300 - invested, 6);
  });

  it('INFL-REAL-MOSCOW-DAY dates each flow by its Moscow calendar day, like its rate', () => {
    const days: string[] = [];
    const seen = (day: string) => {
      days.push(day);
      return { factor: 1, estimated: false };
    };
    // 22:30 UTC is already the next day in Moscow, midnight Moscow is the evening before in UTC.
    realProfit('10', false, [flow('2025-03-14T22:30:00.000Z', 1)], seen);
    realProfit('10', false, [flow('2025-03-14T21:00:00.000Z', 1)], seen);
    realProfit('10', false, [flow('2025-03-14T20:59:59.000Z', 1)], seen);
    expect(days).toEqual(['2025-03-15', '2025-03-15', '2025-03-14']);
  });

  it('INFL-REAL-CARRY-IN carries a holding from its acquisition day, not from the journal start', () => {
    const days: string[] = [];
    const seen = (day: string) => {
      days.push(day);
      return { factor: 1, estimated: false };
    };
    const carried: StatedFlow = {
      ...flow('2026-09-10T00:00:00.000Z', 100),
      rateDate: '2025-03-03',
    };
    realProfit('10', false, [carried], seen);
    expect(days).toEqual(['2025-03-03']);
  });

  it('INFL-REAL-EMPTY says nothing was put in rather than a profit of the whole value', () => {
    const result = realProfit('300', false, [], official);
    expect(result).toEqual({ invested: '0', profit: '300', profitPercent: null, estimated: false });
  });

  it('INFL-REAL-UNPRICED gives no profit when no held asset is priced at all', () => {
    const result = realProfit('0', true, [flow('2025-03-15T00:00:00.000Z', 100)], official);
    expect(result?.profit).toBeNull();
  });

  it('INFL-REAL-FOLLOW-OFFICIAL reads the official figure for a currency with no own rate', () => {
    const official = { invested: '100', profit: '5', profitPercent: '5', estimated: false };
    const own = { invested: '110', profit: '-5', profitPercent: '-4.5', estimated: true };
    const unused = jest.fn(() => own);
    expect(personalReading(official, unused, false)).toEqual({ ...official, ownRate: false });
    expect(unused).not.toHaveBeenCalled();
    expect(personalReading(official, () => own, true)).toEqual({ ...own, ownRate: true });
    // Without an official figure the data itself is missing: nothing to follow.
    expect(personalReading(null, unused, false)).toBeNull();
    expect(personalReading(official, () => null, true)).toBeNull();
  });
});
