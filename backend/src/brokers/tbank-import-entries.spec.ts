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
  it('buys cash from outside for money paid in and spends it on a buy, the rest from outside', () => {
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
    expect(purchase).toMatchObject({
      instrumentId: id(4),
      side: 'buy',
      quantity: '2',
      paid: { currency: 'RUB', gross: '1000', fee: '0' },
      settlement: { instrumentId: id(1), quantity: '900' },
    });
    // Same millisecond: numbered in plan order.
    expect(entries.map((item) => item.trade!.orderWithinTimestamp)).toEqual([0, 1]);
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
      [entry({ record: 'reward', action: 'income', amount: '50', quantity: '50' }), buy()],
      instruments,
      rates,
    );
    expect(entries[1].trade?.settlement).toMatchObject({ instrumentId: id(1), quantity: '50' });
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
