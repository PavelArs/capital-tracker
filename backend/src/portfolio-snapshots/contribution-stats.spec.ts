import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import { contributionStart, monthlyContributions } from './contribution-stats';

const scale = 10n ** 60n;
const flow = (on: string, amount: bigint | null) => ({
  at: Date.parse(`${on}T00:00:00+03:00`),
  amount: amount === null ? null : amount * scale,
});

describe('GOAL-CONTRIBUTIONS', () => {
  it('uses complete Moscow months, exact net flows and zero for a known quiet month', () => {
    const result = monthlyContributions(
      [
        flow('2026-07-01', 100n),
        flow('2026-07-20', -10n),
        flow('2026-09-30', 30n),
        flow('2026-10-01', 999n),
      ],
      '2026-07-01',
      '2026-10-18',
    );
    expect(result.months).toEqual([
      { month: '2026-07', net: '90' },
      { month: '2026-08', net: '0' },
      { month: '2026-09', net: '30' },
    ]);
    expect(result.averages).toEqual({ 3: '40', 6: null, 12: null });
  });

  it('keeps missing rates unknown and omits the first partial tracking month', () => {
    const result = monthlyContributions(
      [flow('2026-07-20', 50n), flow('2026-09-30', null)],
      '2026-07-15',
      '2026-10-18',
    );
    expect(result.months).toEqual([
      { month: '2026-08', net: '0' },
      { month: '2026-09', net: null },
    ]);
    expect(result.averages).toEqual({ 3: null, 6: null, 12: null });
  });
});

it('GOAL-CONTRIBUTIONS excludes opening cost from savings pace', () => {
  const result = monthlyContributions(
    [{ ...flow('2026-07-01', 100000n), baseline: true }, flow('2026-09-30', 120n)],
    '2026-07-01',
    '2026-10-18',
  );
  expect(result.averages[3]).toBe('40');
  expect(result.months[0].net).toBe('0');
});

it('GOAL-CONTRIBUTIONS uses the first real record instead of automatic epoch coverage', () => {
  const inputs = {
    accounts: [{ accountId: 'auto', coverageFrom: new Date('1970-01-01T00:00:00Z') }],
    ledgers: new Map([
      [
        'auto',
        {
          accounts: new Map([['auto', { trades: [{ occurredAt: '2026-09-30T22:00:00Z' }] }]]),
          transfers: [],
        },
      ],
    ]),
    chainMoves: new Map(),
    deposits: [],
  } as unknown as ValuationInputs;
  expect(contributionStart(inputs, '2026-10-18')).toBe('2026-10-01');
  expect(
    monthlyContributions([], contributionStart(inputs, '2026-10-18'), '2026-10-18').averages[12],
  ).toBeNull();
  inputs.accounts[0].coverageFrom = new Date('2026-07-01T00:00:00+03:00');
  expect(contributionStart(inputs, '2026-10-18')).toBe('2026-07-01');
});
