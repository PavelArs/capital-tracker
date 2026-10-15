import type { TBankOperation } from './tbank-client';
import { planImport } from './tbank-import-plan';

// BROKER-SYNC: synthetic T-Bank operations only; never an owner's account.
const share = '00000000-0000-4000-8000-000000000001';
let next = 0;
const op = (over: Partial<TBankOperation>): TBankOperation => {
  next += 1;
  return {
    id: `9${String(next).padStart(8, '0')}`,
    parentId: '',
    type: 'OPERATION_TYPE_BUY',
    state: 'executed',
    occurredAt: '2024-03-01T10:00:00Z',
    instrumentUid: share,
    instrumentType: 'share',
    ticker: 'SYNTH',
    quantity: '2',
    payment: '-200',
    paymentCurrency: 'rub',
    price: '100',
    priceCurrency: 'rub',
    commission: '',
    commissionCurrency: '',
    fills: [],
    ...over,
  };
};
const cash = (type: string, payment: string, over: Partial<TBankOperation> = {}) =>
  op({ type, payment, instrumentUid: '', ticker: '', instrumentType: '', quantity: '0', ...over });

describe('BROKER-SYNC: what a T-Bank history would become in the records', () => {
  it('joins a broker fee to its trade and dates the trade by its last fill', () => {
    const buy = op({
      id: '100000001',
      fills: [
        { filledAt: '2024-03-01T10:00:01Z', quantity: '1', price: '100', priceCurrency: 'rub' },
        { filledAt: '2024-03-01T10:00:02.5Z', quantity: '1', price: '100', priceCurrency: 'rub' },
      ],
    });
    const fee = cash('OPERATION_TYPE_BROKER_FEE', '-0.3', { id: '100000002', parentId: buy.id });
    expect(planImport([fee, buy]).entries).toEqual([
      {
        record: 'trade',
        action: 'buy',
        occurredAt: '2024-03-01T10:00:02.5Z',
        instrumentUid: share,
        ticker: 'SYNTH',
        instrumentType: 'share',
        quantity: '2',
        amount: '200',
        fee: '0.3',
        currency: 'rub',
        operationIds: ['100000001', '100000002'],
      },
    ]);
  });

  it('spends a fee in another currency than its trade from cash, not as the trade fee', () => {
    const buy = op({ id: '110000001', payment: '-20', paymentCurrency: 'usd' });
    const fee = cash('OPERATION_TYPE_BROKER_FEE', '-15', { id: '110000002', parentId: buy.id });
    expect(
      planImport([buy, fee]).entries.map((entry) => [
        entry.action,
        entry.amount,
        entry.fee,
        entry.currency,
      ]),
    ).toEqual([
      ['buy', '20', '0', 'usd'],
      ['fee', '15', '0', 'rub'],
    ]);
  });

  it('records money in and out, income, taxes and fees from cash', () => {
    const plan = planImport([
      cash('OPERATION_TYPE_INPUT', '1000', { occurredAt: '2024-01-01T09:00:00Z' }),
      cash('OPERATION_TYPE_DIVIDEND', '50', {
        occurredAt: '2024-01-02T09:00:00Z',
        ticker: 'SYNTH',
      }),
      cash('OPERATION_TYPE_DIVIDEND_TAX', '-6.5', { occurredAt: '2024-01-02T09:00:00Z' }),
      cash('OPERATION_TYPE_TRACK_MFEE', '-10', { occurredAt: '2024-01-03T09:00:00Z' }),
      cash('OPERATION_TYPE_TAX_CORRECTION', '2', { occurredAt: '2024-01-04T09:00:00Z' }),
      cash('OPERATION_TYPE_OUTPUT', '-300', { occurredAt: '2024-01-05T09:00:00Z' }),
    ]);
    expect(
      plan.entries.map((entry) => [entry.record, entry.action, entry.quantity, entry.amount]),
    ).toEqual([
      ['trade', 'deposit', '1000', '1000'],
      ['reward', 'income', '50', '50'],
      ['trade', 'tax', '6.5', '6.5'],
      ['trade', 'fee', '10', '10'],
      ['reward', 'income', '2', '2'],
      ['trade', 'withdrawal', '300', '300'],
    ]);
    expect(plan.entries[1].ticker).toBe('SYNTH');
    expect([plan.trades, plan.rewards, plan.grouping, plan.fitsTradeLimit]).toEqual([
      4,
      2,
      'operation',
      true,
    ]);
  });

  it('sells a bond paid back in full and shows a part paid back as money received', () => {
    const [full, part] = planImport([
      op({ type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL', payment: '1000', quantity: '1' }),
      op({
        type: 'OPERATION_TYPE_BOND_REPAYMENT',
        payment: '250',
        quantity: '0',
        occurredAt: '2024-03-02T10:00:00Z',
      }),
    ]).entries;
    expect([full.record, full.action, full.instrumentUid, full.quantity, full.amount]).toEqual([
      'trade',
      'sell',
      share,
      '1',
      '1000',
    ]);
    expect([part.record, part.action, part.instrumentUid, part.quantity]).toEqual([
      'reward',
      'repayment',
      '',
      '250',
    ]);
  });

  it('lists what it cannot record instead of guessing, and ignores what did not happen', () => {
    const plan = planImport([
      op({ id: '200000001', type: 'OPERATION_TYPE_SOMETHING_NEW' }),
      op({ id: '200000002', type: 'OPERATION_TYPE_INPUT_SECURITIES' }),
      op({ id: '200000003', quantity: '0' }),
      op({ id: '200000004', payment: '0' }),
      op({ id: '200000005', state: 'canceled' }),
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['200000001', 'unsupported'],
      ['200000002', 'transfer'],
      ['200000003', 'no-quantity'],
      ['200000004', 'no-amount'],
    ]);
  });

  it('spends a fee whose trade is not listed or not recorded from cash', () => {
    const skippedTrade = op({ id: '300000001', quantity: '0' });
    const plan = planImport([
      cash('OPERATION_TYPE_BROKER_FEE', '-1', { parentId: '999999999' }),
      skippedTrade,
      cash('OPERATION_TYPE_BROKER_FEE', '-2', { parentId: skippedTrade.id }),
    ]);
    expect(plan.entries.map((fee) => [fee.record, fee.action, fee.amount])).toEqual([
      ['trade', 'fee', '1'],
      ['trade', 'fee', '2'],
    ]);
  });

  it('puts money that arrives before money spent at the same instant', () => {
    const plan = planImport([
      op({ occurredAt: '2024-03-01T10:00:00Z' }),
      cash('OPERATION_TYPE_INPUT', '200', { occurredAt: '2024-03-01T10:00:00Z' }),
    ]);
    expect(plan.entries.map((entry) => entry.action)).toEqual(['deposit', 'buy']);
  });

  it('combines a busy account by Moscow day, then by month, to fit the trade limit', () => {
    // 950 buys over 95 days, 10 a day; 21:30 UTC is the next Moscow day.
    const busy = Array.from({ length: 950 }, (_, index) =>
      op({
        occurredAt: new Date(Date.UTC(2024, 0, 1 + Math.floor(index / 10), 21, 30, index % 10))
          .toISOString()
          .replace('.000', ''),
        quantity: '1',
        payment: '-10',
      }),
    );
    const byDay = planImport(busy);
    expect([byDay.grouping, byDay.trades, byDay.fitsTradeLimit]).toEqual(['day', 95, true]);
    expect(byDay.entries[0]).toMatchObject({ quantity: '10', amount: '100' });
    expect(byDay.entries[0].operationIds).toHaveLength(10);
    // Moscow dates: the first buy (1 January 21:30 UTC) falls on 2 January.
    expect(byDay.entries[0].occurredAt).toBe('2024-01-01T21:30:09Z');

    const daily = Array.from({ length: 950 }, (_, index) =>
      op({
        occurredAt: new Date(Date.UTC(2024, 0, 1) + index * 86_400_000)
          .toISOString()
          .replace('.000', ''),
      }),
    );
    const byMonth = planImport(daily);
    expect(byMonth.grouping).toBe('month');
    expect(byMonth.trades).toBe(32);
  });

  it('says when an account does not fit even combined by month', () => {
    const many = Array.from({ length: 1001 }, (_, index) =>
      op({ instrumentUid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }),
    );
    const plan = planImport(many);
    expect([plan.grouping, plan.trades, plan.fitsTradeLimit]).toEqual(['month', 1001, false]);
  });
});
