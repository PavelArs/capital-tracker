import { availableQuantity, firstShortfall, type LedgerView } from './available-quantity';
import { calculateFifo, type FifoTrade } from './fifo';
import { parseTradeCreate } from './trade-input';
import { settlementLeg, settlementTotal } from './trade-settlement';

// Synthetic amounts only. M9 cash: OPS-SELL-CASH, OPS-BUY-CASH.
const usdt = { instrumentId: 'usdt', instrumentName: 'Tether', instrumentSymbol: 'USDT' };
function trade(
  tradeId: string,
  side: 'buy' | 'sell',
  occurredAt: string,
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
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd,
    feeUsd: '0',
    ...extra,
  };
}
const bought = trade('b1', 'buy', '2026-03-01T00:00:00.000Z', '0.5', '25000');
const sold = trade('s1', 'sell', '2026-04-01T00:00:00.000Z', '0.5', '30000', {
  settlement: { ...usdt, quantity: '30000' },
});
const ledger = (trades: FifoTrade[]): LedgerView => ({
  accounts: new Map([
    [
      'bybit',
      { accountId: 'bybit', coverageFrom: '1970-01-01T00:00:00.000Z', trades, initialLots: [] },
    ],
  ]),
  transfers: [],
});

describe('trade settlement in cash (M9)', () => {
  it('states the cash leg: net proceeds of a sale, a share of the cost of a buy', () => {
    expect(settlementTotal({ side: 'sell', grossUsd: '30000', feeUsd: '25' })).toBe(
      29975n * 10n ** 30n,
    );
    expect(settlementLeg(sold)).toEqual({
      quantity: 30000n * 10n ** 30n,
      usd: 30000n * 10n ** 30n,
    });
    // A buy of 40000 RUB worth 500 USD that spent 10000 RUB of cash: a quarter of its cost.
    const rub = trade('b2', 'buy', '2026-05-01T00:00:00.000Z', '0.01', '495', {
      feeUsd: '5',
      paid: {
        currency: 'RUB',
        gross: '39600',
        fee: '400',
        rateDate: '2026-05-01',
        perUsd: '80',
        rateSource: 'owner',
      },
      settlement: {
        instrumentId: 'rub',
        instrumentName: 'Ruble',
        instrumentSymbol: 'RUB',
        quantity: '10000',
      },
    });
    expect(settlementLeg(rub)).toEqual({ quantity: 10000n * 10n ** 30n, usd: 125n * 10n ** 30n });
    expect(settlementLeg({ ...rub, settlement: { ...rub.settlement!, quantity: '0' } })).toBeNull();
    expect(settlementLeg({ ...rub, settlement: undefined })).toBeNull();
  });

  it('OPS-SELL-CASH the proceeds stay as cash at their own cost; realized P&L is +5000', () => {
    const result = calculateFifo([sold, bought]);
    expect(result.summary).toMatchObject({
      grossBuysUsd: '25000',
      grossSalesUsd: '30000',
      realizedUsd: '5000',
      remainingCostUsd: '30000',
    });
    expect(result.lots).toEqual([
      expect.objectContaining({
        buyTradeId: 's1',
        instrumentId: 'usdt',
        originalQuantity: '30000',
        originalCostUsd: '30000',
        remainingQuantity: '30000',
        remainingCostUsd: '30000',
      }),
    ]);
    expect(
      availableQuantity(ledger([bought, sold]), 'bybit', 'usdt', '2026-04-02T00:00:00.000Z'),
    ).toBe('30000');
  });

  it('OPS-BUY-CASH a buy spends the cash first at its share of the cost', () => {
    const buy = trade('b3', 'buy', '2026-05-01T00:00:00.000Z', '0.4', '40000', {
      settlement: { ...usdt, quantity: '30000' },
    });
    const result = calculateFifo([bought, sold, buy]);
    expect(
      result.lots.map((lot) => [lot.instrumentId, lot.remainingQuantity, lot.remainingCostUsd]),
    ).toEqual([['btc', '0.4', '40000']]);
    // The cash is realized at what it paid; it was worth what it cost, so nothing is gained.
    expect(result.realizations.at(-1)).toMatchObject({
      sellTradeId: 'b3',
      instrumentId: 'usdt',
      quantity: '30000',
      netUsd: '30000',
      realizedUsd: '0',
    });
    expect(result.summary).toMatchObject({
      grossBuysUsd: '65000',
      grossSalesUsd: '30000',
      realizedUsd: '5000',
    });
    const view = ledger([bought, sold, buy]);
    expect(availableQuantity(view, 'bybit', 'usdt', '2026-05-02T00:00:00.000Z')).toBe('0');
    expect(firstShortfall(view)).toBeNull();
    // Without the sale the buy would spend cash the account never had.
    expect(firstShortfall(ledger([bought, buy]))).toEqual({
      operationId: 'trade:b3',
      accountId: 'bybit',
      instrumentId: 'usdt',
      occurredAt: '2026-05-01T00:00:00.000Z',
    });
    expect(() => calculateFifo([bought, buy])).toThrow();
  });

  it('takes a cash currency that matches how the trade was stated', () => {
    const base = {
      requestId: '00000000-0000-4000-8000-000000000001',
      expectedJournalRevision: 1,
      instrumentId: '00000000-0000-4000-8000-000000000002',
      side: 'sell',
      occurredAt: '2026-04-01T00:00:00.000Z',
      quantity: '0.5',
    };
    const usdAmounts = { ...base, grossUsd: '30000', feeUsd: '0' };
    const rubles = { ...base, paid: { currency: 'RUB', gross: '2400000', fee: '0' } };
    for (const currency of ['USD', 'USDT', 'USDC'])
      expect(parseTradeCreate({ ...usdAmounts, settlementCurrency: currency })).toMatchObject({
        settlementCurrency: currency,
      });
    expect(parseTradeCreate({ ...rubles, settlementCurrency: 'RUB' })).toMatchObject({
      settlementCurrency: 'RUB',
    });
    expect(parseTradeCreate(usdAmounts)).not.toHaveProperty('settlementCurrency');
    for (const wrong of [
      { ...usdAmounts, settlementCurrency: 'RUB' },
      { ...rubles, settlementCurrency: 'USDT' },
      { ...rubles, settlementCurrency: 'EUR' },
      { ...usdAmounts, settlementCurrency: 'BTC' },
      { ...usdAmounts, settlementCurrency: 'usdt' },
    ])
      expect(() => parseTradeCreate(wrong)).toThrow('Invalid accounting input');
  });
});
