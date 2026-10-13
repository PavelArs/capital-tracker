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

describe('goal view', () => {
  it('reports progress against the target', () => {
    const view = goalView(row, now('5000.00'), today);
    expect(view.progress).toEqual({
      current: '5000.00',
      complete: true,
      percent: '25.00',
      remaining: '15000.00',
    });
  });

  it('computes the three cases, higher returns needing less', () => {
    const view = goalView(row, now('10000.00'), today);
    expect(view.scenarios.map((scenario) => scenario.key)).toEqual([
      'pessimistic',
      'base',
      'optimistic',
    ]);
    expect(view.scenarios.map((scenario) => scenario.returnPercent)).toEqual(['4', '8', '12']);
    const needed = view.scenarios.map((scenario) => Number(scenario.requiredMonthly));
    expect(needed[0]).toBeGreaterThan(needed[1]);
    expect(needed[1]).toBeGreaterThan(needed[2]);
    const months = view.scenarios.map((scenario) => scenario.monthsToTarget as number);
    expect(months[0]).toBeGreaterThan(months[1]);
    expect(months[1]).toBeGreaterThan(months[2]);
  });

  it('says on track when the plan reaches the target by the deadline, else behind', () => {
    const rich = goalView({ ...row, monthlyContribution: '1000.00' }, now('10000.00'), today);
    expect(rich.status).toBe('on-track');
    expect(Number(rich.scenarios[1].gap)).toBeLessThanOrEqual(0);
    const poor = goalView({ ...row, monthlyContribution: '10.00' }, now('10000.00'), today);
    expect(poor.status).toBe('behind');
    expect(Number(poor.scenarios[1].gap)).toBeGreaterThan(0);
  });

  it('shows the contribution a deadline needs, and the month the plan arrives without one', () => {
    const view = goalView(
      { ...row, monthlyContribution: null, deadline: '2027-10-13' },
      now('10000.00'),
      today,
    );
    expect(Number(view.scenarios[1].requiredMonthly)).toBeGreaterThan(700);
    expect(view.status).toBe('behind');
    const open = goalView({ ...row, deadline: null }, now('10000.00'), today);
    expect(open.status).toBe('open');
    expect(open.scenarios[1].requiredMonthly).toBeNull();
    expect(open.scenarios[1].projectedAtDeadline).toBeNull();
    expect(open.scenarios[1].reachedOn).toMatch(/^20\d\d-\d\d-13$/);
  });

  it('marks a reached goal and caps progress at one hundred percent', () => {
    const view = goalView(row, now('25000.00'), today);
    expect(view.status).toBe('reached');
    expect(view.progress.percent).toBe('100.00');
    expect(view.progress.remaining).toBe('0.00');
    expect(view.scenarios[1].requiredMonthly).toBe('0.00');
    expect(view.scenarios[1].monthsToTarget).toBe(0);
  });

  it('marks a deadline that has passed', () => {
    const view = goalView({ ...row, deadline: '2026-10-01' }, now('5000.00'), today);
    expect(view.status).toBe('overdue');
    expect(view.scenarios[1].requiredMonthly).toBeNull();
  });

  it('does not call a goal behind or overdue on a value that leaves assets out', () => {
    const poor = { ...row, monthlyContribution: '10.00' };
    expect(goalView(poor, now('10000.00'), today).status).toBe('behind');
    expect(goalView(poor, now('10000.00', false), today).status).toBe('unknown');
    expect(goalView({ ...row, deadline: '2026-10-01' }, now('1.00', false), today).status).toBe(
      'unknown',
    );
    const rich = { ...row, monthlyContribution: '1000.00' };
    expect(goalView(rich, now('10000.00', false), today).status).toBe('on-track');
    expect(goalView(row, now('25000.00', false), today).status).toBe('reached');
  });

  it('says unknown, with no cases, while the portfolio has no value in the currency', () => {
    const view = goalView(row, now(null, false), today);
    expect(view.status).toBe('unknown');
    expect(view.scenarios).toEqual([]);
    expect(view.progress).toMatchObject({ current: null, percent: null, complete: false });
  });

  it('keeps the incomplete flag and reports a goal that growth alone cannot reach', () => {
    const view = goalView(
      { ...row, monthlyContribution: null, expectedReturnPercent: '0', deadline: null },
      now('5000.00', false),
      today,
    );
    expect(view.progress.complete).toBe(false);
    expect(view.scenarios[0]).toMatchObject({ monthsToTarget: null, reachedOn: null });
  });

  it('never reports NaN when compounding leaves the range of a number', () => {
    const view = goalView(
      {
        ...row,
        deadline: '2999-12-31',
        expectedReturnPercent: '999.9',
        monthlyContribution: '0.00',
      },
      now('10000.00'),
      today,
    );
    for (const scenario of view.scenarios) {
      expect(scenario.projectedAtDeadline).toBeNull();
      expect(scenario.gap).toBeNull();
      expect(JSON.stringify(scenario)).not.toContain('NaN');
    }
  });

  it('does not count a contribution that cannot be paid before the deadline', () => {
    const view = goalView(
      {
        ...row,
        targetAmount: '100.00',
        deadline: '2026-10-14',
        monthlyContribution: '3100.00',
      },
      now('0.00'),
      today,
    );
    expect(view.status).toBe('behind');
    expect(view.scenarios[1].projectedAtDeadline).toBe('0.00');
    expect(view.scenarios[1].gap).toBe('100.00');
    expect(view.scenarios[1].requiredMonthly).toBeNull();
  });

  it('rounds the contribution a deadline needs up, so that it reaches the target', () => {
    const flat = { ...row, expectedReturnPercent: '0', targetAmount: '100.00' };
    // Three payments of 33.33 fall a cent short, so the plan has to say 33.34.
    const three = goalView({ ...flat, deadline: '2027-01-13' }, now('0.00'), today);
    expect(three.scenarios[1].requiredMonthly).toBe('33.34');
    // Four payments of exactly 25 need no extra cent.
    const four = goalView({ ...flat, deadline: '2027-02-13' }, now('0.00'), today);
    expect(four.scenarios[1].requiredMonthly).toBe('25.00');
  });
});
