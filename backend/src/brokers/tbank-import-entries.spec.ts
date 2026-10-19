import { calculateOwnedTransfers } from '../accounting/owned-transfer-fifo';
import type { FxRates } from '../fx-rates/fx-conversion';
import { type ImportInstruments, journalEntries, journalTime } from './tbank-import-entries';
import type { PlanEntry } from './tbank-import-plan';

// BROKER-SYNC: synthetic instruments, rates and amounts only; never an owner's account.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const share = '10000000-0000-4000-8000-000000000001';
const instruments: ImportInstruments = {
  cash: {
    RUB: { id: id(1), name: 'Russian ruble', symbol: 'RUB' },
    USD: { id: id(2), name: 'US dollar', symbol: 'USD' },
    EUR: { id: id(3), name: 'Euro', symbol: 'EUR' },
  },
  securities: new Map([[share, { id: id(4), name: 'SYNTH', symbol: 'SYNTH' }]]),
};
const rates: FxRates = {
  USD: [{ date: '2024-03-01', rubPerUnit: '90' }],
  EUR: [{ date: '2024-03-01', rubPerUnit: '100' }],
};
const entry = (over: Partial<PlanEntry>): PlanEntry => ({
  record: 'trade',
  action: 'deposit',
  occurredAt: '2024-03-01T10:00:00Z',
  instrumentUid: '',
  ticker: '',
  instrumentType: '',
  quantity: '900',
  amount: '900',
  fee: '0',
  currency: 'rub',
  operationIds: ['1'],
  ...over,
});
const buy = (over: Partial<PlanEntry> = {}) =>
  entry({
    action: 'buy',
    instrumentUid: share,
    ticker: 'SYNTH',
    instrumentType: 'share',
    quantity: '2',
    amount: '450',
    fee: '9',
    ...over,
  });

