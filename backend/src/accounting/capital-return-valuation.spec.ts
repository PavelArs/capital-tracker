import { FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import type { FifoCapitalReturn } from './capital-return-types';
import type { FifoTrade } from './fifo';
import { calculateOwnedTransfers } from './owned-transfer-fifo';
import {
  type PortfolioInstrument,
  type PortfolioPrices,
  portfolioAccount,
  projectPortfolio,
} from './portfolio-valuation';

// Synthetic rates and amounts only (CAPRET-VAL-*, CUR-PAID-RUB).
const now = new Date('2026-10-04T12:00:00.000Z');
const account = '00000000-0000-4000-8000-000000000101';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bond: PortfolioInstrument = {
  id: id(1),
  name: 'Synthetic bond',
  symbol: 'SYNB',
  assetType: 'manual',
  valuationCurrency: 'RUB',
  priceSource: 'manual',
};
const rubles: PortfolioInstrument = {
  id: id(2),
  name: 'Rubles',
  symbol: 'RUB',
  assetType: 'fiat',
  valuationCurrency: 'RUB',
  priceSource: 'fixed',
};
const rates: FxRates = {
  USD: [
    { date: '2025-06-02', rubPerUnit: '80' },
    { date: '2025-07-01', rubPerUnit: '100' },
    { date: '2026-10-04', rubPerUnit: '95' },
  ],
  EUR: [
    { date: '2025-06-02', rubPerUnit: '100' },
    { date: '2025-07-01', rubPerUnit: '125' },
    { date: '2026-10-04', rubPerUnit: '110' },
  ],
};
const prices: PortfolioPrices = {
  market: new Map(),
  manual: new Map([
    [bond.id, { priceUsd: '10', observedAt: '2026-10-04T11:00:00.000Z', source: 'manual' }],
  ]),
};

// 10 bonds paid 80000 RUB on the day of 80 RUB per USD: 1000 USD.
const buy: FifoTrade = {
  tradeId: id(10),
  version: 1,
  instrumentId: bond.id,
  instrumentName: bond.name,
  instrumentSymbol: bond.symbol,
  side: 'buy',
  occurredAt: '2025-06-02T09:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '10',
  grossUsd: '1000',
  feeUsd: '0',
  paid: {
    currency: 'RUB',
    gross: '80000',
    fee: '0',
    rateDate: '2025-06-02',
    perUsd: '80',
    rateSource: 'bank-of-russia',
  },
};
const repayment = (rub: string, usd: string): FifoCapitalReturn => ({
  capitalReturnId: id(20),
  version: 1,
  instrumentId: bond.id,
  instrumentName: bond.name,
  instrumentSymbol: bond.symbol,
  cashInstrumentId: rubles.id,
  cashInstrumentName: rubles.name,
  cashInstrumentSymbol: rubles.symbol,
  occurredAt: '2025-07-01T09:00:00.000Z',
  orderWithinTimestamp: 0,
  amount: rub,
  amountUsd: usd,
  paidCurrency: 'RUB',
});

function view(
  currency: 'USD' | 'EUR' | 'RUB',
  trades: FifoTrade[],
  capitalReturns: FifoCapitalReturn[],
) {
  const input = {
    accountId: account,
    coverageFrom: '2025-01-01T00:00:00.000Z',
    initialLots: [],
    trades,
    capitalReturns,
  };
  const projection = calculateOwnedTransfers([input], []);
  const valued = portfolioAccount(
    { accountId: account, name: 'Broker' },
    projection.accounts.get(account)!,
    input,
    projection.swapAllocations,
    projection.capitalReturnAllocations,
  );
  return projectPortfolio(now, [bond, rubles], [valued], prices, new FxConverter(rates, currency));
}
const assetOf = (result: ReturnType<typeof view>, instrument: PortfolioInstrument) =>
  result.assets.find((item) => item.instrumentId === instrument.id)!;

describe('CAPRET-VAL-001 the cost of the bonds is what is left after the returns', () => {
  it('states USD, RUB and EUR costs with each return taken off at its own day', () => {
    // 8000 RUB came back on the day of 100 RUB per USD and 125 per EUR: 80 USD.
    const trades = [buy];
    const returns = [repayment('8000', '80')];
    expect(assetOf(view('USD', trades, returns), bond)).toMatchObject({ costBasis: '920' });
    expect(assetOf(view('RUB', trades, returns), bond)).toMatchObject({ costBasis: '72000' });
    // 80000 RUB at 100 per EUR = 800 EUR, less 8000 RUB at 125 per EUR = 64 EUR.
    expect(assetOf(view('EUR', trades, returns), bond)).toMatchObject({ costBasis: '736' });
  });

  it('values the cash that came in at its own cost, in the rubles it was paid', () => {
    const cash = assetOf(view('RUB', [buy], [repayment('8000', '80')]), rubles);
    expect(cash).toMatchObject({ quantity: '8000', costBasis: '8000' });
  });

  it('realizes nothing while the cost can still take the whole return', () => {
    expect(assetOf(view('RUB', [buy], [repayment('8000', '80')]), bond)).toMatchObject({
      realizedPnl: '0',
    });
  });
});

describe('CAPRET-VAL-002 a return above the remaining cost is realized when it comes', () => {
  it('realizes the excess in the paid currency and leaves the cost at zero', () => {
    const cheap: FifoTrade = {
      ...buy,
      grossUsd: '12.5',
      paid: { ...buy.paid!, gross: '1000', perUsd: '80' },
    };
    // 1500 RUB at 100 per USD is 15 USD; the bonds had 12.5 USD (1000 RUB) of cost left, so the
    // excess is 2.5 USD in dollars and 500 RUB in rubles: each currency takes its own.
    const rub = view('RUB', [cheap], [repayment('1500', '15')]);
    expect(assetOf(rub, bond)).toMatchObject({ costBasis: '0', realizedPnl: '500' });
    const usd = view('USD', [cheap], [repayment('1500', '15')]);
    expect(assetOf(usd, bond)).toMatchObject({ costBasis: '0', realizedPnl: '2.5' });
  });
});

describe('CAPRET-VAL-003 a missing cost stays missing', () => {
  it('does not count the realized result of a return on units of unknown cost', () => {
    const input = {
      accountId: account,
      coverageFrom: '2025-01-01T00:00:00.000Z',
      initialLots: [],
      trades: [],
      rewards: [
        {
          rewardId: id(30),
          version: 1,
          instrumentId: bond.id,
          instrumentName: bond.name,
          instrumentSymbol: bond.symbol,
          category: 'other' as const,
          occurredAt: '2025-06-02T09:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '10',
          acquisitionBasisUsd: null,
          incomeValueUsd: null,
        },
      ],
      capitalReturns: [repayment('8000', '80')],
    };
    const projection = calculateOwnedTransfers([input], []);
    const valued = portfolioAccount(
      { accountId: account, name: 'Broker' },
      projection.accounts.get(account)!,
      input,
      projection.swapAllocations,
      projection.capitalReturnAllocations,
    );
    const report = projectPortfolio(
      now,
      [bond, rubles],
      [valued],
      prices,
      new FxConverter(rates, 'RUB'),
    );
    expect(assetOf(report, bond)).toMatchObject({ costBasis: null, realizedPnl: null });
  });
});
