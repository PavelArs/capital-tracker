import { FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import type { Stored } from './deposit-store';
import {
  depositFlows,
  depositValueOn,
  depositValuesAt,
  primeDepositBalances,
  ratesAreFresh,
} from './deposit-valuation';

// Synthetic deposits and rates only: 80 RUB per USD from 2026-01-01 and 100 RUB per EUR, 110
// from 2026-02-10; the rates stop at 2026-02-10.
const rates: FxRates = {
  USD: [{ date: '2026-01-01', rubPerUnit: '80' }],
  EUR: [
    { date: '2026-01-01', rubPerUnit: '100' },
    { date: '2026-01-15', rubPerUnit: '100' },
    { date: '2026-02-10', rubPerUnit: '110' },
  ],
};
const fx = (currency: 'USD' | 'EUR' | 'RUB') => new FxConverter(rates, currency);

const deposit = (
  change: Partial<Stored['deposit']> = {},
  movements: {
    date: string;
    kind: 'topup' | 'withdrawal' | 'interest-payout';
    amount: string;
  }[] = [{ date: '2026-01-01', kind: 'topup', amount: '1000' }],
): Stored => ({
  deposit: {
    id: 'd1',
    kind: 'term-deposit',
    name: 'Synthetic EUR',
    bank: 'Synthetic Bank',
    currency: 'EUR',
    startDate: '2026-01-01',
    endDate: null,
    payout: 'monthly',
    capitalized: false,
    dayBasis: 'actual-365',
    earlyClose: 'forfeits-interest',
    ...change,
  },
  rates: [{ depositId: 'd1', effectiveFrom: '2026-01-01', ratePercent: '0' }],
  movements: movements.map((movement, index) => ({
    id: `m${index}`,
    depositId: 'd1',
    occurredOn: movement.date,
    kind: movement.kind,
    amount: movement.amount,
    comment: null,
  })),
  checks: [],
});

const scale = 10n ** 60n;

describe('depositValueOn', () => {
  it('states the balance in the converter currency at the rate of the day', () => {
    expect(depositValueOn(deposit(), '2026-01-15', fx('RUB'))).toBe(100_000n * scale);
    expect(depositValueOn(deposit(), '2026-01-15', fx('USD'))).toBe(1250n * scale);
    expect(depositValueOn(deposit(), '2026-01-15', fx('EUR'))).toBe(1000n * scale);
  });

  it('is nothing before the deposit started and while it holds nothing', () => {
    expect(depositValueOn(deposit(), '2025-12-31', fx('RUB'))).toBe(0n);
    const closed = deposit({}, [
      { date: '2026-01-01', kind: 'topup', amount: '1000' },
      { date: '2026-01-20', kind: 'withdrawal', amount: '1000' },
    ]);
    expect(depositValueOn(closed, '2026-01-19', fx('RUB'))).toBe(100_000n * scale);
    expect(depositValueOn(closed, '2026-01-20', fx('RUB'))).toBe(0n);
  });

  it('is unknown, not smaller, without a fresh rate for the day', () => {
    // The newest EUR rate is from 2026-02-10; the day after the 15-day limit has none.
    expect(depositValueOn(deposit(), '2026-02-25', fx('RUB'))).toBe(110_000n * scale);
    expect(depositValueOn(deposit(), '2026-02-26', fx('RUB'))).toBeNull();
    // Before the first rate there is none at all.
    expect(
      depositValueOn(
        deposit({ startDate: '2025-06-01' }, [
          { date: '2025-06-01', kind: 'topup', amount: '1000' },
        ]),
        '2025-06-02',
        fx('RUB'),
      ),
    ).toBeNull();
  });

  it('counts a ruble deposit in rubles without any rate', () => {
    const rubles = deposit({ currency: 'RUB' }, [
      { date: '2025-06-01', kind: 'topup', amount: '5000' },
    ]);
    expect(
      depositValueOn(
        { ...rubles, deposit: { ...rubles.deposit, startDate: '2025-06-01' } },
        '2025-06-02',
        fx('RUB'),
      ),
    ).toBe(5000n * scale);
  });

  it('includes the interest the deposit earned', () => {
    const earning = deposit({}, [{ date: '2026-01-01', kind: 'topup', amount: '36500' }]);
    earning.rates = [{ depositId: 'd1', effectiveFrom: '2026-01-01', ratePercent: '10' }];
    // 10 days of 10% a year on 36500 (actual/365) is exactly 100.
    expect(depositValueOn(earning, '2026-01-11', fx('EUR'))).toBe(36_600n * scale);
  });
});

describe('depositValuesAt', () => {
  it('reads every deposit on the Moscow day of the instant', () => {
    // 21:30 UTC on 2026-01-14 is already 2026-01-15 in Moscow.
    const [value] = depositValuesAt([deposit()], new Date('2026-01-14T21:30:00Z'), fx('RUB'));
    expect(value).toMatchObject({ id: 'd1', name: 'Synthetic EUR', bank: 'Synthetic Bank' });
    expect(value.value).toBe(100_000n * scale);
  });
});

describe('depositFlows', () => {
  it('counts a top-up as money in and a withdrawal and a payout as money out', () => {
    const moved = deposit({}, [
      { date: '2026-01-01', kind: 'topup', amount: '1000' },
      { date: '2026-01-10', kind: 'topup', amount: '200' },
      { date: '2026-01-20', kind: 'interest-payout', amount: '5' },
      { date: '2026-01-25', kind: 'withdrawal', amount: '300' },
    ]);
    const flows = depositFlows([moved], fx('RUB'));
    expect(flows.map((flow) => [new Date(flow.at).toISOString(), flow.amount])).toEqual([
      ['2025-12-31T21:00:00.000Z', 100_000n * scale],
      ['2026-01-09T21:00:00.000Z', 20_000n * scale],
      ['2026-01-19T21:00:00.000Z', -500n * scale],
      ['2026-01-24T21:00:00.000Z', -30_000n * scale],
    ]);
  });

  it('states each movement at the rate of its own date', () => {
    const moved = deposit({}, [
      { date: '2026-01-05', kind: 'topup', amount: '1000' },
      { date: '2026-02-12', kind: 'topup', amount: '1000' },
    ]);
    expect(depositFlows([moved], fx('RUB')).map((flow) => flow.amount)).toEqual([
      100_000n * scale,
      110_000n * scale,
    ]);
  });

  it('leaves a flow without any rate unknown', () => {
    const early = deposit({ startDate: '2025-06-01' }, [
      { date: '2025-06-01', kind: 'topup', amount: '10' },
    ]);
    expect(depositFlows([early], fx('RUB'))[0].amount).toBeNull();
  });
});

describe('depositFlows with an old rate', () => {
  it('leaves a flow unknown when the latest rate is more than fifteen days old', () => {
    const moved = deposit({}, [
      { date: '2026-02-25', kind: 'topup', amount: '10' },
      { date: '2026-02-26', kind: 'topup', amount: '10' },
    ]);
    // The rates stop at 2026-02-10: the 25th is the last day they still count.
    expect(depositFlows([moved], fx('RUB')).map((flow) => flow.amount)).toEqual([
      1_100n * scale,
      null,
    ]);
  });
});

describe('depositValueOn replays once per date', () => {
  it('states the same deposit on one day in several currencies', () => {
    const held = deposit();
    expect(depositValueOn(held, '2026-01-15', fx('RUB'))).toBe(100_000n * scale);
    expect(depositValueOn(held, '2026-01-15', fx('USD'))).toBe(1250n * scale);
    expect(depositValueOn(held, '2026-01-16', fx('RUB'))).toBe(100_000n * scale);
  });
});

describe('primeDepositBalances', () => {
  it('gives the values a replay to each date gives', () => {
    const movements = [
      { date: '2026-01-01', kind: 'topup' as const, amount: '1000' },
      { date: '2026-01-20', kind: 'withdrawal' as const, amount: '400' },
    ];
    const instants = ['2025-12-31', '2026-01-01', '2026-01-10', '2026-01-31'].map((date) =>
      Date.parse(`${date}T12:00:00Z`),
    );
    const plain = deposit({}, movements);
    const primed = deposit({}, movements);
    primeDepositBalances([primed], instants);
    for (const at of instants)
      expect(depositValuesAt([primed], new Date(at), fx('RUB'))).toEqual(
        depositValuesAt([plain], new Date(at), fx('RUB')),
      );
  });
});

describe('ratesAreFresh', () => {
  it('needs a rate at most fifteen days old for each foreign currency', () => {
    expect(ratesAreFresh(fx('RUB'), ['EUR', 'RUB'], '2026-02-25')).toBe(true);
    expect(ratesAreFresh(fx('RUB'), ['EUR', 'RUB'], '2026-02-26')).toBe(false);
    expect(ratesAreFresh(fx('RUB'), ['RUB'], '2030-01-01')).toBe(true);
  });
});
