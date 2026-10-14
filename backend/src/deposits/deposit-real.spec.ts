import { buildSeries, personalFactor } from '../inflation/inflation-math';
import { depositBalances, projectDeposit } from './deposit-interest';
import {
  chartDates,
  depositChart,
  depositReal,
  effectiveRatePercent,
  inflationReadings,
  inTodaysMoney,
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
    expect(Number(result.inflationPercent)).toBeCloseTo(12.7, 1);
    expect(Number(result.gain)).toBeLessThan(328.77);
    expect(result.ownRate).toBeUndefined();
  });

  it('INFL-DEPOSIT-AS-OF reads the year ending on the day asked, not the months published after it', () => {
    // 1% a month up to 2026-05, then 5% a month: a view of 2026-05 must not feel the jump.
    const spike = new Map(monthly);
    for (const month of ['2026-06', '2026-07', '2026-08']) spike.set(month, 5);
    const { official } = inflationReadings(buildSeries(spike), null);
    const before = depositReal(savings({ asOf: '2026-05-15' }), official);
    expect(Number(before.inflationPercent)).toBeCloseTo(12.68, 1);
    const after = depositReal(savings({ asOf: '2026-08-31' }), official);
    expect(Number(after.inflationPercent)).toBeGreaterThan(25);
    // No year of figures before 2025-06: the rate is not stated for a day before it.
    expect(depositReal(savings({ asOf: '2026-02-10' }), official).inflationPercent).toBeNull();
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

  it('INFL-DEPOSIT-CHART gives the value and the money put in by day, and the same in today money by each reading', () => {
    const { personal, official } = inflationReadings(noSeries, '10');
    const terms = {
      startDate: '2026-07-01',
      endDate: null,
      payout: 'monthly' as const,
      capitalized: false,
      dayBasis: 'actual-365' as const,
      earlyClose: 'forfeits-interest' as const,
      rates: [{ effectiveFrom: '2026-07-01', ratePercent: '12' }],
    };
    const movements = [
      { date: '2026-07-01', kind: 'topup' as const, amount: '100000.00' },
      { date: '2026-09-01', kind: 'withdrawal' as const, amount: '40000.00' },
    ];
    const dates = ['2026-07-01', '2026-08-01', '2026-09-15', '2027-07-01'];
    const chart = depositChart(
      dates,
      depositBalances(terms, movements, dates),
      movements,
      '2027-07-01',
      { official, personal },
    );
    expect(chart.map((point) => point.date)).toEqual(dates);
    expect(chart.map((point) => point.invested)).toEqual([
      '100000.00',
      '100000.00',
      '60000.00',
      '60000.00',
    ]);
    // Money put in on 1 July 2026 is worth 110,000 a year later at 10%; the withdrawn 40,000 too.
    expect(chart[0].real.personal).toEqual({ balance: '110000.00', invested: '110000.00' });
    // The withdrawal of 1 September is carried from that day to 1 July 2027 at the same 10%.
    const withdrawn = 40000 * personalFactor(10, '2026-09-01', '2027-07-01')!.factor;
    expect(Number(chart[2].real.personal?.invested)).toBeCloseTo(110000 - withdrawn, 1);
    // On the day asked nothing is carried further: the value is the bank's, the money put in the same.
    expect(chart[3].real.personal?.balance).toBe(chart[3].balance);
    expect(Number(chart[3].real.personal?.invested)).toBeCloseTo(110000 - withdrawn, 1);
    // Without an official series no day has a figure in today's money, and the page says so.
    expect(chart.every((point) => point.real.official === null)).toBe(true);
  });

  it('INFL-DEPOSIT-CHART-PAYOUT counts interest paid out as money taken out, as the gain does', () => {
    const { personal, official } = inflationReadings(noSeries, '10');
    const movements = [
      { date: '2026-07-01', kind: 'topup' as const, amount: '100.00' },
      { date: '2026-08-01', kind: 'interest-payout' as const, amount: '10.00' },
    ];
    const dates = ['2026-07-15', '2026-08-01'];
    const chart = depositChart(
      dates,
      new Map([
        ['2026-07-15', 100n * 10n ** 30n],
        ['2026-08-01', 100n * 10n ** 30n],
      ]),
      movements,
      '2026-08-01',
      { official, personal },
    );
    expect(chart.map((point) => point.invested)).toEqual(['100.00', '90.00']);
  });

  it('INFL-DEPOSIT-CHART-DAYS samples each month, every movement day and the day asked, in order', () => {
    expect(
      chartDates('2026-07-01', '2026-09-10', ['2026-08-15', '2026-12-01', '2026-08-15']),
    ).toEqual(['2026-07-01', '2026-08-01', '2026-08-15', '2026-09-01', '2026-09-10']);
    // A day asked before the first month still gives that day alone, with no movement after it.
    expect(chartDates('2026-07-01', '2026-06-20', ['2026-07-01'])).toEqual(['2026-06-20']);
  });

  it('INFL-DEPOSIT-TODAY-MONEY states the end-of-term balance in the money of the day asked', () => {
    const { personal, official } = inflationReadings(noSeries, '10');
    expect(inTodaysMoney('110000.00', '2026-07-01', '2027-07-01', { official, personal })).toEqual({
      official: null,
      personal: '100000.00',
    });
    // A day after the end has no span to carry the balance across.
    expect(inTodaysMoney('110000.00', '2027-08-01', '2027-07-01', { official, personal })).toEqual({
      official: null,
      personal: null,
    });
  });
});
