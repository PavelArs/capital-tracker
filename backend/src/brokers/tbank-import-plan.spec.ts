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
  it('joins a broker fee to its trade and dates the trade by its fill, not its order', () => {
    const buy = op({
      id: '100000001',
      fills: [
        { filledAt: '2024-03-01T10:00:02.5Z', quantity: '1', price: '100', priceCurrency: 'rub' },
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
    expect([plan.entries[1].instrumentUid, plan.entries[1].paidBy?.ticker]).toEqual(['', 'SYNTH']);
    expect([plan.trades, plan.rewards, plan.grouping, plan.fitsTradeLimit]).toEqual([
      4,
      2,
      'operation',
      true,
    ]);
  });

  it('sells a bond paid back in full and records a part paid back as a capital return', () => {
    // A part paid back is principal, not income: it lowers what the units cost and keeps them.
    const part = op({
      type: 'OPERATION_TYPE_BOND_REPAYMENT',
      payment: '250',
      quantity: '0',
      occurredAt: '2024-01-15T10:00:00Z',
    });
    const plan = planImport([
      op({ quantity: '1', payment: '-990', occurredAt: '2024-01-01T10:00:00Z' }),
      part,
      op({ type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL', payment: '750', quantity: '1' }),
    ]);
    const [returned, full] = [plan.entries[1], plan.entries[2]];
    expect([returned.record, returned.action, returned.instrumentUid, returned.amount]).toEqual([
      'capital-return',
      'return',
      share,
      '250',
    ]);
    expect([full.record, full.action, full.instrumentUid, full.quantity, full.amount]).toEqual([
      'trade',
      'sell',
      share,
      '1',
      '750',
    ]);
    expect(plan.entries).toHaveLength(3);
    expect(plan.skipped).toEqual([]);
    expect([plan.trades, plan.rewards, plan.capitalReturns]).toEqual([2, 0, 1]);
  });

  it('sells every unit held of a bond paid back in full, as T-Bank gives no quantity for it', () => {
    // T-Bank documents that payouts for bond repayment carry no instrument quantity.
    const plan = planImport([
      op({ id: '300000001', quantity: '5', payment: '-5000' }),
      op({
        id: '300000002',
        type: 'OPERATION_TYPE_SELL',
        quantity: '2',
        payment: '2000',
        occurredAt: '2024-03-02T10:00:00Z',
      }),
      op({
        id: '300000003',
        type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL',
        quantity: '0',
        payment: '3000',
        occurredAt: '2024-03-03T10:00:00Z',
      }),
    ]);
    const full = plan.entries.find((entry) => entry.operationIds[0] === '300000003');
    expect([full?.action, full?.quantity, full?.amount]).toEqual(['sell', '3', '3000']);
    expect(plan.skipped).toEqual([]);
  });

  it('lists a bond paid back in full that the history never shows bought', () => {
    const plan = planImport([
      op({
        id: '300000004',
        type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL',
        quantity: '0',
        payment: '1000',
      }),
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        operationId: '300000004',
        type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL',
        reason: 'no-quantity',
      },
    ]);
  });

  it('splits an order filled at several times into a part per fill time, priced by its fills', () => {
    const fill = (filledAt: string, quantity: string, price: string) => ({
      filledAt,
      quantity,
      price,
      priceCurrency: 'rub',
    });
    const buy = op({
      id: '400000001',
      quantity: '10',
      payment: '-1100.01',
      fills: [
        fill('2024-03-01T10:00:00Z', '3', '100'),
        fill('2024-03-01T10:00:00Z', '1', '100'),
        fill('2024-03-01T12:00:00Z', '1', '200'),
        fill('2024-03-04T10:00:00Z', '5', '100'),
      ],
    });
    const plan = planImport([
      buy,
      cash('OPERATION_TYPE_BROKER_FEE', '-1', { id: '400000002', parentId: buy.id }),
      // A sale between two fills of one day sells what the earlier fill bought.
      op({
        id: '400000010',
        type: 'OPERATION_TYPE_SELL',
        quantity: '4',
        payment: '400',
        occurredAt: '2024-03-01T11:00:00Z',
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.map((entry) => [
        entry.action,
        entry.occurredAt,
        entry.quantity,
        entry.amount,
        entry.fee,
        entry.operationIds,
      ]),
    ).toEqual([
      ['buy', '2024-03-01T10:00:00Z', '4', '400', '0.36', ['400000001', '400000002']],
      ['sell', '2024-03-01T11:00:00Z', '4', '400', '0', ['400000010']],
      ['buy', '2024-03-01T12:00:00Z', '1', '200', '0.18', ['400000001#2']],
      ['buy', '2024-03-04T10:00:00Z', '5', '500.01', '0.46', ['400000001#3']],
    ]);
  });

  it('lists an order whose fills do not account for it instead of guessing their dates or prices', () => {
    const fill = (filledAt: string, quantity: string, price = '100', priceCurrency = 'rub') => ({
      filledAt,
      quantity,
      price,
      priceCurrency,
    });
    const early = '2024-03-01T10:00:00Z';
    const late = '2024-03-01T12:00:00Z';
    const unpriced = op({ id: '450000001', fills: [fill(early, '1', '0'), fill(late, '1')] });
    const plan = planImport([
      unpriced,
      cash('OPERATION_TYPE_BROKER_FEE', '-0.5', { id: '450000002', parentId: unpriced.id }),
      op({ id: '450000003', fills: [fill(early, '1'), fill(late, '1', '1', 'usd')] }),
      op({
        id: '450000004',
        quantity: '3',
        payment: '-300',
        fills: [fill(early, '1'), fill(late, '1')],
      }),
      op({ id: '450000005', quantity: '3', payment: '-300', fills: [fill(early, '2')] }),
      // One fill time that covers the order needs no price to date or split it.
      op({ id: '450000006', fills: [fill(late, '2', '0')] }),
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['450000001', 'fills'],
      ['450000003', 'fills'],
      ['450000004', 'fills'],
      ['450000005', 'fills'],
    ]);
    expect(plan.entries.map((entry) => [entry.action, entry.amount, entry.operationIds])).toEqual([
      ['fee', '0.5', ['450000002']],
      ['buy', '200', ['450000006']],
    ]);
  });

  it('lists an order too small to split into its fill times instead of a part that cost nothing', () => {
    const plan = planImport([
      op({
        id: '460000001',
        quantity: '2',
        payment: '-0.01',
        fills: [
          { filledAt: '2024-03-01T10:00:00Z', quantity: '1', price: '0.005', priceCurrency: 'rub' },
          { filledAt: '2024-03-01T12:00:00Z', quantity: '1', price: '0.005', priceCurrency: 'rub' },
        ],
      }),
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['460000001', 'fills'],
    ]);
  });

  it('lists an order whose fills at several times carry a price below zero', () => {
    const plan = planImport([
      op({
        id: '490000001',
        fills: [
          { filledAt: '2024-03-01T10:00:00Z', quantity: '1', price: '100', priceCurrency: 'rub' },
          { filledAt: '2024-03-01T12:00:00Z', quantity: '1', price: '-100', priceCurrency: 'rub' },
        ],
      }),
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['490000001', 'fills'],
    ]);
  });

  it('lists a trade, fill or repayment with a negative quantity instead of recording it', () => {
    const at = '2024-03-01T10:00:00Z';
    const plan = planImport([
      op({ id: '480000001', quantity: '-2' }),
      cash('OPERATION_TYPE_BROKER_FEE', '-0.1', { id: '480000002', parentId: '480000001' }),
      op({
        id: '480000003',
        quantity: '2',
        fills: [
          { filledAt: at, quantity: '3', price: '100', priceCurrency: 'rub' },
          { filledAt: at, quantity: '-1', price: '100', priceCurrency: 'rub' },
        ],
      }),
      op({
        id: '480000004',
        type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL',
        quantity: '-1',
        payment: '100',
      }),
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['480000001', 'no-quantity'],
      ['480000003', 'fills'],
      ['480000004', 'no-quantity'],
    ]);
    expect(plan.entries.map((entry) => [entry.action, entry.amount, entry.operationIds])).toEqual([
      ['fee', '0.1', ['480000002']],
    ]);
  });

  it.each(['OPERATION_TYPE_BOND_REPAYMENT', 'OPERATION_TYPE_BOND_REPAYMENT_FULL'])(
    'BROKER-CAPRET refuses a negative quantity on %s even when bonds are held',
    (type) => {
      const buy = op({
        id: '480000010',
        instrumentType: 'bond',
        occurredAt: '2024-02-01T10:00:00Z',
      });
      const repayment = op({
        id: '480000011',
        type,
        instrumentType: 'bond',
        quantity: '-1',
        payment: '100',
      });
      const plan = planImport([buy, repayment]);
      expect(plan.skipped).toContainEqual({
        operationId: repayment.id,
        type,
        reason: 'no-quantity',
      });
      expect(plan.entries.some((entry) => entry.operationIds.includes(repayment.id))).toBe(false);
    },
  );

  it('BROKER-CARD pays a card buy from the cash T-Bank lists as paid in, keeps card sales off broker cash and identifies outside dividends', () => {
    const plan = planImport([
      // T-Bank lists the card's money as paid in a moment before the buy it pays for.
      cash('OPERATION_TYPE_INPUT', '100.2', {
        id: '470000005',
        occurredAt: '2024-03-01T09:59:59Z',
      }),
      op({ id: '470000001', type: 'OPERATION_TYPE_BUY_CARD' }),
      cash('OPERATION_TYPE_BROKER_FEE', '-0.2', { id: '470000002', parentId: '470000001' }),
      op({ id: '470000003', type: 'OPERATION_TYPE_SELL_CARD', payment: '200' }),
      cash('OPERATION_TYPE_DIV_EXT', '15', { id: '470000004', instrumentUid: share }),
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['470000004', 'outside-dividend'],
    ]);
    expect(
      plan.entries
        .filter((entry) => entry.action === 'buy' || entry.action === 'sell')
        .map((entry) => [entry.action, entry.externalCash, entry.fee, entry.operationIds]),
    ).toEqual([
      ['buy', undefined, '0.2', ['470000001', '470000002']],
      ['sell', true, '0', ['470000003']],
    ]);
    expect(plan.entries.some((entry) => entry.action === 'fee')).toBe(false);
  });

  it('sells units bought at the very same instant, and lists a trade T-Bank does not classify', () => {
    const at = '2024-03-05T10:00:00.123456789Z';
    const plan = planImport([
      op({
        id: '500000011',
        type: 'OPERATION_TYPE_SELL',
        quantity: '1',
        payment: '101',
        occurredAt: at,
      }),
      op({ id: '500000010', quantity: '1', payment: '-100', occurredAt: at }),
      op({ id: '500000012', instrumentType: '', occurredAt: '2024-03-06T10:00:00Z' }),
    ]);
    expect(plan.entries.map((entry) => [entry.action, entry.operationIds[0]])).toEqual([
      ['buy', '500000010'],
      ['sell', '500000011'],
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['500000012', 'no-instrument'],
    ]);
  });

  it('lists a buy that covers a sale of units never held instead of inventing a holding', () => {
    const at = (day: string) => `2024-03-${day}T10:00:00Z`;
    const plan = planImport([
      op({
        id: '510000001',
        type: 'OPERATION_TYPE_SELL_MARGIN',
        payment: '200',
        occurredAt: at('01'),
      }),
      op({
        id: '510000002',
        type: 'OPERATION_TYPE_BUY_MARGIN',
        quantity: '1',
        payment: '-90',
        occurredAt: at('02'),
      }),
      cash('OPERATION_TYPE_BROKER_FEE', '-0.1', { id: '510000003', parentId: '510000002' }),
      op({ id: '510000004', quantity: '1', payment: '-95', occurredAt: at('03') }),
      op({ id: '510000005', quantity: '3', payment: '-300', occurredAt: at('04') }),
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['510000001', 'not-held'],
      ['510000002', 'short-cover'],
      ['510000004', 'short-cover'],
    ]);
    expect(plan.entries.map((entry) => [entry.action, entry.quantity, entry.operationIds])).toEqual(
      [
        ['fee', '0.1', ['510000003']],
        ['buy', '3', ['510000005']],
      ],
    );
  });

  it('keeps the fee of a sale it lists as not held as money spent', () => {
    const sale = op({
      id: '400000011',
      type: 'OPERATION_TYPE_SELL',
      quantity: '1',
      payment: '100',
    });
    const plan = planImport([
      sale,
      cash('OPERATION_TYPE_BROKER_FEE', '-0.5', { id: '400000012', parentId: sale.id }),
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['400000011', 'not-held'],
    ]);
    expect(
      plan.entries.map((entry) => [entry.action, entry.amount, entry.currency, entry.operationIds]),
    ).toEqual([['fee', '0.5', 'rub', ['400000012']]]);
  });

  it('lists a sale of more than the history holds instead of selling what was never bought', () => {
    const plan = planImport([
      // A share the history never shows bought.
      op({
        id: '400000003',
        type: 'OPERATION_TYPE_SELL',
        instrumentUid: '00000000-0000-4000-8000-000000000009',
        quantity: '1',
        payment: '100',
      }),
      op({ id: '400000004', quantity: '2', occurredAt: '2024-03-02T10:00:00Z' }),
      op({
        id: '400000005',
        type: 'OPERATION_TYPE_SELL',
        quantity: '3',
        payment: '300',
        occurredAt: '2024-03-03T10:00:00Z',
      }),
      op({
        id: '400000006',
        type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL',
        quantity: '0',
        payment: '200',
        occurredAt: '2024-03-04T10:00:00Z',
      }),
    ]);
    expect(plan.skipped).toEqual([
      { operationId: '400000003', type: 'OPERATION_TYPE_SELL', reason: 'not-held' },
      { operationId: '400000005', type: 'OPERATION_TYPE_SELL', reason: 'not-held' },
    ]);
    // The repayment still sells the two units really held.
    expect(plan.entries.map((entry) => [entry.action, entry.quantity])).toEqual([
      ['buy', '2'],
      ['sell', '2'],
    ]);
  });

  it('lists what it cannot record instead of guessing, and ignores what did not happen', () => {
    const plan = planImport([
      op({ id: '200000001', type: 'OPERATION_TYPE_SOMETHING_NEW' }),
      op({ id: '200000002', type: 'OPERATION_TYPE_INPUT_SECURITIES' }),
      op({ id: '200000003', quantity: '0' }),
      // A buy that moved shares for no money is not nothing: it is listed, not ignored.
      op({ id: '200000004', payment: '0' }),
      op({ id: '200000005', state: 'canceled' }),
      op({ id: '200000006', paymentCurrency: 'cny' }),
      cash('OPERATION_TYPE_BROKER_FEE', '-1', {
        id: '200000007',
        parentId: '200000006',
        paymentCurrency: 'cny',
      }),
      op({ id: '200000008', instrumentUid: '' }),
      op({
        id: '200000009',
        instrumentType: 'currency',
        ticker: 'USD000UTSTOM',
        payment: '-200',
        paymentCurrency: 'usd',
      }),
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['200000001', 'unsupported'],
      ['200000002', 'transfer'],
      ['200000003', 'no-quantity'],
      ['200000004', 'no-payment'],
      ['200000006', 'currency'],
      ['200000007', 'currency'],
      ['200000008', 'no-instrument'],
      ['200000009', 'currency-exchange'],
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
    // 20:59 and 21:00 UTC on one UTC day are two Moscow days.
    const edge = planImport([
      ...busy,
      op({ occurredAt: '2024-06-01T20:59:00Z', quantity: '1', payment: '-10' }),
      op({ occurredAt: '2024-06-01T21:00:00Z', quantity: '1', payment: '-10' }),
    ]).entries.filter((entry) => entry.occurredAt.startsWith('2024-06-01'));
    expect(edge.map((entry) => entry.quantity)).toEqual(['1', '1']);

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

  // 901 buys of another share, one a day, so the account is combined (by month in the end).
  const filler = () =>
    Array.from({ length: 901 }, (_, index) =>
      op({
        instrumentUid: '00000000-0000-4000-8000-0000000000ff',
        occurredAt: new Date(Date.UTC(2022, 0, 1) + index * 86_400_000)
          .toISOString()
          .replace('.000', ''),
      }),
    );
  const busyDay = (plan: ReturnType<typeof planImport>) =>
    plan.entries.filter((entry) => entry.occurredAt.startsWith('2024-06-03'));

  it('keeps a buy, a sale and a buy of one share apart when combining, in their order', () => {
    const day = (time: string, over: Partial<TBankOperation>) =>
      op({ occurredAt: `2024-06-03T${time}Z`, quantity: '1', ...over });
    const plan = planImport([
      ...filler(),
      day('07:00:00', { id: '400000001' }),
      day('08:00:00', { id: '400000002' }),
      day('09:00:00', { id: '400000003', type: 'OPERATION_TYPE_SELL', payment: '110' }),
      day('12:00:00', { id: '400000004' }),
    ]);
    expect(plan.grouping).toBe('month');
    expect(busyDay(plan).map((entry) => [entry.action, entry.quantity, entry.occurredAt])).toEqual([
      // A run of buys is dated by its last buy, before the sale that follows it.
      ['buy', '2', '2024-06-03T08:00:00Z'],
      ['sell', '1', '2024-06-03T09:00:00Z'],
      ['buy', '1', '2024-06-03T12:00:00Z'],
    ]);
  });

  it('dates combined money in by its first part and money out by its last', () => {
    const at = (time: string) => `2024-06-03T${time}Z`;
    const plan = planImport([
      ...filler(),
      cash('OPERATION_TYPE_INPUT', '100', { occurredAt: at('06:00:00') }),
      cash('OPERATION_TYPE_INPUT', '100', { occurredAt: at('17:00:00') }),
      op({ occurredAt: at('10:00:00'), payment: '-150', quantity: '1' }),
      cash('OPERATION_TYPE_OUTPUT', '-10', { occurredAt: at('11:00:00') }),
      cash('OPERATION_TYPE_OUTPUT', '-10', { occurredAt: at('18:00:00') }),
    ]);
    expect(busyDay(plan).map((entry) => [entry.action, entry.amount, entry.occurredAt])).toEqual([
      ['deposit', '200', at('06:00:00')],
      ['buy', '150', at('10:00:00')],
      ['withdrawal', '20', at('18:00:00')],
    ]);
  });

  it('keeps each dividend with the share that paid it, never combined', () => {
    const other = '00000000-0000-4000-8000-0000000000aa';
    const plan = planImport([
      ...filler(),
      cash('OPERATION_TYPE_DIVIDEND', '5', {
        occurredAt: '2024-06-03T09:00:00Z',
        ticker: 'SYNTH',
        instrumentUid: share,
      }),
      cash('OPERATION_TYPE_DIVIDEND', '6', {
        occurredAt: '2024-06-03T10:00:00Z',
        ticker: 'OTHER',
        instrumentUid: other,
      }),
      cash('OPERATION_TYPE_DIVIDEND', '7', {
        occurredAt: '2024-06-03T11:00:00Z',
        ticker: 'SYNTH',
        instrumentUid: share,
      }),
    ]);
    expect(
      busyDay(plan).map((entry) => [
        entry.instrumentUid,
        entry.paidBy?.ticker,
        entry.paidBy?.instrumentUid,
        entry.amount,
      ]),
    ).toEqual([
      ['', 'SYNTH', share, '5'],
      ['', 'OTHER', other, '6'],
      ['', 'SYNTH', share, '7'],
    ]);
  });

  it('lists an operation whose amount has the wrong sign instead of turning it around', () => {
    const buy = op({ id: '500000001' });
    const plan = planImport([
      buy,
      cash('OPERATION_TYPE_BROKER_FEE', '0.5', { id: '500000002', parentId: buy.id }),
      cash('OPERATION_TYPE_DIVIDEND', '-4', { id: '500000003' }),
      cash('OPERATION_TYPE_INPUT', '-100', { id: '500000004' }),
      cash('OPERATION_TYPE_OUTPUT', '100', { id: '500000005' }),
      op({ id: '500000006', payment: '200' }),
      op({ id: '500000007', type: 'OPERATION_TYPE_SELL', payment: '-200' }),
    ]);
    // A fee given back for a trade is money received, not a cost of the trade.
    expect(plan.entries.map((entry) => [entry.action, entry.fee, entry.operationIds])).toEqual([
      ['income', '0', ['500000002']],
      ['buy', '0', ['500000001']],
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['500000003', 'sign'],
      ['500000004', 'sign'],
      ['500000005', 'sign'],
      ['500000006', 'sign'],
      ['500000007', 'sign'],
    ]);
  });

  it('orders operations of one instant by T-Bank number, not as text', () => {
    const plan = planImport([
      cash('OPERATION_TYPE_INPUT', '1', { id: '10' }),
      cash('OPERATION_TYPE_INPUT', '2', { id: '9' }),
    ]);
    expect(plan.entries.map((entry) => entry.operationIds[0])).toEqual(['9', '10']);
  });

  it('says when an account does not fit even combined by month', () => {
    const many = Array.from({ length: 1001 }, (_, index) =>
      op({ instrumentUid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }),
    );
    const plan = planImport(many);
    expect([plan.grouping, plan.trades, plan.fitsTradeLimit]).toEqual(['month', 1001, false]);
  });

  it('says when an account has more rewards than the reward journal keeps', () => {
    const paid = (count: number) =>
      Array.from({ length: count }, () =>
        cash('OPERATION_TYPE_DIVIDEND', '1', { instrumentUid: share }),
      );
    expect([planImport(paid(1000)).rewards, planImport(paid(1000)).fitsRewardLimit]).toEqual([
      1000,
      true,
    ]);
    expect([planImport(paid(1001)).rewards, planImport(paid(1001)).fitsRewardLimit]).toEqual([
      1001,
      false,
    ]);
  });
});

describe('BROKER-SYNC-FX: currencies and gold bought on the exchange', () => {
  const dollars = '00000000-0000-4000-8000-0000000000d1';
  const euros = '00000000-0000-4000-8000-0000000000e1';
  const gold = '00000000-0000-4000-8000-0000000000f1';
  const fx = (ticker: string, instrumentUid: string, over: Partial<TBankOperation>) =>
    op({
      instrumentUid,
      ticker,
      instrumentType: 'currency',
      price: '',
      priceCurrency: '',
      ...over,
    });

  it('buys and sells dollars and euros as cash paid in rubles, not as assets', () => {
    const buy = fx('USD000UTSTOM', dollars, {
      id: '600000001',
      quantity: '1000',
      payment: '-90000',
    });
    const fee = cash('OPERATION_TYPE_BROKER_FEE', '-45', { id: '600000002', parentId: buy.id });
    const plan = planImport([
      buy,
      fee,
      fx('EUR_RUB__TOM', euros, {
        id: '600000003',
        quantity: '100',
        payment: '-10000',
        occurredAt: '2024-03-02T10:00:00Z',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '600000004',
        type: 'OPERATION_TYPE_SELL',
        quantity: '400',
        payment: '37000',
        occurredAt: '2024-03-03T10:00:00Z',
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.map((entry) => [
        entry.action,
        entry.cash,
        entry.quantity,
        entry.amount,
        entry.fee,
        entry.currency,
        entry.operationIds,
      ]),
    ).toEqual([
      ['buy', 'usd', '1000', '90000', '45', 'rub', ['600000001', '600000002']],
      ['buy', 'eur', '100', '10000', '0', 'rub', ['600000003']],
      ['sell', 'usd', '400', '37000', '0', 'rub', ['600000004']],
    ]);
  });

  it('sells dollars the history never shows bought: whether they came in unseen is left to the cash check', () => {
    const plan = planImport([
      fx('USD000UTSTOM', dollars, {
        id: '610000001',
        type: 'OPERATION_TYPE_SELL',
        quantity: '5',
        payment: '450',
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.entries.map((entry) => [entry.action, entry.cash])).toEqual([['sell', 'usd']]);
  });

  it('never combines dollar or euro trades, since a later trade may spend that cash', () => {
    const busy = Array.from({ length: 950 }, (_, index) =>
      op({
        occurredAt: new Date(Date.UTC(2024, 0, 1 + Math.floor(index / 10), 9, 0, index % 10))
          .toISOString()
          .replace('.000', ''),
        quantity: '1',
        payment: '-10',
      }),
    );
    const plan = planImport([
      ...busy,
      fx('USD000UTSTOM', dollars, {
        id: '630000001',
        quantity: '1000',
        payment: '-90000',
        occurredAt: '2024-03-04T07:00:00Z',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '630000002',
        quantity: '500',
        payment: '-45000',
        occurredAt: '2024-03-04T12:00:00Z',
      }),
    ]);
    expect(plan.grouping).toBe('day');
    expect(
      plan.entries
        .filter((entry) => entry.cash)
        .map((entry) => [entry.occurredAt, entry.quantity, entry.operationIds]),
    ).toEqual([
      ['2024-03-04T07:00:00Z', '1000', ['630000001']],
      ['2024-03-04T12:00:00Z', '500', ['630000002']],
    ]);
  });

  it('buys dollars before a same-instant security bought with them, whatever the operation ids', () => {
    const plan = planImport([
      op({
        id: '800000001',
        occurredAt: '2024-03-05T10:00:00Z',
        paymentCurrency: 'usd',
        payment: '-600',
        quantity: '2',
        price: '300',
        priceCurrency: 'usd',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '800000002',
        quantity: '1000',
        payment: '-90000',
        occurredAt: '2024-03-05T10:00:00Z',
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.map((entry) => [entry.action, entry.cash ?? '', entry.operationIds]),
    ).toEqual([
      ['buy', 'usd', ['800000002']],
      ['buy', '', ['800000001']],
    ]);
  });

  it('keeps a same-instant security bought with exchange cash after the cash it needs', () => {
    const at = '2024-03-05T10:00:00Z';
    const plan = planImport([
      op({
        id: '810000001',
        occurredAt: '2024-03-01T10:00:00Z',
        quantity: '2',
        payment: '-1000',
        price: '500',
      }),
      op({
        id: '820000001',
        occurredAt: at,
        quantity: '1',
        payment: '-150',
        paymentCurrency: 'usd',
        price: '150',
        priceCurrency: 'usd',
      }),
      op({
        id: '820000002',
        type: 'OPERATION_TYPE_SELL',
        occurredAt: at,
        quantity: '1',
        payment: '150',
        paymentCurrency: 'usd',
        price: '150',
        priceCurrency: 'usd',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '820000003',
        quantity: '1000',
        payment: '-90000',
        occurredAt: at,
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.slice(1).map((entry) => [entry.action, entry.cash ?? '', entry.operationIds[0]]),
    ).toEqual([
      ['buy', 'usd', '820000003'],
      ['buy', '', '820000001'],
      ['sell', '', '820000002'],
    ]);
  });

  it('hoists a same-instant security buy over its sale even when unrelated exchange cash is bought', () => {
    const at = '2024-03-06T10:00:00Z';
    const plan = planImport([
      op({ id: '830000001', occurredAt: at, quantity: '1', payment: '-100', price: '100' }),
      op({
        id: '830000002',
        type: 'OPERATION_TYPE_SELL',
        occurredAt: at,
        quantity: '1',
        payment: '100',
        price: '100',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '830000003',
        quantity: '100',
        payment: '-9000',
        occurredAt: at,
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.map((entry) => [entry.action, entry.cash ?? '', entry.operationIds[0]]),
    ).toEqual([
      ['buy', '', '830000001'],
      ['sell', '', '830000002'],
      ['buy', 'usd', '830000003'],
    ]);
  });

  it('buys dollars, then the security bought with them and sold at the same instant, with no holding before', () => {
    const at = '2024-03-07T10:00:00Z';
    const plan = planImport([
      op({
        id: '840000001',
        occurredAt: at,
        paymentCurrency: 'usd',
        payment: '-150',
        quantity: '1',
        price: '150',
        priceCurrency: 'usd',
      }),
      op({
        id: '840000002',
        type: 'OPERATION_TYPE_SELL',
        occurredAt: at,
        paymentCurrency: 'usd',
        payment: '150',
        quantity: '1',
        price: '150',
        priceCurrency: 'usd',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '840000003',
        quantity: '1000',
        payment: '-90000',
        occurredAt: at,
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.map((entry) => [entry.action, entry.cash ?? '', entry.operationIds[0]]),
    ).toEqual([
      ['buy', 'usd', '840000003'],
      ['buy', '', '840000001'],
      ['sell', '', '840000002'],
    ]);
  });

  it('keeps a same-instant sale ahead of the dollars its rubles buy, even when a buy is hoisted over it', () => {
    const at = '2024-03-08T10:00:00Z';
    const share = '00000000-0000-4000-8000-0000000000a1';
    const plan = planImport([
      op({
        id: '850000001',
        occurredAt: '2024-03-07T10:00:00Z',
        instrumentUid: share,
        quantity: '1',
        payment: '-100',
        price: '100',
      }),
      op({
        id: '850000002',
        type: 'OPERATION_TYPE_SELL',
        occurredAt: at,
        instrumentUid: share,
        quantity: '1',
        payment: '100',
        price: '100',
      }),
      fx('USD000UTSTOM', dollars, {
        id: '850000003',
        quantity: '1000',
        payment: '-90000',
        occurredAt: at,
      }),
      op({
        id: '850000004',
        occurredAt: at,
        instrumentUid: share,
        paymentCurrency: 'usd',
        payment: '-90',
        quantity: '1',
        price: '90',
        priceCurrency: 'usd',
      }),
    ]);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.entries.map((entry) => [entry.action, entry.cash ?? '', entry.operationIds[0]]),
    ).toEqual([
      ['buy', '', '850000001'],
      ['sell', '', '850000002'],
      ['buy', 'usd', '850000003'],
      ['buy', '', '850000004'],
    ]);
  });

  it('keeps a same-instant sale ahead of the buy of its share when asked not to hoist', () => {
    const share = '00000000-0000-4000-8000-0000000000a2';
    const operations = [
      op({
        id: '860000001',
        occurredAt: '2024-03-07T10:00:00Z',
        instrumentUid: share,
        quantity: '1',
        payment: '-100',
        price: '100',
      }),
      op({
        id: '860000002',
        type: 'OPERATION_TYPE_SELL',
        occurredAt: '2024-03-08T10:00:00Z',
        instrumentUid: share,
        quantity: '1',
        payment: '150',
        price: '150',
      }),
      op({
        id: '860000003',
        occurredAt: '2024-03-08T10:00:00Z',
        instrumentUid: share,
        quantity: '1',
        payment: '-150',
        price: '150',
      }),
    ];
    const order = (plan: ReturnType<typeof planImport>) =>
      plan.entries.map((entry) => [entry.action, entry.operationIds[0]]);
    expect(order(planImport(operations))).toEqual([
      ['buy', '860000001'],
      ['buy', '860000003'],
      ['sell', '860000002'],
    ]);
    expect(order(planImport(operations, { hoist: false }))).toEqual([
      ['buy', '860000001'],
      ['sell', '860000002'],
      ['buy', '860000003'],
    ]);
  });

  it('keeps an alternating sale, buy and sale of one share at one instant in operation order when not hoisting', () => {
    const share = '00000000-0000-4000-8000-0000000000a3';
    const at = '2024-03-08T10:00:00Z';
    const plan = planImport(
      [
        op({
          id: '870000001',
          occurredAt: '2024-03-07T10:00:00Z',
          instrumentUid: share,
          quantity: '1',
          payment: '-100',
          price: '100',
        }),
        op({
          id: '870000002',
          type: 'OPERATION_TYPE_SELL',
          occurredAt: at,
          instrumentUid: share,
          quantity: '1',
          payment: '150',
          price: '150',
        }),
        op({
          id: '870000003',
          occurredAt: at,
          instrumentUid: share,
          quantity: '1',
          payment: '-150',
          price: '150',
        }),
        op({
          id: '870000004',
          type: 'OPERATION_TYPE_SELL',
          occurredAt: at,
          instrumentUid: share,
          quantity: '1',
          payment: '160',
          price: '160',
        }),
      ],
      { hoist: false },
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.entries.map((entry) => [entry.action, entry.operationIds[0]])).toEqual([
      ['buy', '870000001'],
      ['sell', '870000002'],
      ['buy', '870000003'],
      ['sell', '870000004'],
    ]);
  });

  it('keeps gold and currencies the app does not keep as cash as assets priced in rubles', () => {
    const plan = planImport([
      fx('GLDRUB_TOM', gold, { id: '620000001', quantity: '10', payment: '-70000' }),
      fx('GLDRUB_TOM', gold, {
        id: '620000002',
        type: 'OPERATION_TYPE_SELL',
        quantity: '10',
        payment: '72000',
        occurredAt: '2024-03-02T10:00:00Z',
      }),
      fx('GLDRUB_TOM', gold, {
        id: '620000003',
        type: 'OPERATION_TYPE_SELL',
        quantity: '1',
        payment: '7000',
        occurredAt: '2024-03-03T10:00:00Z',
      }),
    ]);
    expect(
      plan.entries.map((entry) => [entry.action, entry.cash, entry.instrumentUid, entry.quantity]),
    ).toEqual([
      ['buy', undefined, gold, '10'],
      ['sell', undefined, gold, '10'],
    ]);
    // Gold is held like a security, so a sale of more than was bought is listed.
    expect(plan.skipped).toEqual([
      { operationId: '620000003', type: 'OPERATION_TYPE_SELL', reason: 'not-held' },
    ]);
  });
});

describe('BROKER-SYNC: operations without money', () => {
  it('ignores a fee of nothing but lists a trade or repayment that moved units for nothing', () => {
    const plan = planImport([
      cash('OPERATION_TYPE_BROKER_FEE', '0', { id: '700000001' }),
      op({ id: '700000002', type: 'OPERATION_TYPE_SELL', payment: '0', quantity: '1' }),
      op({
        id: '700000003',
        type: 'OPERATION_TYPE_BOND_REPAYMENT_FULL',
        payment: '0',
        quantity: '0',
      }),
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      ['700000001', 'no-amount'],
      ['700000002', 'no-payment'],
      ['700000003', 'no-payment'],
    ]);
  });
});

describe('BROKER-CAPRET: a part of a bond paid back', () => {
  const part = (over: Partial<TBankOperation> = {}) =>
    op({
      type: 'OPERATION_TYPE_BOND_REPAYMENT',
      payment: '250',
      quantity: '0',
      occurredAt: '2024-01-15T10:00:00Z',
      ...over,
    });
  const buy = (over: Partial<TBankOperation> = {}) =>
    op({ quantity: '2', payment: '-1980', occurredAt: '2024-01-01T10:00:00Z', ...over });

  it('lists a part paid back on units the history never shows held, not recording a cost to lower', () => {
    const lone = part({ id: '800000001' });
    const plan = planImport([lone]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped).toEqual([
      { operationId: lone.id, type: 'OPERATION_TYPE_BOND_REPAYMENT', reason: 'not-held' },
    ]);
  });

  it('lists a part paid back after the units were all sold', () => {
    const late = part({ id: '800000002', occurredAt: '2024-02-01T10:00:00Z' });
    const plan = planImport([
      buy(),
      op({
        type: 'OPERATION_TYPE_SELL',
        quantity: '2',
        payment: '2100',
        occurredAt: '2024-01-20T10:00:00Z',
      }),
      late,
    ]);
    expect(plan.skipped.map((item) => [item.operationId, item.reason])).toEqual([
      [late.id, 'not-held'],
    ]);
    expect(plan.capitalReturns).toBe(0);
  });

  it('keeps each part apart when combining a busy account, and counts none as a trade', () => {
    const operations = [buy({ quantity: '5', payment: '-4950' })];
    for (let day = 0; day < 1000; day += 1)
      operations.push(
        op({
          id: `7${String(day).padStart(8, '0')}`,
          type: day % 2 === 0 ? 'OPERATION_TYPE_BUY' : 'OPERATION_TYPE_SELL',
          quantity: '1',
          payment: day % 2 === 0 ? '-100' : '100',
          instrumentUid: '00000000-0000-4000-8000-000000000002',
          ticker: 'OTHER',
          occurredAt: new Date(Date.UTC(2024, 0, 2) + day * 3_600_000).toISOString(),
        }),
      );
    operations.push(
      part({ id: '800000003' }),
      part({ id: '800000004', occurredAt: '2024-01-16T10:00:00Z' }),
    );
    const plan = planImport(operations);
    expect(plan.grouping).not.toBe('operation');
    expect(plan.capitalReturns).toBe(2);
    expect(plan.entries.filter((entry) => entry.record === 'capital-return')).toHaveLength(2);
    expect(plan.fitsCapitalReturnLimit).toBe(true);
  });

  it('never combines the buys of a bond across a part paid back, so the units held then stay as they were', () => {
    const operations = [
      buy({ id: '800000010', quantity: '1', payment: '-990', occurredAt: '2024-01-02T10:00:00Z' }),
      part({ id: '800000011', occurredAt: '2024-01-15T10:00:00Z' }),
      buy({ id: '800000012', quantity: '1', payment: '-990', occurredAt: '2024-01-28T10:00:00Z' }),
    ];
    // Distinct instruments cannot be combined, so the account stays over the combine threshold
    // and the bond's own buys are what is merged by month.
    for (let index = 0; index < 950; index += 1)
      operations.push(
        op({
          id: `6${String(index).padStart(8, '0')}`,
          quantity: '1',
          payment: '-1',
          instrumentUid: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
          ticker: `T${index}`,
          occurredAt: '2024-01-03T10:00:00Z',
        }),
      );
    const plan = planImport(operations);
    expect(plan.grouping).toBe('month');
    const bond = plan.entries.filter((entry) => entry.instrumentUid === share);
    expect(bond.map((entry) => [entry.action, entry.occurredAt, entry.operationIds])).toEqual([
      ['buy', '2024-01-02T10:00:00Z', ['800000010']],
      ['return', '2024-01-15T10:00:00Z', ['800000011']],
      ['buy', '2024-01-28T10:00:00Z', ['800000012']],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('puts a part paid back ahead of a sale of the same instant, which may sell the units it lowers', () => {
    const sale = op({
      id: '800000005',
      type: 'OPERATION_TYPE_SELL',
      quantity: '2',
      payment: '1500',
      occurredAt: '2024-01-15T10:00:00Z',
    });
    const plan = planImport([buy(), sale, part({ id: '800000006' })]);
    expect(plan.entries.map((entry) => entry.action)).toEqual(['buy', 'return', 'sell']);
    expect(plan.skipped).toEqual([]);
  });

  it('lists a part paid back in a currency the app does not keep', () => {
    const plan = planImport([buy(), part({ id: '800000007', paymentCurrency: 'gbp' })]);
    expect(plan.capitalReturns).toBe(0);
    expect(plan.skipped.map((item) => item.reason)).toEqual(['currency']);
  });

  it('lists a part paid back with no instrument, which names no units to lower', () => {
    const plan = planImport([
      buy(),
      part({ id: '800000008', instrumentUid: '', instrumentType: '', ticker: '' }),
    ]);
    expect(plan.capitalReturns).toBe(0);
    expect(plan.skipped.map((item) => item.reason)).toEqual(['no-instrument']);
  });
});
