import {
  addMonths,
  futureValue,
  monthlyRate,
  monthsBetween,
  monthsToReach,
  paymentsBetween,
  requiredContribution,
  scenarioReturns,
} from './goal-forecast';

describe('goal forecast', () => {
  it('compounds to the yearly return over twelve months', () => {
    expect((1 + monthlyRate(8)) ** 12).toBeCloseTo(1.08, 10);
    expect(monthlyRate(0)).toBe(0);
  });

  it('grows the start and the contributions', () => {
    const rate = monthlyRate(12);
    expect(futureValue(1000, 0, rate, 12)).toBeCloseTo(1120, 8);
    expect(futureValue(1000, 100, 0, 6)).toBe(1600);
    // 100 a month for a year at 12% a year ends at about 1,264 (ordinary annuity).
    expect(futureValue(0, 100, rate, 12)).toBeCloseTo(1264.65, 1);
  });

  it('finds the contribution that reaches the target, and zero when growth is enough', () => {
    const rate = monthlyRate(8);
    const needed = requiredContribution(10_000, 20_000, rate, 36);
    expect(futureValue(10_000, needed, rate, 36)).toBeCloseTo(20_000, 6);
    expect(requiredContribution(10_000, 20_000, 0, 10)).toBe(1000);
    expect(requiredContribution(10_000, 11_000, monthlyRate(50), 24)).toBe(0);
    // With no month left to pay in, only growth can help.
    expect(requiredContribution(10_000, 30_000, rate, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('finds the months to the target', () => {
    const rate = monthlyRate(8);
    const months = monthsToReach(10_000, 20_000, 300, rate) as number;
    // Payments fall on whole months: the target is first met at the month after this one.
    expect(futureValue(10_000, 300, rate, Math.ceil(months))).toBeGreaterThanOrEqual(20_000);
    expect(futureValue(10_000, 300, rate, Math.ceil(months) - 1)).toBeLessThan(20_000);
    expect(monthsToReach(10_000, 20_000, 500, 0)).toBe(20);
    expect(monthsToReach(25_000, 20_000, 0, rate)).toBe(0);
    expect(monthsToReach(10_000, 20_000, 0, 0)).toBeNull();
    // Growth alone reaches it in about nine years at 8%.
    expect(monthsToReach(10_000, 20_000, 0, rate) as number).toBeCloseTo(108.2, 0);
    // A target beyond one hundred years is not promised.
    expect(monthsToReach(1, 1e12, 0, monthlyRate(1))).toBeNull();
  });

  it('moves the pessimistic and optimistic cases around the base, never below zero', () => {
    expect(scenarioReturns(8)).toEqual({ pessimistic: 4, base: 8, optimistic: 12 });
    expect(scenarioReturns(2)).toEqual({ pessimistic: 0, base: 2, optimistic: 6 });
  });

  it('adds whole months, a short month taking its last day', () => {
    expect(addMonths('2026-10-13', 3)).toBe('2027-01-13');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonths('2026-10-13', 0)).toBe('2026-10-13');
  });

  it('counts the months to a day', () => {
    expect(monthsBetween('2026-01-01', '2027-01-01')).toBeCloseTo(12, 1);
    expect(monthsBetween('2026-10-13', '2026-10-12')).toBeLessThan(0);
  });

  it('pays only at whole month ends, growth alone covering the rest of a month', () => {
    const rate = monthlyRate(12);
    // One day left: no payment can happen, so the plan adds nothing to the projection.
    const days = 1 / 30.4375;
    expect(futureValue(1000, 3100, rate, days, 0)).toBeCloseTo(1000 * (1 + rate) ** days, 10);
    expect(requiredContribution(0, 100, rate, days, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(requiredContribution(1000, 1000, rate, days, 0)).toBe(0);
    // Two and a half months: two payments, the second one growing for half a month.
    const m = 2.5;
    const expected = 1000 * (1 + rate) ** m + 100 * ((1 + rate) ** 1.5 + (1 + rate) ** 0.5);
    expect(futureValue(1000, 100, rate, m, 2)).toBeCloseTo(expected, 8);
    const needed = requiredContribution(1000, 5000, rate, m, 2);
    expect(futureValue(1000, needed, rate, m, 2)).toBeCloseTo(5000, 6);
    expect(futureValue(0, 100, 0, 2.5, 2)).toBe(200);
  });

  it('counts the month ends before a day', () => {
    expect(paymentsBetween('2026-10-13', '2026-10-14')).toBe(0);
    expect(paymentsBetween('2026-10-13', '2026-11-12')).toBe(0);
    expect(paymentsBetween('2026-10-13', '2026-11-13')).toBe(1);
    expect(paymentsBetween('2026-10-13', '2027-10-13')).toBe(12);
    expect(paymentsBetween('2026-01-31', '2026-03-30')).toBe(1);
    expect(paymentsBetween('2026-01-31', '2026-03-31')).toBe(2);
    expect(paymentsBetween('2026-10-13', '2026-10-13')).toBe(0);
  });
});
