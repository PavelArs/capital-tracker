import type { Goal, GoalScenario } from '@api/goals.api';
import { describe, expect, it } from 'vitest';
import {
  againstTarget,
  dateText,
  difference,
  enteredText,
  monthsFrom,
  monthYear,
  neededText,
  ordered,
  rateText,
  reachedDate,
  span,
  sumText,
  timeLeft,
  verdict,
  wholeMoney,
} from './goal-format';

// Synthetic goals and sums only.
const scenario = (change: Partial<GoalScenario> = {}): GoalScenario => ({
  key: 'base',
  returnPercent: '8',
  requiredMonthly: '1000.00',
  monthsToTarget: 30,
  reachedOn: '2029-04-13',
  projectedAtDeadline: '20000.00',
  gap: '0.00',
  ...change,
});
const goal = (change: Partial<Goal> = {}): Goal => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Reserve A',
  currency: 'USD',
  targetAmount: '20000.00',
  deadline: '2029-10-13',
  expectedReturnPercent: '8.0000',
  monthlyContribution: '1200.00',
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: { current: '5000.00', complete: true, percent: '25.00', remaining: '15000.00' },
  status: 'on-track',
  scenarios: [scenario()],
  ...change,
});

describe('GOAL-LIST figures', () => {
  it('writes sums in whole units without a floating-point number', () => {
    expect(wholeMoney('22000000.00', 'RUB')).toBe('₽22,000,000');
    expect(wholeMoney('1234.49', 'USD')).toBe('$1,234');
    expect(wholeMoney('1234.50', 'EUR')).toBe('€1,235');
    expect(wholeMoney('999999999999.99', 'USD')).toBe('$1,000,000,000,000');
    expect(wholeMoney('-5.00', 'USD')).toBe('-$5');
    expect(wholeMoney('-0.20', 'USD')).toBe('$0');
    expect(wholeMoney(null, 'USD')).toBe('—');
  });

  it('subtracts decimals exactly', () => {
    expect(difference('1000.10', '999.95')).toBe('0.15');
    expect(difference('5.00', '20.00')).toBe('-15.00');
  });

  it('writes dates, spans and returns plainly', () => {
    expect(dateText('2026-10-01')).toBe('Oct 1, 2026');
    expect(monthYear('2029-04-13')).toBe('Apr 2029');
    expect(span(38)).toBe('3 years 2 months');
    expect(span(12)).toBe('1 year');
    expect(span(5)).toBe('5 months');
    expect(span(0)).toBe('under a month');
    expect(rateText('8.0000')).toBe('8');
    expect(rateText('7.5000')).toBe('7.5');
    expect(rateText('12')).toBe('12');
  });

  it('lists open goals by date, goals without a date after them, reached goals last', () => {
    const names = ordered([
      goal({ name: 'Reached', status: 'reached' }),
      goal({ name: 'Open', deadline: null, status: 'open' }),
      goal({ name: 'Late', deadline: '2031-01-01' }),
      goal({ name: 'Soon', deadline: '2027-01-01' }),
    ]).map((item) => item.name);
    expect(names).toEqual(['Soon', 'Late', 'Open', 'Reached']);
  });
});

