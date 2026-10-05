import { BadRequestException } from '@nestjs/common';
import { FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import { calculateFifo, type FifoTrade } from './fifo';
import { derivePaidAmounts, type TradePayment } from './paid-currency';
import {
  type PortfolioInstrument,
  type PortfolioPrices,
  portfolioAccount,
  projectPortfolio,
} from './portfolio-valuation';
import { parseTradeCreate } from './trade-input';

// Synthetic dates, rates and amounts only (CUR-PAID-RUB).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rates: FxRates = {
  USD: [
    { date: '2025-06-03', rubPerUnit: '79' },
    { date: '2025-07-01', rubPerUnit: '78' },
    { date: '2026-10-04', rubPerUnit: '95' },
  ],
  EUR: [
    { date: '2025-06-03', rubPerUnit: '92' },
    { date: '2025-07-01', rubPerUnit: '91' },
    { date: '2026-10-04', rubPerUnit: '110' },
  ],
};
const base = {
  requestId: id(1),
  expectedJournalRevision: 0,
  instrumentId: id(2),
  side: 'buy',
  occurredAt: '2025-06-03T09:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '0.01',
};

describe('PAID-INPUT a trade states its amounts in the currency it was paid in', () => {
  it('accepts RUB or EUR amounts instead of USD amounts', () => {
    expect(
      parseTradeCreate({ ...base, paid: { currency: 'RUB', gross: '100000.00', fee: '0' } }),
    ).toEqual({ ...base, paid: { currency: 'RUB', gross: '100000', fee: '0' } });
    expect(
      parseTradeCreate({ ...base, paid: { currency: 'EUR', gross: '1000', fee: '10.5' } }).paid,
    ).toEqual({ currency: 'EUR', gross: '1000', fee: '10.5' });
    expect(
      parseTradeCreate({
        ...base,
        paid: { currency: 'RUB', gross: '100000', fee: '0', perUsd: '80.50' },
      }).paid,
    ).toEqual({ currency: 'RUB', gross: '100000', fee: '0', perUsd: '80.5' });
    expect(parseTradeCreate({ ...base, grossUsd: '1000', feeUsd: '0' })).toEqual({
      ...base,
      grossUsd: '1000',
      feeUsd: '0',
    });
  });

  it.each([
    [
      'USD amounts as well',
      { grossUsd: '1000', feeUsd: '0', paid: { currency: 'RUB', gross: '1', fee: '0' } },
    ],
    ['no amounts', {}],
    ['USD as a paid currency', { paid: { currency: 'USD', gross: '1', fee: '0' } }],
    ['an unknown currency', { paid: { currency: 'GBP', gross: '1', fee: '0' } }],
    ['a zero amount', { paid: { currency: 'RUB', gross: '0', fee: '0' } }],
    ['a missing fee', { paid: { currency: 'RUB', gross: '1' } }],
    ['an unknown key', { paid: { currency: 'RUB', gross: '1', fee: '0', rate: '79' } }],
    ['a zero rate', { paid: { currency: 'RUB', gross: '1', fee: '0', perUsd: '0' } }],
    ['a negative rate', { paid: { currency: 'RUB', gross: '1', fee: '0', perUsd: '-80' } }],
    ['a rate as a number', { paid: { currency: 'RUB', gross: '1', fee: '0', perUsd: 80 } }],
    ['a list', { paid: [] }],
  ])('refuses %s', (_label, amounts) => {
    expect(() => parseTradeCreate({ ...base, ...amounts })).toThrow(BadRequestException);
  });
});