describe('BROKER-SYNC: the journal entries a T-Bank import writes', () => {
  it('BROKER-CARD never spends or credits broker cash for card trades', () => {
    const { entries, problems } = journalEntries(
      [buy({ externalCash: true }), buy({ externalCash: true, action: 'sell' })],
      instruments,
      rates,
    );
    expect(problems).toEqual([]);
    expect(entries.map((entry) => entry.trade?.settlement)).toEqual([undefined, undefined]);
    expect(entries.map((entry) => entry.trade?.instrumentId)).toEqual([id(4), id(4)]);
  });

  it('buys cash from outside for money paid in and settles a buy in full from that cash', () => {
    const { entries, problems } = journalEntries(
      [entry({}), buy({ amount: '1000', fee: '0' })],
      instruments,
      rates,
    );
    expect(problems).toEqual([]);
    const [deposit, purchase] = entries.map((item) => item.trade!);
    expect(deposit).toMatchObject({
      instrumentId: id(1),
      side: 'buy',
      quantity: '900',
      grossUsd: '10',
      feeUsd: '0',
      paid: { currency: 'RUB', gross: '900', fee: '0', rateSource: 'bank-of-russia' },
    });
    expect(deposit.settlement).toBeUndefined();
    // The whole 1000 is spent from cash, never partly from outside: the history holds every
    // ruble paid in, so 900 held is a shortfall the journal's own check refuses.
    expect(purchase).toMatchObject({
      instrumentId: id(4),
      side: 'buy',
      quantity: '2',
      paid: { currency: 'RUB', gross: '1000', fee: '0' },
      settlement: { instrumentId: id(1), quantity: '1000' },
    });
    expect(() =>
      calculateOwnedTransfers(
        [
          {
            accountId: id(9),
            coverageFrom: '1970-01-01T00:00:00.000Z',
            trades: entries.map((item) => item.trade!),
            initialLots: [],
          },
        ],
        [],
      ),
    ).toThrow();
    // Same millisecond: numbered in plan order.
    expect(entries.map((item) => item.trade!.orderWithinTimestamp)).toEqual([0, 1]);
  });

  it('refuses a sale whose fee is more than it brought, instead of dropping the rest of the fee', () => {
    const { entries, problems } = journalEntries(
      [buy({ action: 'sell', amount: '0.5', fee: '1', operationIds: ['5'] })],
      instruments,
      rates,
    );
    expect(entries).toEqual([]);
    expect(problems).toEqual([
      { reason: 'fee-above-proceeds', occurredAt: '2024-03-01T10:00:00.000Z', operationIds: ['5'] },
    ]);
  });

  it('keeps a sale net of fee as cash and spends taxes and fees from cash as a fee', () => {
    const { entries } = journalEntries(
      [
        buy({ occurredAt: '2024-03-01T10:00:00Z' }),
        buy({ action: 'sell', amount: '500', fee: '5', occurredAt: '2024-03-02T10:00:00Z' }),
        entry({ action: 'tax', amount: '45', quantity: '45', occurredAt: '2024-03-03T10:00:00Z' }),
        entry({ action: 'withdrawal', occurredAt: '2024-03-04T10:00:00Z', amount: '450' }),
      ],
      instruments,
      rates,
    );
    const [, sale, tax, withdrawal] = entries.map((item) => item.trade!);
    expect(sale.settlement).toMatchObject({ instrumentId: id(1), quantity: '495' });
    expect(tax).toMatchObject({
      instrumentId: id(1),
      side: 'sell',
      quantity: '45',
      grossUsd: '0.5',
      feeUsd: '0.5',
      purpose: 'fee',
    });
    expect(tax.paid).toBeUndefined();
    expect(withdrawal).toMatchObject({ side: 'sell', quantity: '450', grossUsd: '5' });
    expect(withdrawal.settlement).toBeUndefined();
  });

  it('records income as a cash reward valued at its date, in its own currency', () => {
    const { entries } = journalEntries(
      [entry({ record: 'reward', action: 'income', amount: '3', quantity: '3', currency: 'usd' })],
      instruments,
      rates,
    );
    expect(entries[0].reward).toMatchObject({
      instrumentId: id(2),
      category: 'other',
      quantity: '3',
      acquisitionBasisUsd: '3',
      incomeValueUsd: '3',
    });
  });

  it('lets a buy spend income received as cash', () => {
    const { entries } = journalEntries(
      [entry({ record: 'reward', action: 'income', amount: '500', quantity: '500' }), buy()],
      instruments,
      rates,
    );
    const { lots } = calculateOwnedTransfers(
      [
        {
          accountId: id(9),
          coverageFrom: '1970-01-01T00:00:00.000Z',
          trades: entries.flatMap((item) => (item.trade ? [item.trade] : [])),
          rewards: entries.flatMap((item) => (item.reward ? [item.reward] : [])),
          initialLots: [],
        },
      ],
      [],
    ).accounts.get(id(9))!;
    // 500 received, 459 spent on the buy.
    expect(
      lots.filter((lot) => lot.instrumentId === id(1)).map((lot) => lot.remainingQuantity),
    ).toEqual(['41']);
  });

  it('names an entry whose date has no Bank of Russia rate instead of writing it', () => {
    const { entries, problems } = journalEntries(
      [entry({ occurredAt: '2023-01-01T10:00:00Z', operationIds: ['7', '8'] })],
      instruments,
      rates,
    );
    expect(entries).toEqual([]);
    expect(problems).toEqual([
      { reason: 'no-rate', occurredAt: '2023-01-01T10:00:00.000Z', operationIds: ['7', '8'] },
    ]);
  });

  it('names an entry too small to state in USD instead of failing the whole import', () => {
    const tiny = '0.000000000000000000000000000001';
    const { entries, problems } = journalEntries(
      [entry({ amount: tiny, quantity: tiny, operationIds: ['9'] })],
      instruments,
      rates,
    );
    expect(entries).toEqual([]);
    expect(problems).toEqual([
      { reason: 'amount', occurredAt: '2024-03-01T10:00:00.000Z', operationIds: ['9'] },
    ]);
  });

  it('stores a T-Bank time to the millisecond', () => {
    expect(journalTime('2024-03-01T10:00:00Z')).toBe('2024-03-01T10:00:00.000Z');
    expect(journalTime('2024-03-01T10:00:00.5Z')).toBe('2024-03-01T10:00:00.500Z');
    expect(journalTime('2024-03-01T10:00:00.123456789Z')).toBe('2024-03-01T10:00:00.123Z');
  });

  it('gives entries the FIFO replay accepts, with cash left as the account would hold it', () => {
    const { entries } = journalEntries(
      [
        entry({}),
        buy(),
        buy({ action: 'sell', occurredAt: '2024-03-02T10:00:00Z', amount: '500', fee: '5' }),
      ],
      instruments,
      rates,
    );
    const result = calculateOwnedTransfers(
      [
        {
          accountId: id(9),
          coverageFrom: '1970-01-01T00:00:00.000Z',
          trades: entries.map((item) => item.trade!),
          initialLots: [],
        },
      ],
      [],
    );
    const lots = result.accounts.get(id(9))!.lots.filter((lot) => lot.instrumentId === id(1));
    // 900 paid in, 459 spent on the buy, 495 kept from the sale.
    expect(lots.map((lot) => lot.remainingQuantity)).toEqual(['441', '495']);
  });
});