describe('GOAL-VERDICT the sentence under a goal', () => {
  it('says how far above the sum a reached goal is', () => {
    const reached = goal({
      status: 'reached',
      progress: { current: '21500.00', complete: true, percent: '100.00', remaining: '0.00' },
    });
    expect(verdict(reached)).toBe('Reached. Your net worth is $1,500 above it.');
    const exact = goal({
      status: 'reached',
      progress: { current: '20000.00', complete: true, percent: '100.00', remaining: '0.00' },
    });
    expect(verdict(exact)).toBe('Reached.');
  });

  it('says when the plan gets there and how early', () => {
    expect(verdict(goal())).toBe(
      'On track. $1,200 a month gets there by Apr 2029, 6 months early.',
    );
    expect(
      verdict(goal({ monthlyContribution: null, scenarios: [scenario({ reachedOn: null })] })),
    ).toBe('On track. The portfolio grows to the sum by Oct 2029 without further contributions.');
  });

  it('counts only whole months early, by the day', () => {
    const near = (reachedOn: string, deadline: string) =>
      verdict(goal({ deadline, scenarios: [scenario({ reachedOn })] }));
    expect(near('2029-01-31', '2029-02-01')).toBe(
      'On track. $1,200 a month gets there by Jan 2029.',
    );
    expect(near('2029-01-15', '2029-02-15')).toBe(
      'On track. $1,200 a month gets there by Jan 2029, 1 month early.',
    );
  });

  it('says what a goal that is behind lacks', () => {
    const behind = goal({
      status: 'behind',
      monthlyContribution: '400.00',
      scenarios: [scenario({ requiredMonthly: '1000.00', reachedOn: '2033-01-13' })],
    });
    expect(verdict(behind)).toBe(
      'Behind by $600 a month. Reaching it by Oct 2029 needs $1,000 a month; at $400 it takes until Jan 2033.',
    );
    const unplanned = goal({
      status: 'behind',
      monthlyContribution: null,
      scenarios: [scenario({ requiredMonthly: '1000.00', reachedOn: null })],
    });
    expect(verdict(unplanned)).toBe('Behind. Reaching it by Oct 2029 needs $1,000 a month.');
    const never = goal({
      status: 'behind',
      monthlyContribution: '5.00',
      scenarios: [scenario({ requiredMonthly: '1000.00', reachedOn: null })],
    });
    expect(verdict(never)).toContain('at $5 it is not reached in 100 years');
    expect(
      verdict(goal({ status: 'behind', scenarios: [scenario({ requiredMonthly: null })] })),
    ).toBe('Behind. No monthly payment is left before the date.');
  });

  it('says a date has passed and what is left', () => {
    const overdue = goal({ status: 'overdue', deadline: '2026-09-01' });
    expect(verdict(overdue)).toBe(
      'The date, Sep 1, 2026, has passed. $15,000 to go. At $1,200 a month you get there in Apr 2029.',
    );
  });

  it('says when a goal without a date is reached', () => {
    const open = goal({ status: 'open', deadline: null });
    expect(verdict(open)).toBe('At $1,200 a month you get there in Apr 2029, in 2 years 6 months.');
    const alone = goal({ status: 'open', deadline: null, monthlyContribution: null });
    expect(verdict(alone)).toBe('The portfolio alone gets there in Apr 2029, in 2 years 6 months.');
    const never = goal({
      status: 'open',
      deadline: null,
      scenarios: [scenario({ reachedOn: null, monthsToTarget: null })],
    });
    expect(verdict(never)).toContain('more than 100 years');
  });

  it('does not judge a portfolio that could not be fully valued', () => {
    expect(verdict(goal({ status: 'unknown' }))).toContain('no price or rate');
    expect(
      verdict(
        goal({
          status: 'unknown',
          scenarios: [],
          progress: { current: null, complete: false, percent: null, remaining: null },
        }),
      ),
    ).toContain('could be valued');
  });
});

describe('GOAL-VERDICT with assets that have no price', () => {
  const unpriced = { current: '5000.00', complete: false, percent: '25.00', remaining: null };

  it('gives no date or sum worked out from an understated value', () => {
    expect(verdict(goal({ progress: unpriced }))).toBe(
      'On track even without the assets that have no price or rate yet.',
    );
    expect(verdict(goal({ progress: unpriced, status: 'open', deadline: null }))).toContain(
      'no date or monthly sum is worked out',
    );
  });
});

describe('GOAL-SUM a sum that is not nothing', () => {
  it('keeps the cents of a sub-unit amount instead of reading $0', () => {
    expect(sumText('0.40', 'USD')).toBe('$0.40');
    expect(sumText('-0.05', 'USD')).toBe('-$0.05');
    expect(sumText('0.00', 'USD')).toBe('$0');
    expect(sumText('1234.50', 'EUR')).toBe('€1,235');
    expect(sumText('9.27e+127', 'USD')).toBe('—');
  });
});

describe('GOAL-NEEDED a sum to put in', () => {
  it('rounds up so that the figure shown reaches the need', () => {
    expect(neededText('1.40', 'USD')).toBe('$2');
    expect(neededText('0.40', 'USD')).toBe('$1');
    expect(neededText('420000.00', 'RUB')).toBe('₽420,000');
    expect(neededText('0.00', 'USD')).toBe('$0');
    expect(neededText(null, 'USD')).toBe('—');
  });
});

