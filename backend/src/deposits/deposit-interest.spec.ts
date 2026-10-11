import {
  bankBalanceOf,
  type DepositMovement,
  type DepositTerms,
  firstImpossibleMovement,
  nextPayout,
  payoutDates,
  projectDeposit,
} from './deposit-interest';

const terms = (change: Partial<DepositTerms> = {}): DepositTerms => ({
  startDate: '2026-01-01',
  endDate: '2026-04-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  rates: [{ effectiveFrom: '2026-01-01', ratePercent: '12' }],
  ...change,
});
const topup = (date: string, amount: string): DepositMovement => ({
  date,
  kind: 'topup',
  amount,
});

describe('payoutDates', () => {
  it('lists monthly dates and the end date', () => {
    expect(payoutDates(terms(), '2026-12-31')).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
  });

  it('keeps the day of the month, clamped to the last day of short months', () => {
    expect(payoutDates(terms({ startDate: '2026-01-31', endDate: null }), '2026-04-30')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('lists quarterly dates and only the end date for at-end', () => {
    expect(
      payoutDates(terms({ payout: 'quarterly', endDate: '2026-12-01' }), '2026-12-31'),
    ).toEqual(['2026-04-01', '2026-07-01', '2026-10-01', '2026-12-01']);
    expect(payoutDates(terms({ payout: 'at-end' }), '2026-12-31')).toEqual(['2026-04-01']);
    expect(payoutDates(terms({ payout: 'at-end', endDate: null }), '2026-12-31')).toEqual([]);
  });

  it('stops at the asked day', () => {
    expect(payoutDates(terms(), '2026-02-15')).toEqual(['2026-02-01']);
  });
});

describe('projectDeposit', () => {
  it('accrues a single period at the end of the term (31 days of 12% on 100000)', () => {
    const result = projectDeposit(
      terms({ payout: 'at-end', endDate: '2026-02-01' }),
      [topup('2026-01-01', '100000')],
      '2026-02-01',
    );
    expect(result.periods).toEqual([
      { from: '2026-01-01', to: '2026-02-01', interest: '1019.18', treatment: 'payable' },
    ]);
    expect(result.principal).toBe('100000.00');
    expect(result.due).toBe('1019.18');
    expect(result.accrued).toBe('0.00');
    expect(result.balance).toBe('101019.18');
  });

  it('compares a capitalizing deposit with what the bank posted and a paying one with all it earned', () => {
    const capitalizing = terms({ capitalized: true });
    const own = projectDeposit(capitalizing, [topup('2026-01-01', '100000')], '2026-02-11');
    // 1 to 10 February earned and not yet added: the bank still shows the January balance.
    expect(own.principal).toBe('101019.18');
    expect(own.accrued).not.toBe('0.00');
    expect(own.posted).toBe('101019.18');
    expect(bankBalanceOf(capitalizing, own)).toBe('101019.18');

    const paying = terms();
    const payable = projectDeposit(paying, [topup('2026-01-01', '100000')], '2026-02-11');
    expect(payable.posted).toBe('101019.18');
    expect(bankBalanceOf(paying, payable)).toBe(payable.balance);
    expect(payable.balance).not.toBe(payable.posted);
  });

  it('does not earn the day it is asked about', () => {
    const result = projectDeposit(terms(), [topup('2026-01-01', '100000')], '2026-01-11');
    // Ten days: 1 to 10 January.
    expect(result.accrued).toBe('328.77');
    expect(result.periods).toEqual([]);
  });

  it('capitalizes monthly interest into the next month', () => {
    const result = projectDeposit(
      terms({ capitalized: true }),
      [topup('2026-01-01', '100000')],
      '2026-04-01',
    );
    expect(result.periods.map((period) => period.interest)).toEqual([
      '1019.18',
      '929.93',
      '1039.04',
    ]);
    expect(result.principal).toBe('102988.15');
    expect(result.balance).toBe('102988.15');
    expect(result.interestPosted).toBe('2988.15');
  });

  it('leaves payable interest due until a payout takes it out', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-01', kind: 'interest-payout', amount: '1019.18' },
    ];
    const result = projectDeposit(terms(), movements, '2026-03-01');
    expect(result.interestPosted).toBe('1939.73');
    expect(result.interestPaidOut).toBe('1019.18');
    expect(result.due).toBe('920.55');
    expect(result.principal).toBe('100000.00');
  });

  it('accrues on a top-up from the day it is made', () => {
    const result = projectDeposit(
      terms({ payout: 'at-end', endDate: '2026-02-01' }),
      [topup('2026-01-01', '100000'), topup('2026-01-16', '50000')],
      '2026-02-01',
    );
    // 15 days on 100000 (493.15) plus 16 days on 150000 (789.04).
    expect(result.periods[0].interest).toBe('1282.19');
  });

  it('follows a change of rate', () => {
    const result = projectDeposit(
      terms({
        payout: 'at-end',
        endDate: '2026-02-01',
        rates: [
          { effectiveFrom: '2026-01-01', ratePercent: '12' },
          { effectiveFrom: '2026-01-16', ratePercent: '6' },
        ],
      }),
      [topup('2026-01-01', '100000')],
      '2026-02-01',
    );
    // 15 days at 12% (493.15) plus 16 days at 6% (263.01).
    expect(result.periods[0].interest).toBe('756.16');
  });

  it('counts 366 days in a leap year on actual-actual', () => {
    const leap = projectDeposit(
      terms({
        startDate: '2028-01-01',
        endDate: '2028-01-31',
        payout: 'at-end',
        dayBasis: 'actual-actual',
      }),
      [topup('2028-01-01', '100000')],
      '2028-01-31',
    );
    const plain = projectDeposit(
      terms({
        startDate: '2028-01-01',
        endDate: '2028-01-31',
        payout: 'at-end',
        dayBasis: 'actual-365',
      }),
      [topup('2028-01-01', '100000')],
      '2028-01-31',
    );
    expect(leap.periods[0].interest).toBe('983.61');
    expect(plain.periods[0].interest).toBe('986.30');
  });

  it('forfeits the interest not yet posted when the whole deposit is closed early', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-11', kind: 'withdrawal', amount: '100000' },
    ];
    const result = projectDeposit(terms(), movements, '2026-03-01');
    expect(result.closedOn).toBe('2026-02-11');
    expect(result.principal).toBe('0.00');
    expect(result.accrued).toBe('0.00');
    expect(result.interestForfeited).toBe('328.77');
    // The January interest was posted on 1 February and stays due.
    expect(result.due).toBe('1019.18');
  });

  it('keeps the interest when the rule says so', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-11', kind: 'withdrawal', amount: '100000' },
    ];
    const result = projectDeposit(terms({ earlyClose: 'keeps-interest' }), movements, '2026-03-01');
    expect(result.interestForfeited).toBe('0.00');
    // The 10 days since the 1 February posting become due when the deposit is closed.
    expect(result.accrued).toBe('0.00');
    expect(result.due).toBe('1347.95');
    expect(result.periods[result.periods.length - 1]).toEqual({
      from: '2026-02-01',
      to: '2026-02-11',
      interest: '328.77',
      treatment: 'payable',
    });
  });

  it('shows no empty period when the deposit is closed on a payout date', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-01', kind: 'withdrawal', amount: '100000' },
    ];
    const result = projectDeposit(terms({ earlyClose: 'keeps-interest' }), movements, '2026-03-01');
    expect(result.closedOn).toBe('2026-02-01');
    expect(result.periods.map((period) => [period.from, period.to])).toEqual([
      ['2026-01-01', '2026-02-01'],
    ]);
    expect(result.due).toBe('1019.18');
  });

  it('lets the owner record the payout of interest kept on an early closure', () => {
    const closing: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-11', kind: 'withdrawal', amount: '100000' },
    ];
    const early = terms({ earlyClose: 'keeps-interest' });
    const payout: DepositMovement = {
      date: '2026-02-12',
      kind: 'interest-payout',
      amount: '1347.95',
    };
    expect(firstImpossibleMovement(early, [...closing, payout])).toBe(-1);
    expect(projectDeposit(early, [...closing, payout], '2026-03-01').due).toBe('0.00');
  });

  it('keeps accruing after a partial withdrawal, on what is left', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-01-16', kind: 'withdrawal', amount: '50000' },
    ];
    const result = projectDeposit(
      terms({ payout: 'at-end', endDate: '2026-02-01' }),
      movements,
      '2026-02-01',
    );
    expect(result.closedOn).toBeNull();
    // 15 days on 100000 (493.15) plus 16 days on 50000 (263.01).
    expect(result.periods[0].interest).toBe('756.16');
    expect(result.principal).toBe('50000.00');
  });

  it('stops at the end date whatever the asked day', () => {
    const result = projectDeposit(
      terms({ payout: 'at-end', endDate: '2026-02-01' }),
      [topup('2026-01-01', '100000')],
      '2027-01-01',
    );
    expect(result.balance).toBe('101019.18');
  });
});

