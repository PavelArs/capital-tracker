import { FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import type { SwapAllocation } from './asset-swap-types';
import { calculateFifo, type FifoCarryInInput, type FifoTrade } from './fifo';
import {
  type PortfolioAccountInput,
  type PortfolioInstrument,
  type PortfolioPrices,
  portfolioAccount,
  projectPortfolio,
} from './portfolio-valuation';

// Synthetic rates and amounts only (account-in-three-currencies, CUR-*).
const now = new Date('2026-10-04T12:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const btc: PortfolioInstrument = {
  id: id(1),
  name: 'Bitcoin',
  symbol: 'BTC',
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
};
const eth: PortfolioInstrument = { ...btc, id: id(2), name: 'Ethereum', symbol: 'ETH' };
const rubles: PortfolioInstrument = {
  id: id(3),
  name: 'Rubles',
  symbol: 'RUB',
  assetType: 'fiat',
  valuationCurrency: 'RUB',
  priceSource: 'fixed',
};
const euros: PortfolioInstrument = {
  ...rubles,
  id: id(4),
  name: 'Euro',
  symbol: 'EUR',
  valuationCurrency: 'EUR',
};

const prices = (entries: Record<string, string>): PortfolioPrices => ({
  market: new Map(
    Object.entries(entries).map(([code, priceUsd]) => [
      code,
      { priceUsd, observedAt: '2026-10-04T11:00:00.000Z', source: 'kraken' },
    ]),
  ),
  manual: new Map(),
});
let tradeNumber = 0;
const trade = (
  asset: PortfolioInstrument,
  side: 'buy' | 'sell',
  occurredAt: string,
  quantity: string,
  grossUsd: string,
  feeUsd = '0',
): FifoTrade => ({
  tradeId: id(1000 + ++tradeNumber),
  version: 1,
  instrumentId: asset.id,
  instrumentName: asset.name,
  instrumentSymbol: asset.symbol,
  side,
  occurredAt,
  orderWithinTimestamp: 0,
  quantity,
  grossUsd,
  feeUsd,
});
function account(trades: FifoTrade[], initialLots: FifoCarryInInput[] = []): PortfolioAccountInput {
  return portfolioAccount(
    { accountId: id(101), name: 'Trust Wallet' },
    calculateFifo(trades, initialLots),
    { trades, initialLots },
  );
}
const assetOf = (result: ReturnType<typeof projectPortfolio>, asset: PortfolioInstrument) =>
  result.assets.find((item) => item.instrumentId === asset.id)!;
const view = (
  currency: 'USD' | 'EUR' | 'RUB',
  rates: FxRates,
  accounts: PortfolioAccountInput[],
  instruments: PortfolioInstrument[],
  market: Record<string, string>,
) => projectPortfolio(now, instruments, accounts, prices(market), new FxConverter(rates, currency));

describe('CUR-PNL-RUB cost at the purchase date, value at today', () => {
  // 1000 USD bought on a day of 80 RUB per USD, now worth 1100 USD at 95 RUB per USD.
  const rates: FxRates = {
    USD: [
      { date: '2025-06-02', rubPerUnit: '80' },
      { date: '2026-10-04', rubPerUnit: '95' },
    ],
    EUR: [
      { date: '2025-06-02', rubPerUnit: '100' },
      { date: '2026-10-04', rubPerUnit: '110' },
    ],
  };
  const holdings = () => [account([trade(btc, 'buy', '2025-06-02T09:00:00.000Z', '0.01', '1000')])];

  it('keeps USD exact and states cost, value and P&L in RUB', () => {
    expect(assetOf(view('USD', rates, holdings(), [btc], { BTC: '110000' }), btc)).toMatchObject({
      costBasis: '1000',
      value: '1100',
      unrealizedPnl: '100',
    });
    const rub = view('RUB', rates, holdings(), [btc], { BTC: '110000' });
    expect(assetOf(rub, btc)).toMatchObject({
      price: { value: '10450000', status: 'fresh' },
      costBasis: '80000',
      averageBuyPrice: '8000000',
      value: '104500',
      unrealizedPnl: '24500',
      unrealizedReturnPercent: '30.63',
      missingPrice: null,
    });
    expect(rub).toMatchObject({
      currency: 'RUB',
      totalValue: '104500',
      costBasis: '80000',
      unrealizedPnl: '24500',
      missingRateCount: 0,
      rates: [
        { currency: 'USD', date: '2026-10-04', rubPerUnit: '95' },
        { currency: 'EUR', date: '2026-10-04', rubPerUnit: '110' },
      ],
    });
  });

  it('states the same holding in EUR through the two ruble rates of each date', () => {
    const eur = view('EUR', rates, holdings(), [btc], { BTC: '110000' });
    // Cost 1000 × 80 / 100 = 800 EUR; value 1100 × 95 / 110 = 950 EUR.
    expect(assetOf(eur, btc)).toMatchObject({
      costBasis: '800',
      value: '950',
      unrealizedPnl: '150',
    });
    expect(eur.allocation.byAsset).toEqual([
      { key: btc.id, label: 'Bitcoin', value: '950', percent: '100.00' },
    ]);
  });
});

describe('CUR-SWITCH a total of 1000 USD at 0.92 EUR per USD', () => {
  it('shows 920 EUR', () => {
    const rates: FxRates = {
      USD: [{ date: '2026-10-01', rubPerUnit: '92' }],
      EUR: [{ date: '2026-10-01', rubPerUnit: '100' }],
    };
    const accounts = [account([trade(btc, 'buy', '2026-10-01T09:00:00.000Z', '1', '900')])];
    const eur = view('EUR', rates, accounts, [btc], { BTC: '1000' });
    expect(eur).toMatchObject({ currency: 'EUR', totalValue: '920', costBasis: '828' });
    expect(eur.accounts[0].pricedValue).toBe('920');
    expect(assetOf(eur, btc).holdings[0].value).toBe('920');
  });
});

describe('CUR-NO-RATE no stored rate is never zero', () => {
  const accounts = () => [
    account([
      trade(btc, 'buy', '2025-06-02T09:00:00.000Z', '1', '1000'),
      trade(rubles, 'buy', '2025-06-02T10:00:00.000Z', '5000', '60'),
    ]),
  ];

  it('shows No rate in RUB while USD stays available', () => {
    const none: FxRates = { USD: [], EUR: [] };
    const rub = view('RUB', none, accounts(), [btc, rubles], { BTC: '2000' });
    expect(assetOf(rub, btc)).toMatchObject({
      price: null,
      missingPrice: 'no-rate',
      value: null,
      costBasis: null,
      knownCostSubtotal: '0',
      missingRateQuantity: '1',
      averageBuyPrice: null,
      unrealizedPnl: null,
    });
    // RUB cash is its own currency: exactly its amount without any rate.
    expect(assetOf(rub, rubles)).toMatchObject({
      price: { value: '1', status: 'fixed' },
      value: '5000',
      missingPrice: null,
    });
    expect(rub).toMatchObject({
      completeness: 'incomplete',
      totalValue: null,
      pricedSubtotal: '5000',
      missingPriceCount: 1,
      costBasis: null,
      unrealizedPnl: null,
      missingRateCount: 2,
      rates: [],
    });
    const usd = view('USD', none, accounts(), [btc, rubles], { BTC: '2000' });
    expect(assetOf(usd, btc)).toMatchObject({ value: '2000', costBasis: '1000' });
    expect(assetOf(usd, rubles)).toMatchObject({ missingPrice: 'no-rate', value: null });
  });

  it('marks cost from before the first stored rate as missing, not zero', () => {
    const rates: FxRates = {
      USD: [{ date: '2025-01-01', rubPerUnit: '100' }],
      EUR: [{ date: '2025-01-01', rubPerUnit: '105' }],
    };
    const carried: FifoCarryInInput = {
      lotId: id(500),
      openingRevision: 1,
      ordinal: 1,
      instrumentId: btc.id,
      instrumentName: btc.name,
      instrumentSymbol: btc.symbol,
      acquiredAt: '2024-12-01T00:00:00.000Z',
      orderWithinTimestamp: 0,
      originalQuantity: '1',
      originalCostUsd: '30000',
      carriedQuantity: '1',
    };
    const accounts = [
      account([trade(btc, 'buy', '2025-02-01T00:00:00.000Z', '1', '50000')], [carried]),
    ];
    const rub = view('RUB', rates, accounts, [btc], { BTC: '60000' });
    expect(assetOf(rub, btc)).toMatchObject({
      quantity: '2',
      value: '12000000',
      costBasis: null,
      knownCostSubtotal: '5000000',
      missingRateQuantity: '1',
      unknownCostQuantity: '0',
      averageBuyPrice: '5000000',
      unrealizedPnl: null,
    });
    expect(rub).toMatchObject({ costBasis: null, missingRateCount: 1, unknownCostCount: 0 });
    expect(view('USD', rates, accounts, [btc], { BTC: '60000' })).toMatchObject({
      costBasis: '80000',
      missingRateCount: 0,
    });
  });
});

describe('CUR-RATE-GAP and realized P&L per currency', () => {
  const rates: FxRates = {
    USD: [
      { date: '2025-06-02', rubPerUnit: '80' },
      { date: '2025-06-03', rubPerUnit: '81' },
      { date: '2025-06-07', rubPerUnit: '78.5' },
      { date: '2025-06-10', rubPerUnit: '79' },
    ],
    // No EUR rate yet on the first purchase date.
    EUR: [{ date: '2025-06-03', rubPerUnit: '90' }],
  };

  it('values a Sunday sale at the latest earlier rate and FIFO costs at their own dates', () => {
    const accounts = [
      account([
        trade(btc, 'buy', '2025-06-02T09:00:00.000Z', '1', '50000'),
        trade(btc, 'buy', '2025-06-03T09:00:00.000Z', '1', '60000'),
        // Sunday 8 June 2025: the Saturday rate 78.5 applies.
        trade(btc, 'sell', '2025-06-08T12:00:00.000Z', '1.5', '105500', '500'),
      ]),
    ];
    const usd = view('USD', rates, accounts, [btc], { BTC: '70000' });
    expect(assetOf(usd, btc)).toMatchObject({ realizedPnl: '25000', costBasis: '30000' });
    const rub = view('RUB', rates, accounts, [btc], { BTC: '70000' });
    // Proceeds 105000 × 78.5 = 8242500; cost 50000 × 80 + 30000 × 81 = 6430000.
    expect(assetOf(rub, btc)).toMatchObject({
      realizedPnl: '1812500',
      costBasis: '2430000',
      unknownRealizedCount: 0,
    });
    expect(rub.realizedPnl).toBe('1812500');
  });

  it('uses the Moscow date of a late-evening UTC sale', () => {
    const accounts = [
      account([
        trade(btc, 'buy', '2025-06-02T09:00:00.000Z', '1', '50000'),
        // 6 June 22:30 UTC is already 7 June in Moscow.
        trade(btc, 'sell', '2025-06-06T22:30:00.000Z', '1', '60000'),
      ]),
    ];
    const rub = view('RUB', rates, accounts, [btc], {});
    expect(assetOf(rub, btc).realizedPnl).toBe(String(60000 * 78.5 - 50000 * 80));
  });

  it('leaves a realized result without a rate unknown', () => {
    const accounts = [
      account([
        trade(eth, 'buy', '2025-06-02T09:00:00.000Z', '1', '1000'),
        trade(eth, 'sell', '2025-06-03T09:00:00.000Z', '1', '1200'),
      ]),
    ];
    const eur = view('EUR', rates, accounts, [eth], {});
    expect(assetOf(eur, eth)).toMatchObject({
      realizedPnl: null,
      knownRealizedSubtotal: '0',
      unknownRealizedCount: 1,
    });
    expect(eur).toMatchObject({ realizedPnl: null, missingRateCount: 1 });
  });

  it('realizes a swap at its own date against the consumed basis', () => {
    const buy = trade(eth, 'buy', '2025-06-02T09:00:00.000Z', '2', '4000');
    const fifo = calculateFifo([buy], []);
    const allocation: SwapAllocation = {
      swapId: id(700),
      considerationUsd: '2500',
      principalBasisUsd: '2000',
      feeConsumedBasisUsd: '0',
      realizedUsd: '500',
      coverage: {
        consideration: { knownSubtotalUsd: '2500', unknownCount: 0 },
        principal: { knownSubtotalUsd: '2000', unknownCount: 0 },
        fee: { knownSubtotalUsd: '0', unknownCount: 0 },
        realized: { knownSubtotalUsd: '500', unknownCount: 0 },
      },
      items: [
        {
          kind: 'principal',
          instrumentId: eth.id,
          quantity: '1',
          costUsd: '2000',
          origin: {
            accountId: id(101),
            kind: 'trade',
            tradeId: buy.tradeId,
            version: 1,
            acquiredAt: buy.occurredAt,
            orderWithinTimestamp: 0,
            originalQuantity: '2',
            originalCostUsd: '4000',
          },
          intervalStart: '0',
          intervalEnd: '1',
          arrival: null,
        },
      ],
    };
    const input = portfolioAccount(
      { accountId: id(101), name: 'Trust Wallet' },
      fifo,
      {
        trades: [buy],
        initialLots: [],
        swaps: [
          { swapId: id(700), outgoingInstrumentId: eth.id, occurredAt: '2025-06-03T09:00:00.000Z' },
        ],
      },
      new Map([[id(700), allocation]]),
    );
    expect(input.realizations).toEqual([
      {
        instrumentId: eth.id,
        occurredAt: '2025-06-03T09:00:00.000Z',
        proceedsUsd: '2500',
        consumed: [{ costUsd: '2000', acquiredAt: '2025-06-02T09:00:00.000Z' }],
      },
    ]);
    // 2500 × 81 − 2000 × 80.
    expect(assetOf(view('RUB', rates, [input], [eth], {}), eth).realizedPnl).toBe('42500');
  });
});

describe('CUR-CASH fixed cash in other currencies', () => {
  it('values EUR and RUB cash at today’s rates', () => {
    const rates: FxRates = {
      USD: [{ date: '2026-10-01', rubPerUnit: '80' }],
      EUR: [{ date: '2026-10-01', rubPerUnit: '100' }],
    };
    const accounts = [
      account([
        trade(rubles, 'buy', '2026-10-01T09:00:00.000Z', '8000', '100'),
        trade(euros, 'buy', '2026-10-01T10:00:00.000Z', '100', '125'),
      ]),
    ];
    const usd = view('USD', rates, accounts, [rubles, euros], {});
    expect(assetOf(usd, rubles)).toMatchObject({ price: { value: '0.0125' }, value: '100' });
    expect(assetOf(usd, euros)).toMatchObject({ price: { value: '1.25' }, value: '125' });
    expect(usd.totalValue).toBe('225');
    const eur = view('EUR', rates, accounts, [rubles, euros], {});
    expect(assetOf(eur, euros)).toMatchObject({
      price: { value: '1' },
      value: '100',
      costBasis: '100',
      unrealizedPnl: '0',
    });
    expect(eur.totalValue).toBe('180');
  });
});