describe('GOAL-MONTHS whole months by the payment schedule', () => {
  it('counts a clipped anniversary at the end of a short month as a month', () => {
    expect(monthsFrom('2026-01-31', '2026-02-28')).toBe(1);
    expect(monthsFrom('2026-01-31', '2026-02-27')).toBe(0);
    expect(monthsFrom('2026-10-13', '2027-01-12')).toBe(2);
    expect(monthsFrom('2026-10-13', '2027-01-13')).toBe(3);
    expect(monthsFrom('2026-10-13', '2026-10-12')).toBe(-1);
  });
});

describe('GOAL-ENTERED a sum as the owner entered it', () => {
  it('keeps the cents of an entered sum and leaves whole sums whole', () => {
    expect(enteredText('1.40', 'USD')).toBe('$1.40');
    expect(enteredText('1234567.05', 'EUR')).toBe('€1,234,567.05');
    expect(enteredText('150000.00', 'RUB')).toBe('₽150,000');
    expect(enteredText(null, 'USD')).toBe('—');
  });
});

describe('GOAL-AGAINST a projection against the sum', () => {
  it('says short, more, or on the sum when the gap rounds to nothing', () => {
    expect(againstTarget('600.00', 'USD')?.text).toBe('$600 short');
    expect(againstTarget('-1200.00', 'USD')?.hint).toBe('$1,200 more than the sum');
    expect(againstTarget('0.00', 'USD')).toMatchObject({ text: 'On the sum', tone: 'level' });
    expect(againstTarget(null, 'USD')).toBeNull();
  });

  it('writes out the cents of a gap under half a unit instead of showing $0', () => {
    expect(againstTarget('0.49', 'USD')).toMatchObject({ text: '$0.49 short', tone: 'short' });
    expect(againstTarget('-0.49', 'USD')).toMatchObject({ text: '$0.49 more', tone: 'more' });
    expect(againstTarget('0.05', 'USD')?.text).toBe('$0.05 short');
    expect(againstTarget('0.50', 'USD')?.text).toBe('$0.50 short');
    expect(againstTarget('1.40', 'USD')?.text).toBe('$2 short');
    expect(againstTarget('-1.60', 'USD')?.text).toBe('$1 more');
  });

  it('shows no sum for a figure written in scientific notation', () => {
    expect(wholeMoney('9.27e+127', 'USD')).toBe('—');
    expect(againstTarget('9.27e+127', 'USD')).toBeNull();
  });
});

describe('GOAL-TIME-LEFT time left to the date', () => {
  it('counts from the day of the forecast, not the browser date', () => {
    expect(timeLeft('2027-01-13', '2026-10-13')).toBe('3 months');
    expect(timeLeft('2026-10-13', '2026-10-13')).toBeNull();
    expect(timeLeft('2026-10-12', '2026-10-13')).toBeNull();
  });
});

describe('GOAL-REACHED-DATE when a case gets the sum', () => {
  const late = scenario({ reachedOn: '2026-12-13', gap: '-480.00', metByDeadline: true });
  const dated = goal({ deadline: '2026-11-30', scenarios: [late] });

  it('gives the deadline when the sum is already there by it but the whole months run past', () => {
    expect(reachedDate(dated, late)).toBe('2026-11-30');
    expect(verdict(dated)).toContain('by Nov 2026');
  });

  it('follows the unrounded verdict, whatever the rounded gap reads', () => {
    const surplus = scenario({ reachedOn: '2026-12-13', gap: '0.00', metByDeadline: true });
    expect(reachedDate(goal({ deadline: '2026-11-30' }), surplus)).toBe('2026-11-30');
    const missed = scenario({ reachedOn: '2026-12-13', gap: '0.00', metByDeadline: false });
    expect(reachedDate(goal({ deadline: '2026-11-30' }), missed)).toBe('2026-12-13');
  });

  it('keeps the server date when the case is short at the deadline', () => {
    const short = scenario({ reachedOn: '2026-12-13', gap: '480.00' });
    expect(reachedDate(goal({ deadline: '2026-11-30' }), short)).toBe('2026-12-13');
    expect(reachedDate(goal({ deadline: null }), late)).toBe('2026-12-13');
  });
});
