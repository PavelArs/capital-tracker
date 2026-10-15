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
    expect(rich.scenarios[1].metByDeadline).toBe(true);
    const poor = goalView({ ...row, monthlyContribution: '10.00' }, now('10000.00'), today);
    expect(poor.status).toBe('behind');
    expect(Number(poor.scenarios[1].gap)).toBeGreaterThan(0);
    expect(poor.scenarios[1].metByDeadline).toBe(false);
  });

  it('judges the status on the unrounded projection, not the gap shown to the cent', () => {
    const short = {
      ...row,
      targetAmount: '61.01',
      deadline: '2026-11-13',
      expectedReturnPercent: '0.1',
      monthlyContribution: null,
    };
    const view = goalView(short, now('61.00'), today);
    // About half a cent short: the gap rounds up to a cent, never to nothing.
    expect(view.scenarios[1].gap).toBe('0.01');
    expect(view.scenarios[1].metByDeadline).toBe(false);
    expect(view.status).toBe('behind');
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

  it('goals-26 rounds what the portfolio has down and what is still missing up, exactly', () => {
    const goal = { ...row, targetAmount: '50000.00', deadline: null };
    expect(goalView(goal, now('2623.5596707'), today).progress).toEqual({
      current: '2623.55',
      complete: true,
      percent: '5.24',
      remaining: '47376.45',
    });
    // A stored value with more places than a float keeps, as portfolio snapshots hold them.
    const long = goalView(
      { ...goal, targetAmount: '1000000.00' },
      now('148394.947838370992353293413173652694'),
      today,
    );
    expect(long.progress).toMatchObject({ current: '148394.94', remaining: '851605.06' });
    // Past the precision of a number, a fraction of a cent short is still short.
    const edge = goalView(
      { ...goal, targetAmount: '999999999999.99' },
      now('999999999999.985'),
      today,
    );
    expect(edge.status).toBe('open');
    expect(edge.progress).toMatchObject({
      current: '999999999999.98',
      percent: '99.99',
      remaining: '0.01',
    });
    // Exact sums stay as they are.
    expect(goalView({ ...goal, targetAmount: '10000' }, now('5000'), today).progress).toEqual({
      current: '5000.00',
      complete: true,
      percent: '50.00',
      remaining: '5000.00',
    });
    expect(goalView(goal, now('-12.345'), today).progress).toMatchObject({
      current: '-12.35',
      remaining: '50012.35',
    });
  });

  it('goals-27 never shows one hundred percent before the goal is reached', () => {
    const goal = { ...row, targetAmount: '100000.00', deadline: null };
    const close = goalView(goal, now('99995'), today);
    expect(close.status).toBe('open');
    expect(close.progress).toMatchObject({
      current: '99995.00',
      percent: '99.99',
      remaining: '5.00',
    });
    const closer = goalView(goal, now('99999.996'), today);
    expect(closer.status).toBe('open');
    expect(closer.progress).toMatchObject({
      current: '99999.99',
      percent: '99.99',
      remaining: '0.01',
    });
    const dated = goalView({ ...goal, deadline: '2029-10-13' }, now('99999.996'), today);
    expect(dated.status).not.toBe('reached');
    expect(dated.progress.percent).toBe('99.99');
    const done = goalView(goal, now('100000.00'), today);
    expect(done.status).toBe('reached');
    expect(done.progress).toMatchObject({
      current: '100000.00',
      percent: '100.00',
      remaining: '0.00',
    });
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
      expect(scenario.metByDeadline).toBeNull();
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

  it("goals-26 rounds a projection down and the gap it leaves up, never in the owner's favour", () => {
    const flat = { ...row, expectedReturnPercent: '0', targetAmount: '20000.00' };
    // Three payments of 300 by the deadline at no return: 10900.006 is projected.
    const view = goalView({ ...flat, deadline: '2027-01-13' }, now('10000.006'), today);
    expect(view.scenarios[1]).toMatchObject({ projectedAtDeadline: '10900.00', gap: '9100.00' });
    // A surplus is what the plan has beyond the sum, so it rounds down too.
    const rich = goalView(
      { ...flat, targetAmount: '10000.00', deadline: '2027-01-13' },
      now('10000.006'),
      today,
    );
    expect(rich.scenarios[1]).toMatchObject({ projectedAtDeadline: '10900.00', gap: '-900.00' });
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