describe('interest paid out after the term or the closure', () => {
  const atEnd = terms({ payout: 'at-end', endDate: '2026-02-01' });

  it('takes a payout made after maturity off the interest due', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-03', kind: 'interest-payout', amount: '1019.18' },
    ];
    const result = projectDeposit(atEnd, movements, '2026-02-10');
    expect(result.due).toBe('0.00');
    expect(result.interestPaidOut).toBe('1019.18');
    expect(projectDeposit(atEnd, movements, '2026-02-02').due).toBe('1019.18');
    expect(firstImpossibleMovement(atEnd, movements)).toBe(-1);
  });

  it('takes a payout made after an early closure off the interest posted before it', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-11', kind: 'withdrawal', amount: '100000' },
      { date: '2026-02-15', kind: 'interest-payout', amount: '1019.18' },
    ];
    const result = projectDeposit(terms(), movements, '2026-03-01');
    expect(result.closedOn).toBe('2026-02-11');
    expect(result.due).toBe('0.00');
    expect(firstImpossibleMovement(terms(), movements)).toBe(-1);
  });

  it('refuses a payout larger than what is still due after an earlier one', () => {
    const movements: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-02-03', kind: 'interest-payout', amount: '1000' },
      { date: '2026-02-04', kind: 'interest-payout', amount: '100' },
    ];
    expect(firstImpossibleMovement(atEnd, movements)).toBe(2);
  });

  it('refuses a top-up on the end date but lets the money be taken out that day', () => {
    const held: DepositMovement[] = [topup('2026-01-01', '100000')];
    expect(firstImpossibleMovement(atEnd, [...held, topup('2026-02-01', '10')])).toBe(1);
    expect(firstImpossibleMovement(atEnd, [...held, topup('2026-01-31', '10')])).toBe(-1);
    expect(
      firstImpossibleMovement(atEnd, [
        ...held,
        { date: '2026-02-01', kind: 'withdrawal', amount: '100000' },
      ]),
    ).toBe(-1);
    expect(
      firstImpossibleMovement(atEnd, [
        ...held,
        { date: '2026-02-02', kind: 'withdrawal', amount: '100000' },
      ]),
    ).toBe(1);
  });

  it('refuses money moved on the day the whole deposit was withdrawn', () => {
    const closing: DepositMovement[] = [
      topup('2026-01-01', '100000'),
      { date: '2026-01-20', kind: 'withdrawal', amount: '100000' },
    ];
    expect(firstImpossibleMovement(terms(), closing)).toBe(-1);
    expect(firstImpossibleMovement(terms(), [...closing, topup('2026-01-20', '500')])).toBe(2);
    expect(firstImpossibleMovement(terms(), [...closing, topup('2026-01-21', '500')])).toBe(2);
  });
});

describe('nextPayout', () => {
  it('estimates the next posting from what is held now', () => {
    const next = nextPayout(terms(), [topup('2026-01-01', '100000')], '2026-02-10');
    expect(next).toEqual({ date: '2026-03-01', interest: '920.55', treatment: 'payable' });
  });

  it('finds the next quarterly date when a clamped one is followed by a longer quarter', () => {
    const quarterly = terms({
      startDate: '2026-01-31',
      endDate: null,
      payout: 'quarterly',
      capitalized: true,
    });
    expect(payoutDates(quarterly, '2026-12-31').slice(0, 2)).toEqual(['2026-04-30', '2026-07-31']);
    const next = nextPayout(quarterly, [topup('2026-01-31', '100000')], '2026-04-30');
    expect(next?.date).toBe('2026-07-31');
  });

  it('is null once the term is over', () => {
    expect(nextPayout(terms(), [topup('2026-01-01', '100000')], '2026-04-01')).toBeNull();
  });
});
