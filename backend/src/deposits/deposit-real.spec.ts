import { buildSeries } from '../inflation/inflation-math';
import { depositBalances, projectDeposit } from './deposit-interest';
import {
  depositReal,
  effectiveRatePercent,
  inflationReadings,
  periodsAfterInflation,
  type RealDepositInput,
} from './deposit-real';

// Synthetic figures only.
const noSeries = buildSeries(new Map());
// One percent a month from 2025-06 to 2026-10: about 12.7% over a year, known up to October.
const monthly = new Map<string, number>();
for (let index = 0; index < 17; index++) {
  const month = 5 + index;
  monthly.set(`${2025 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`, 1);
}
const series = buildSeries(monthly);

const savings = (change: Partial<RealDepositInput> = {}): RealDepositInput => ({
  balance: '100328.77',
  active: true,
  ratePercent: '12',
  terms: { capitalized: false, payout: 'monthly' },
  movements: [{ date: '2026-07-01', kind: 'topup', amount: '100000.00' }],
  asOf: '2026-10-11',
  ...change,
});

describe('deposits after inflation (INFL-DEPOSIT)', () => {
  it('INFL-DEPOSIT-RATE counts a capitalized rate at its compounding and a paid-out one as it is', () => {
    expect(effectiveRatePercent('12', { capitalized: false, payout: 'monthly' })).toBe(12);
    expect(effectiveRatePercent('12', { capitalized: true, payout: 'monthly' })).toBeCloseTo(
      12.6825,
      4,
    );
    expect(effectiveRatePercent('12', { capitalized: true, payout: 'at-end' })).toBeCloseTo(12, 9);
    expect(effectiveRatePercent('12', { capitalized: true, payout: 'daily' })).toBeCloseTo(
      12.7475,
      4,
    );
  });

  it('INFL-DEPOSIT-OWN-RATE earns what the interest is when the rate is zero, and a real rate beside it', () => {
    const { personal } = inflationReadings(noSeries, '0');
    expect(depositReal(savings(), personal)).toEqual({
      inflationPercent: '0.00',
      ratePercent: '12.00',
      gain: '328.77',
      estimated: true,
      ownRate: true,
    });
  });

  it('INFL-DEPOSIT-GAIN grows the money put in by the inflation since the day it came in', () => {
    const { personal } = inflationReadings(noSeries, '10');
    const result = depositReal(
      savings({
        balance: '112000.00',
        movements: [{ date: '2026-07-01', kind: 'topup', amount: '100000.00' }],
        asOf: '2027-07-01',
      }),
      personal,
    );
    // A year at 10% asks 110,000 of the money put in, so 2,000 of the 12,000 is real.
    expect(result.gain).toBe('2000.00');
    expect(result.inflationPercent).toBe('10.00');
    expect(result.ratePercent).toBe('1.82');
  });

  it('INFL-DEPOSIT-OFFICIAL reads the published months, and says so when the latest are estimated', () => {
    const { official } = inflationReadings(series, null);
    expect(depositReal(savings(), official).estimated).toBe(false);
    const result = depositReal(savings({ asOf: '2026-11-20' }), official);
    expect(result.estimated).toBe(true);
    expect(Number(result.inflationPercent)).toBeCloseTo(12.68, 2);
    expect(Number(result.gain)).toBeLessThan(328.77);
    expect(result.ownRate).toBeUndefined();
  });

  it('INFL-DEPOSIT-NO-OWN-RATE follows the official reading and says it has no rate of its own', () => {
    const { official, personal } = inflationReadings(series, null);
    expect(personal.ownRate).toBe(false);
    expect(depositReal(savings(), personal)).toEqual({
      ...depositReal(savings(), official),
      ownRate: false,
    });
  });

  it('INFL-DEPOSIT-TAKEN-OUT carries paid-out interest and withdrawals as money taken out', () => {
    const { personal } = inflationReadings(noSeries, '0');
    // 59,000 is left of the money put in (100,000 less 1,000 paid out and 40,000 withdrawn).
    const result = depositReal(
      savings({
        balance: '61500.00',
        movements: [
          { date: '2026-07-01', kind: 'topup', amount: '100000.00' },
          { date: '2026-08-01', kind: 'interest-payout', amount: '1000.00' },
          { date: '2026-09-01', kind: 'withdrawal', amount: '40000.00' },
        ],
      }),
      personal,
    );
    expect(result.gain).toBe('2500.00');
  });

  it('INFL-DEPOSIT-UNKNOWN has no figure where the series does not reach, never a partial one', () => {
    const { official } = inflationReadings(noSeries, null);
    expect(depositReal(savings(), official)).toEqual({
      inflationPercent: null,
      ratePercent: null,
      gain: null,
      estimated: false,
    });
    // The series starts after the deposit: the rate is known, the gain is not.
    const late = inflationReadings(buildSeries(new Map([['2026-09', 1]])), null).official;
    const result = depositReal(savings(), late);
    expect(result.gain).toBeNull();
  });

  it('INFL-DEPOSIT-INACTIVE states no rate for a deposit that is closed or past its term', () => {
    const { personal } = inflationReadings(noSeries, '5');
    const result = depositReal(savings({ active: false }), personal);
    expect(result.ratePercent).toBeNull();
    expect(result.gain).not.toBeNull();
  });

  it('INFL-DEPOSIT-PERIODS takes the inflation on the money held at the start from each period', () => {
    const { personal } = inflationReadings(noSeries, '12');
    const terms = {
      startDate: '2026-07-01',
      endDate: null,
      payout: 'monthly' as const,
      capitalized: true,
      dayBasis: 'actual-365' as const,
      earlyClose: 'forfeits-interest' as const,
      rates: [{ effectiveFrom: '2026-07-01', ratePercent: '12' }],
    };
    const movements = [{ date: '2026-07-01', kind: 'topup' as const, amount: '100000.00' }];
    const { periods } = projectDeposit(terms, movements, '2026-10-11');
    const held = depositBalances(
      terms,
      movements,
      periods.map((period) => period.from),
    );
    const after = periodsAfterInflation(periods, held, personal);
    expect(after).toHaveLength(periods.length);
    // 31 days of 12% a year on 100,000 is about 967.17 of inflation; the interest is 1,019.18.
    expect(Number(after[0])).toBeCloseTo(1019.18 - 100000 * (1.12 ** (31 / 365) - 1), 1);
    // The next period starts from the larger balance that includes the interest added.
    expect(Number(periods[1].interest) - Number(after[1])).toBeGreaterThan(
      Number(periods[0].interest) - Number(after[0]),
    );
  });

  it('INFL-DEPOSIT-PERIODS-UNKNOWN has no figure for a period the series does not reach', () => {
    const { official } = inflationReadings(noSeries, null);
    const periods = [
      { from: '2026-07-01', to: '2026-08-01', interest: '10.00', treatment: 'payable' as const },
    ];
    expect(periodsAfterInflation(periods, new Map([['2026-07-01', 10n ** 30n]]), official)).toEqual(
      [null],
    );
  });
});
