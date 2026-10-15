import { goalForecast } from './goal-chart';
import { addMonths } from './goal-forecast';
import { type GoalRow, goalView } from './goal-view';

const row: GoalRow = {
  id: 'goal-1',
  name: 'Reserve',
  currency: 'USD',
  targetAmount: '20000.00',
  deadline: '2029-10-13',
  expectedReturnPercent: '8',
  monthlyContribution: '300.00',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const today = '2026-10-13';
const now = (value: string | null, complete = true) => ({ value, complete });

describe('GOAL-CHART goal forecast', () => {
  it('starts at the portfolio now and steps a month at a time to the deadline', () => {
    const { points, currency, asOf } = goalForecast(row, now('5000.00'), today);
    expect(currency).toBe('USD');
    expect(asOf).toBe(today);
    expect(points).toHaveLength(37);
    expect(points[0]).toEqual({
      on: today,
      pessimistic: '5000.00',
      base: '5000.00',
      optimistic: '5000.00',
    });
    expect(points.map((point) => point.on).slice(0, 3)).toEqual([
      '2026-10-13',
      '2026-11-13',
      '2026-12-13',
    ]);
    expect(points.at(-1)?.on).toBe('2029-10-13');
    for (const point of points.slice(1)) {
      expect(Number(point.pessimistic)).toBeLessThan(Number(point.base));
      expect(Number(point.base)).toBeLessThan(Number(point.optimistic));
    }
  });

  it('ends on the projection the goal shows for its deadline, in every case', () => {
    const view = goalView(row, now('5000.00'), today);
    const last = goalForecast(row, now('5000.00'), today).points.at(-1);
    for (const scenario of view.scenarios)
      expect(last?.[scenario.key]).toBe(scenario.projectedAtDeadline);
  });

  it('closes with the deadline itself when it falls between two payment days', () => {
    const between = { ...row, deadline: '2027-01-28' };
    const { points } = goalForecast(between, now('5000.00'), today);
    expect(points.map((point) => point.on)).toEqual([
      '2026-10-13',
      '2026-11-13',
      '2026-12-13',
      '2027-01-13',
      '2027-01-28',
    ]);
    const view = goalView(between, now('5000.00'), today);
    expect(points.at(-1)?.base).toBe(view.scenarios[1].projectedAtDeadline);
  });

  it('draws today and the deadline alone when no payment day comes before it', () => {
    const soon = { ...row, deadline: '2026-10-28' };
    const { points } = goalForecast(soon, now('5000.00'), today);
    expect(points.map((point) => point.on)).toEqual(['2026-10-13', '2026-10-28']);
    expect(points.at(-1)?.base).toBe(
      goalView(soon, now('5000.00'), today).scenarios[1].projectedAtDeadline,
    );
  });

  it('runs a year past the month the base case gets there when there is no deadline', () => {
    const open = { ...row, deadline: null };
    const view = goalView(open, now('5000.00'), today);
    const months = view.scenarios[1].monthsToTarget as number;
    const { points } = goalForecast(open, now('5000.00'), today);
    expect(points.at(-1)?.on).toBe(addMonths(today, months + 12));
    const reached = points.find((point) => Number(point.base) >= 20000);
    expect(reached?.on).toBe(view.scenarios[1].reachedOn);
  });

  it('shows two years for a goal already reached and fifty for one never reached', () => {
    const reached = goalForecast({ ...row, deadline: null }, now('25000.00'), today);
    expect(reached.points.at(-1)?.on).toBe(addMonths(today, 24));
    const never = goalForecast(
      { ...row, deadline: null, monthlyContribution: null, expectedReturnPercent: '0' },
      now('5000.00'),
      today,
    );
    expect(never.points.at(-1)?.on).toBe(addMonths(today, 600));
    expect(never.points.at(-1)?.base).toBe('5000.00');
  });

  it('keeps every n-th month on a long horizon, at most 241 points', () => {
    const far = { ...row, deadline: '2076-10-13' };
    const { points } = goalForecast(far, now('5000.00'), today);
    expect(points.length).toBeLessThanOrEqual(241);
    expect(points[1].on).toBe(addMonths(today, 3));
    expect(points.at(-1)?.on).toBe('2076-10-13');
    const view = goalView(far, now('5000.00'), today);
    expect(points.at(-1)?.base).toBe(view.scenarios[1].projectedAtDeadline);
  });

  it('writes every figure as a plain decimal, also past 1e21', () => {
    const steep = { ...row, deadline: '2056-10-13', expectedReturnPercent: '999.9' };
    const { points } = goalForecast(steep, now('10000.00'), today);
    expect(Number(points.at(-1)?.optimistic)).toBeGreaterThan(1e21);
    for (const point of points)
      for (const key of ['pessimistic', 'base', 'optimistic'] as const)
        expect(point[key]).toMatch(/^\d+\.\d{2}$/);
  });

  it('has no points without a value in the currency or once the deadline has passed', () => {
    expect(goalForecast(row, now(null, false), today).points).toEqual([]);
    expect(goalForecast({ ...row, deadline: today }, now('5000.00'), today).points).toEqual([]);
    expect(goalForecast({ ...row, deadline: '2026-01-01' }, now('5000.00'), today).points).toEqual(
      [],
    );
  });
});