describe('BROKER-CAPRET: a part of a bond paid back becomes a capital return', () => {
  const returned = (over: Partial<PlanEntry> = {}) =>
    entry({
      record: 'capital-return',
      action: 'return',
      instrumentUid: share,
      ticker: 'SYNTH',
      instrumentType: 'bond',
      quantity: '270',
      amount: '270',
      occurredAt: '2024-03-02T10:00:00Z',
      operationIds: ['2'],
      ...over,
    });

  it('prices the cash that came back at its date, in the currency paid, with its rate', () => {
    const { entries, problems } = journalEntries([returned()], instruments, rates);
    expect(problems).toEqual([]);
    expect(entries[0]).toMatchObject({
      rate: { rateDate: '2024-03-02', rateSource: 'bank-of-russia' },
      capitalReturn: {
        instrumentId: id(4),
        cashInstrumentId: id(1),
        amount: '270',
        amountUsd: '3',
        paidCurrency: 'RUB',
        occurredAt: '2024-03-02T10:00:00.000Z',
      },
    });
  });

  it('keeps dollars as dollars, with no rate and no paid currency', () => {
    const { entries } = journalEntries(
      [returned({ currency: 'usd', amount: '3', quantity: '3' })],
      instruments,
      rates,
    );
    expect(entries[0]).toMatchObject({ rate: null });
    expect(entries[0].capitalReturn).toMatchObject({
      cashInstrumentId: id(2),
      amount: '3',
      amountUsd: '3',
      paidCurrency: null,
    });
  });

  it('names a return whose date has no Bank of Russia rate instead of writing it', () => {
    const { entries, problems } = journalEntries(
      [returned({ occurredAt: '2023-01-01T10:00:00Z' })],
      instruments,
      rates,
    );
    expect(entries).toEqual([]);
    expect(problems).toEqual([
      { reason: 'no-rate', occurredAt: '2023-01-01T10:00:00.000Z', operationIds: ['2'] },
    ]);
  });

  it('lowers the cost of the units held and brings the money in as cash the FIFO replay holds', () => {
    // 900 paid in, a buy of 2 units costing 459, then 270 of it comes back.
    const { entries } = journalEntries([entry({}), buy(), returned()], instruments, rates);
    const result = calculateOwnedTransfers(
      [
        {
          accountId: id(9),
          coverageFrom: '1970-01-01T00:00:00.000Z',
          trades: entries.flatMap((item) => (item.trade ? [item.trade] : [])),
          capitalReturns: entries.flatMap((item) =>
            item.capitalReturn ? [item.capitalReturn] : [],
          ),
          initialLots: [],
        },
      ],
      [],
    ).accounts.get(id(9))!;
    const bond = result.lots.find((lot) => lot.instrumentId === id(4))!;
    expect([bond.remainingQuantity, bond.remainingCostUsd]).toEqual(['2', '2.1']);
    expect(
      result.lots.filter((lot) => lot.instrumentId === id(1)).map((lot) => lot.remainingQuantity),
    ).toEqual(['441', '270']);
    expect(result.capitalReturnSummary).toMatchObject({ activeCount: 1, amountUsd: '3' });
  });
});

describe('BROKER-SYNC-FX: dollars and euros bought on the exchange', () => {
  it('buys dollar cash with ruble cash, and a dollar buy then spends those dollars', () => {
    const { entries, problems } = journalEntries(
      [
        entry({ amount: '100000', quantity: '100000' }),
        buy({
          instrumentUid: 'fx',
          instrumentType: 'currency',
          ticker: 'USD000UTSTOM',
          cash: 'usd',
          quantity: '1000',
          amount: '90000',
          fee: '45',
        }),
        buy({ quantity: '1', amount: '600', fee: '0', currency: 'usd' }),
        buy({
          action: 'sell',
          instrumentUid: 'fx',
          instrumentType: 'currency',
          ticker: 'USD000UTSTOM',
          cash: 'usd',
          quantity: '300',
          amount: '27000',
          fee: '0',
        }),
      ],
      instruments,
      rates,
    );
    expect(problems).toEqual([]);
    const [, bought, share, sold] = entries.map((item) => item.trade!);
    expect(bought).toMatchObject({
      instrumentId: id(2),
      side: 'buy',
      quantity: '1000',
      paid: { currency: 'RUB', gross: '90000', fee: '45' },
      settlement: { instrumentId: id(1), quantity: '90045' },
    });
    expect(share.settlement).toMatchObject({ instrumentId: id(2), quantity: '600' });
    expect(sold).toMatchObject({
      instrumentId: id(2),
      side: 'sell',
      quantity: '300',
      settlement: { instrumentId: id(1), quantity: '27000' },
    });
    // The records hold what really was: 100 dollars and 36955 rubles left.
    const { lots } = calculateOwnedTransfers(
      [
        {
          accountId: id(9),
          coverageFrom: '1970-01-01T00:00:00.000Z',
          trades: entries.map((item) => item.trade!),
          initialLots: [],
        },
      ],
      [],
    ).accounts.get(id(9))!;
    const left = (instrument: string) =>
      lots.filter((lot) => lot.instrumentId === instrument).map((lot) => lot.remainingQuantity);
    expect(left(id(2))).toEqual(['100']);
    expect(left(id(1))).toEqual(['9955', '27000']);
  });
});
