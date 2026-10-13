import { BadRequestException } from '@nestjs/common';
import { parseGoal, parseGoalUpdate } from './goal-input';

const goal = {
  requestId: '5b1d9a6e-6d0b-4b6e-9b66-0f1d3c7a1a01',
  name: ' Reserve ',
  currency: 'USD',
  targetAmount: '50000',
  deadline: '2030-01-01',
  expectedReturnPercent: '8.50',
  monthlyContribution: '400.5',
};

describe('goal input', () => {
  it('reads a goal and normalises the figures', () => {
    expect(parseGoal(goal)).toEqual({
      ...goal,
      name: 'Reserve',
      targetAmount: '50000.00',
      expectedReturnPercent: '8.5',
      monthlyContribution: '400.50',
    });
  });

  it('keeps the optional fields as null', () => {
    const { requestId, ...rest } = parseGoal({
      ...goal,
      deadline: null,
      monthlyContribution: null,
    });
    expect(requestId).toBe(goal.requestId);
    expect(rest.deadline).toBeNull();
    expect(rest.monthlyContribution).toBeNull();
  });

  it('accepts a zero contribution and a zero return, not a zero target', () => {
    expect(
      parseGoal({ ...goal, monthlyContribution: '0', expectedReturnPercent: '0' }),
    ).toMatchObject({
      monthlyContribution: '0.00',
      expectedReturnPercent: '0',
    });
    expect(() => parseGoal({ ...goal, targetAmount: '0' })).toThrow(BadRequestException);
  });

  it.each([
    ['an unknown field', { ...goal, extra: 1 }],
    ['a missing field', { ...goal, deadline: undefined }],
    ['an unknown currency', { ...goal, currency: 'KZT' }],
    ['a blank name', { ...goal, name: '   ' }],
    ['a name with a control character', { ...goal, name: 'a\u0007b' }],
    ['a name that is too long', { ...goal, name: 'x'.repeat(121) }],
    ['a negative amount', { ...goal, targetAmount: '-5' }],
    ['three decimals', { ...goal, targetAmount: '10.123' }],
    ['a number instead of text', { ...goal, targetAmount: 100 }],
    ['an impossible date', { ...goal, deadline: '2030-02-30' }],
    ['a return of 1000', { ...goal, expectedReturnPercent: '1000' }],
    ['a request id that is not a uuid', { ...goal, requestId: 'one' }],
    ['a list', [goal]],
    ['null', null],
  ])('refuses %s', (_, input) => {
    expect(() => parseGoal(input)).toThrow(BadRequestException);
  });

  it('replaces a goal as a whole, without a request id', () => {
    const { requestId, ...fields } = goal;
    expect(requestId).toBeDefined();
    expect(parseGoalUpdate(fields).name).toBe('Reserve');
    expect(() => parseGoalUpdate(goal)).toThrow(BadRequestException);
    expect(() => parseGoalUpdate({ ...fields, name: undefined })).toThrow(BadRequestException);
  });
});