describe('PAID-DERIVE USD amounts come from the Bank of Russia rate of the trade date', () => {
  it('CUR-PAID-RUB: 100000 RUB at 79 RUB per USD is 1265.82 USD', () => {
    expect(
      derivePaidAmounts({ currency: 'RUB', gross: '100000', fee: '0' }, rates, base.occurredAt),
    ).toEqual({
      grossUsd: '1265.822784810126582278481012658228',
      feeUsd: '0',
      paid: {
        currency: 'RUB',
        gross: '100000',
        fee: '0',
        rateDate: '2025-06-03',
        perUsd: '79',
        rateSource: 'bank-of-russia',
      },
    });
  });

  it('converts EUR through rubles and uses the latest earlier rate on a Sunday', () => {
    const sunday = derivePaidAmounts(
      { currency: 'EUR', gross: '1000', fee: '10' },
      {
        USD: [{ date: '2025-06-07', rubPerUnit: '80' }],
        EUR: [{ date: '2025-06-07', rubPerUnit: '90' }],
      },
      '2025-06-08T12:00:00.000Z',
    );
    expect(sunday).toEqual({
      grossUsd: '1125',
      feeUsd: '11.25',
      paid: {
        currency: 'EUR',
        gross: '1000',
        fee: '10',
        rateDate: '2025-06-08',
        perUsd: '0.888888888888888888888888888889',
        rateSource: 'bank-of-russia',
      },
    });
  });

  it('uses the rate the owner entered instead, even with no stored rate', () => {
    const none: FxRates = { USD: [], EUR: [] };
    expect(
      derivePaidAmounts(
        { currency: 'RUB', gross: '100000', fee: '400', perUsd: '80' },
        none,
        '2025-05-01T09:00:00.000Z',
      ),
    ).toEqual({
      grossUsd: '1250',
      feeUsd: '5',
      paid: {
        currency: 'RUB',
        gross: '100000',
        fee: '400',
        rateDate: '2025-05-01',
        perUsd: '80',
        rateSource: 'owner',
      },
    });
    expect(
      derivePaidAmounts(
        { currency: 'EUR', gross: '1000', fee: '0', perUsd: '0.9' },
        rates,
        base.occurredAt,
      ),
    ).toMatchObject({
      grossUsd: '1111.111111111111111111111111111111',
      paid: { perUsd: '0.9', rateSource: 'owner' },
    });
    expect(() =>
      derivePaidAmounts(
        { currency: 'RUB', gross: '1', fee: '0', perUsd: '1000000000000000000000000000000000' },
        none,
        base.occurredAt,
      ),
    ).toThrow(BadRequestException);
  });

  it('has no USD amount without a stored rate and refuses an amount that rounds to zero', () => {
    const paid = { currency: 'RUB', gross: '100000', fee: '0' } as const;
    expect(derivePaidAmounts(paid, rates, '2025-06-02T09:00:00.000Z')).toBeNull();
    expect(
      derivePaidAmounts({ ...paid, currency: 'EUR' }, { ...rates, EUR: [] }, base.occurredAt),
    ).toBeNull();
    expect(() =>
      derivePaidAmounts(
        { currency: 'RUB', gross: '0.000000000000000000000000000001', fee: '0' },
        rates,
        base.occurredAt,
      ),
    ).toThrow(BadRequestException);
  });
});

describe('CUR-PAID-RUB a lot paid in rubles keeps its exact ruble cost', () => {
  const now = new Date('2026-10-04T12:00:00.000Z');
  const btc: PortfolioInstrument = {
    id: id(2),
    name: 'Bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
    valuationCurrency: 'USD',
    priceSource: 'market',
  };
  const prices: PortfolioPrices = {
    market: new Map([
      ['BTC', { priceUsd: '110000', observedAt: '2026-10-04T11:30:00.000Z', source: 'kraken' }],
    ]),
    manual: new Map(),
  };
  let number = 0;
  const trade = (
    side: 'buy' | 'sell',
    occurredAt: string,
    quantity: string,
    amounts: { grossUsd: string; feeUsd: string; paid?: TradePayment },
  ): FifoTrade => ({
    tradeId: id(100 + ++number),
    version: 1,
    instrumentId: btc.id,
    instrumentName: btc.name,
    instrumentSymbol: btc.symbol,
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    ...amounts,
  });
  const paidIn = (gross: string, occurredAt: string) =>
    derivePaidAmounts({ currency: 'RUB', gross, fee: '0' }, rates, occurredAt)!;
  const buy = () =>
    trade('buy', '2025-06-03T09:00:00.000Z', '0.01', paidIn('100000', '2025-06-03T09:00:00.000Z'));
  const view = (currency: 'USD' | 'EUR' | 'RUB', trades: FifoTrade[]) => {
    const account = portfolioAccount(
      { accountId: id(50), name: 'Trust Wallet' },
      calculateFifo(trades, []),
      { trades, initialLots: [] },
    );
    return projectPortfolio(now, [btc], [account], prices, new FxConverter(rates, currency))
      .assets[0];
  };

  it('states the cost exactly in RUB and at that day’s rates in USD and EUR', () => {
    const trades = [buy()];
    expect(view('RUB', trades)).toMatchObject({
      costBasis: '100000',
      value: '104500',
      unrealizedPnl: '4500',
    });
    expect(view('USD', trades).costBasis).toBe('1265.822784810126582278481012658228');
    expect(view('EUR', trades).costBasis).toBe('1086.956521739130434782608695652174');
  });

  it('keeps a remaining part and a USD sale exact in rubles', () => {
    const trades = [
      buy(),
      trade('sell', '2025-07-01T09:00:00.000Z', '0.004', { grossUsd: '500', feeUsd: '0' }),
    ];
    // 500 USD at 78 = 39000 RUB of proceeds against 40000 RUB of cost.
    expect(view('RUB', trades)).toMatchObject({ costBasis: '60000', realizedPnl: '-1000' });
  });

  it('realizes a sale paid in rubles against the ruble cost it consumed', () => {
    const trades = [
      buy(),
      trade(
        'sell',
        '2025-07-01T09:00:00.000Z',
        '0.004',
        paidIn('45000', '2025-07-01T09:00:00.000Z'),
      ),
    ];
    expect(view('RUB', trades)).toMatchObject({ costBasis: '60000', realizedPnl: '5000' });
    // 45000 / 78 USD against 0.4 of 1265.82… USD.
    expect(view('USD', trades).realizedPnl).toBe('70.593962999026290165530671859786');
    // 45000 RUB at 91 per EUR against 40000 RUB at 92 per EUR.
    expect(view('EUR', trades).realizedPnl).toBe('59.722885809842331581462016244625');
  });
});
