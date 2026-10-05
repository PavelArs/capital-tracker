import { calculateFifo, type FifoTrade } from './fifo';
import { projectOperations } from './operation-list';
import { parseTradeCreate } from './trade-input';

// Synthetic ids and amounts only. M9 part 3: income, expense, gift and fee (PR-OPS-2).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = {
  requestId: id(1),
  expectedJournalRevision: 1,
  instrumentId: id(2),
  occurredAt: '2026-04-01T00:00:00.000Z',
  quantity: '0.01',
};
function trade(
  tradeId: string,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  extra: Partial<FifoTrade> = {},
): FifoTrade {
  return {
    tradeId,
    version: 1,
    instrumentId: 'btc',
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    side,
    occurredAt: `2026-0${tradeId.length}-01T00:00:00.000Z`,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd,
    feeUsd: '0',
    ...extra,
  };
}

describe('trade purposes (M9, PR-OPS-2)', () => {
  it('takes a purpose only on the side it moves the asset and without cash', () => {
    const usd = { ...base, grossUsd: '850', feeUsd: '0' };
    for (const [side, purpose] of [
      ['buy', 'income'],
      ['buy', 'gift-received'],
      ['sell', 'expense'],
      ['sell', 'gift-sent'],
    ])
      expect(parseTradeCreate({ ...usd, side, purpose })).toMatchObject({ side, purpose });
    expect(
      parseTradeCreate({ ...base, side: 'sell', grossUsd: '8.5', feeUsd: '8.5', purpose: 'fee' }),
    ).toMatchObject({ purpose: 'fee', grossUsd: '8.5', feeUsd: '8.5' });
    expect(
      parseTradeCreate({
        ...base,
        side: 'buy',
        paid: { currency: 'RUB', gross: '68000', fee: '0' },
        purpose: 'income',
      }),
    ).toMatchObject({ purpose: 'income', paid: { currency: 'RUB' } });
    expect(parseTradeCreate({ ...usd, side: 'buy' })).not.toHaveProperty('purpose');
    for (const wrong of [
      { ...usd, side: 'sell', purpose: 'income' },
      { ...usd, side: 'buy', purpose: 'expense' },
      { ...usd, side: 'buy', purpose: 'fee' },
      { ...usd, side: 'buy', purpose: 'reward' },
      { ...usd, side: 'buy', purpose: 'Income' },
      { ...usd, side: 'buy', purpose: 'income', settlementCurrency: 'USDT' },
      // A fee is all fee: its value is both the gross and the fee, in USD.
      { ...usd, side: 'sell', purpose: 'fee' },
      {
        ...base,
        side: 'sell',
        paid: { currency: 'RUB', gross: '700', fee: '700' },
        purpose: 'fee',
      },
    ])
      expect(() => parseTradeCreate(wrong)).toThrow('Invalid accounting input');
  });

  it('income enters at its value; an expense realizes against cost; a fee loses the cost', () => {
    const result = calculateFifo([
      trade('i', 'buy', '0.03', '2400', { purpose: 'income' }),
      trade('ex', 'sell', '0.01', '900', { purpose: 'expense' }),
      trade('fee', 'sell', '0.01', '850', { feeUsd: '850', purpose: 'fee' }),
    ]);
    expect(
      result.realizations.map((row) => [row.sellTradeId, row.netUsd, row.realizedUsd]),
    ).toEqual([
      ['ex', '900', '100'],
      ['fee', '0', '-800'],
    ]);
    expect(result.lots.map((lot) => [lot.remainingQuantity, lot.remainingCostUsd])).toEqual([
      ['0.01', '800'],
    ]);
  });

  it('lists each purpose as its own type', () => {
    const account = { id: id(10), name: 'Trust Wallet' };
    const asset = { instrumentId: id(2), symbol: 'BTC', name: 'Bitcoin' };
    const row = (n: number, side: 'buy' | 'sell', purpose: FifoTrade['purpose'] | null) => ({
      tradeId: id(n),
      version: 1,
      account,
      asset,
      side,
      occurredAt: `2026-04-0${n}T00:00:00.000Z`,
      orderWithinTimestamp: 0,
      quantity: '0.01',
      grossUsd: '850',
      feeUsd: purpose === 'fee' ? '850' : '0',
      csv: false,
      paid: null,
      comment: null,
      settlement: null,
      purpose,
    });
    const list = projectOperations(new Date('2026-10-05T12:00:00.000Z'), {
      trades: [
        row(1, 'buy', 'income'),
        row(2, 'sell', 'expense'),
        row(3, 'buy', 'gift-received'),
        row(4, 'sell', 'gift-sent'),
        row(5, 'sell', 'fee'),
        row(6, 'buy', null),
      ],
      transfers: [],
      swaps: [],
      rewards: [],
      openings: [],
      flows: [],
      chain: [],
      marketPrices: new Map(),
    });
    expect(list.operations.map((operation) => [operation.type, operation.direction])).toEqual([
      ['buy', 'in'],
      ['fee', 'out'],
      ['gift', 'out'],
      ['gift', 'in'],
      ['expense', 'out'],
      ['income', 'in'],
    ]);
  });
});
