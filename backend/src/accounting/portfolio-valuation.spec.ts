import { calculateFifo, type FifoTrade } from './fifo';
import {
  type PortfolioAccountInput,
  type PortfolioInstrument,
  type PortfolioLot,
  type PortfolioPrices,
  portfolioAccount,
  projectPortfolio,
  type StoredPrice,
} from './portfolio-valuation';

const now = new Date('2026-10-04T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instrument = (
  n: number,
  name: string,
  symbol: string | null,
  kind: Pick<PortfolioInstrument, 'assetType' | 'valuationCurrency' | 'priceSource'>,
): PortfolioInstrument => ({ id: id(n), name, symbol, ...kind });
const crypto = { assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market' } as const;
const manualUsd = { assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' } as const;
const btc = instrument(1, 'Bitcoin', 'BTC', crypto);
const eth = instrument(2, 'Ethereum', 'ETH', crypto);
const usd = instrument(3, 'US dollar', 'USD', {
  assetType: 'fiat',
  valuationCurrency: 'USD',
  priceSource: 'fixed',
});
const rub = instrument(4, 'Rubles', 'RUB', {
  assetType: 'fiat',
  valuationCurrency: 'RUB',
  priceSource: 'fixed',
});
const deposit = instrument(5, 'Deposit', null, manualUsd);
const unheld = instrument(6, 'Toncoin', 'TON', {
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'manual',
});

const market = (entries: Record<string, [string, string]>): PortfolioPrices['market'] =>
  new Map(
    Object.entries(entries).map(([code, [priceUsd, observedAt]]) => [
      code,
      { priceUsd, observedAt, source: 'kraken' } satisfies StoredPrice,
    ]),
  );
const prices = (
  marketEntries: Record<string, [string, string]>,
  manual: Record<string, string> = {},
): PortfolioPrices => ({
  market: market(marketEntries),
  manual: new Map(
    Object.entries(manual).map(([instrumentId, priceUsd]) => [
      instrumentId,
      { priceUsd, observedAt: minutesAgo(600), source: 'manual' },
    ]),
  ),
});

let tradeNumber = 0;
const trade = (
  asset: PortfolioInstrument,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
): FifoTrade => {
  tradeNumber++;
  return {
    tradeId: id(1000 + tradeNumber),
    version: 1,
    instrumentId: asset.id,
    instrumentName: asset.name,
    instrumentSymbol: asset.symbol,
    side,
    occurredAt: `2025-06-${String(tradeNumber).padStart(2, '0')}T00:00:00.000Z`,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd,
    feeUsd: '0',
  };
};
/** An account whose holdings and realizations come from the real FIFO calculation. */
function account(n: number, name: string, trades: FifoTrade[]): PortfolioAccountInput {
  return portfolioAccount({ accountId: id(100 + n), name }, calculateFifo(trades, []), {
    trades,
    initialLots: [],
  });
}
const position = (
  asset: PortfolioInstrument,
  quantity: string,
  costUsd: string | null,
  acquiredAt = '2025-06-01T00:00:00.000Z',
): PortfolioLot => ({ instrumentId: asset.id, quantity, costUsd, acquiredAt });
const holding = (n: number, name: string, lots: PortfolioLot[]): PortfolioAccountInput => ({
  accountId: id(100 + n),
  name,
  coverage: 'covered',
  lots,
  realizations: [],
});
const assetOf = (result: ReturnType<typeof projectPortfolio>, asset: PortfolioInstrument) =>
  result.assets.find((item) => item.instrumentId === asset.id)!;

describe('PV-BR11 two buys and a price', () => {
  it('shows amount, average buy price, cost basis, value and unrealized P&L', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [
        account(1, 'Trust Wallet', [
          trade(btc, 'buy', '1', '50000'),
          trade(btc, 'buy', '0.2', '16000'),
        ]),
      ],
      prices({ BTC: ['80000', minutesAgo(30)] }),
    );
    expect(assetOf(result, btc)).toMatchObject({
      quantity: '1.2',
      averageBuyPrice: '55000',
      costBasis: '66000',
      value: '96000',
      unrealizedPnl: '30000',
      unrealizedReturnPercent: '45.45',
      realizedPnl: '0',
      allocationPercent: '100.00',
      price: { value: '80000', source: 'kraken', status: 'fresh' },
    });
    expect(result).toMatchObject({
      completeness: 'complete',
      totalValue: '96000',
      costBasis: '66000',
      unrealizedPnl: '30000',
      unrealizedReturnPercent: '45.45',
      realizedPnl: '0',
    });
  });
});

describe('PV-MARKET spreadsheet row at a market price', () => {
  it('values 0.00918359 BTC bought for 1000 USD at 84945', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [account(1, 'Trust Wallet', [trade(btc, 'buy', '0.00918359', '1000')])],
      prices({ BTC: ['84945', minutesAgo(30)] }),
    );
    expect(assetOf(result, btc)).toMatchObject({
      value: '780.10005255',
      unrealizedPnl: '-219.89994745',
      unrealizedReturnPercent: '-21.99',
      price: { value: '84945', observedAt: minutesAgo(30), status: 'fresh' },
    });
  });
});

describe('PV-STALE a three-hour-old price is used and marked', () => {
  it('keeps the value and reports the price as stale', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [holding(1, 'Trust Wallet', [position(btc, '2', '100')])],
      prices({ BTC: ['50', minutesAgo(180)] }),
    );
    expect(assetOf(result, btc).price).toEqual({
      value: '50',
      observedAt: minutesAgo(180),
      source: 'kraken',
      status: 'stale',
    });
    expect(assetOf(result, btc).value).toBe('100');
    expect(result).toMatchObject({ totalValue: '100', stalePriceCount: 1 });
  });
});

describe('PV-REALIZED FIFO realization', () => {
  it('realizes 25000 and keeps 0.5 BTC at cost 30000', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [
        account(1, 'Trust Wallet', [
          trade(btc, 'buy', '1', '50000'),
          trade(btc, 'buy', '1', '60000'),
          trade(btc, 'sell', '1.5', '105000'),
        ]),
      ],
      prices({ BTC: ['70000', minutesAgo(10)] }),
    );
    expect(assetOf(result, btc)).toMatchObject({
      quantity: '0.5',
      costBasis: '30000',
      averageBuyPrice: '60000',
      realizedPnl: '25000',
      unrealizedPnl: '5000',
    });
    expect(result.realizedPnl).toBe('25000');
  });

  it('keeps realized results of assets no longer held and marks unknown ones', () => {
    const sold = account(1, 'Bybit', [
      trade(eth, 'buy', '2', '4000'),
      trade(eth, 'sell', '2', '3000'),
    ]);
    const result = projectPortfolio(now, [eth], [sold], prices({}));
    expect(assetOf(result, eth)).toMatchObject({
      quantity: '0',
      value: '0',
      realizedPnl: '-1000',
      missingPrice: 'no-price',
    });
    expect(result).toMatchObject({ realizedPnl: '-1000', missingPriceCount: 0 });
    const unknown = projectPortfolio(
      now,
      [eth],
      [
        {
          ...sold,
          realizations: [
            ...sold.realizations,
            {
              instrumentId: eth.id,
              occurredAt: '2025-06-30T00:00:00.000Z',
              proceedsUsd: '10',
              consumed: [{ costUsd: null, acquiredAt: '2025-06-29T00:00:00.000Z' }],
            },
          ],
        },
      ],
      prices({}),
    );
    expect(assetOf(unknown, eth)).toMatchObject({
      realizedPnl: null,
      knownRealizedSubtotal: '-1000',
      unknownRealizedCount: 1,
    });
    expect(unknown.realizedPnl).toBeNull();
  });
});

describe('PV-UNKNOWN-COST partly unknown cost', () => {
  it('leaves cost basis and unrealized P&L empty and averages the known part', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [holding(1, 'Trezor', [position(btc, '1', '50000'), position(btc, '0.5', null)])],
      prices({ BTC: ['60000', minutesAgo(5)] }),
    );
    expect(assetOf(result, btc)).toMatchObject({
      quantity: '1.5',
      value: '90000',
      costBasis: null,
      knownCostSubtotal: '50000',
      unknownCostQuantity: '0.5',
      averageBuyPrice: '50000',
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
    });
    expect(result).toMatchObject({
      totalValue: '90000',
      costBasis: null,
      knownCostSubtotal: '50000',
      unknownCostCount: 1,
      unrealizedPnl: null,
    });
  });
});

describe('PV-NONE and PV-FIXED missing prices are not zero', () => {
  it('reports no price, no rate and fixed USD cash', () => {
    const result = projectPortfolio(
      now,
      [btc, eth, usd, rub, unheld],
      [
        holding(1, 'Trust Wallet', [
          position(btc, '1', '100'),
          position(eth, '2', '200'),
          position(usd, '1500', '1500'),
          position(rub, '100000', '1200'),
        ]),
      ],
      prices({ BTC: ['1000', minutesAgo(1)] }),
    );
    expect(assetOf(result, eth)).toMatchObject({
      price: null,
      missingPrice: 'no-price',
      value: null,
      allocationPercent: null,
      unrealizedPnl: null,
    });
    expect(assetOf(result, usd)).toMatchObject({
      price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
      value: '1500',
    });
    expect(assetOf(result, rub)).toMatchObject({
      price: null,
      missingPrice: 'no-rate',
      value: null,
    });
    expect(assetOf(result, unheld)).toMatchObject({
      quantity: '0',
      value: '0',
      missingPrice: 'no-price',
      holdings: [],
    });
    expect(result).toMatchObject({
      completeness: 'incomplete',
      totalValue: null,
      pricedSubtotal: '2500',
      missingPriceCount: 2,
      unrealizedPnl: null,
      allocation: { complete: false },
    });
    // Held and priced by value, held without a price, then the rest.
    expect(result.assets.map((asset) => asset.name)).toEqual([
      'US dollar',
      'Bitcoin',
      'Ethereum',
      'Rubles',
      'Toncoin',
    ]);
  });

  it('marks the total incomplete when an account starts after now', () => {
    const result = projectPortfolio(
      now,
      [usd],
      [
        holding(1, 'Cash', [position(usd, '10', '10')]),
        { ...holding(2, 'Later', []), coverage: 'before-coverage' },
        { ...holding(3, 'Not started', []), coverage: 'not-started' },
      ],
      prices({}),
    );
    expect(result).toMatchObject({
      completeness: 'incomplete',
      totalValue: null,
      pricedSubtotal: '10',
      unavailableAccountCount: 1,
      costBasis: null,
      unknownCostCount: 0,
      // Holdings of the later account are unknown, so the shares are not complete either.
      allocation: { complete: false },
    });
    expect(result.accounts.map((item) => [item.name, item.coverage, item.pricedValue])).toEqual([
      ['Cash', 'covered', '10'],
      ['Later', 'before-coverage', null],
      ['Not started', 'not-started', '0'],
    ]);
  });
});

describe('PV-ALLOC and PV-TOTAL allocation over every account', () => {
  it('splits the portfolio by asset, type and account and sums accounts', () => {
    const result = projectPortfolio(
      now,
      [btc, eth, usd, deposit],
      [
        holding(1, 'Trust Wallet', [position(btc, '0.03', '2000'), position(eth, '1', '1500')]),
        holding(2, 'Bybit', [
          position(btc, '0.03', '2100'),
          position(usd, '1500', '1500'),
          position(deposit, '1', '2000'),
        ]),
      ],
      prices(
        { BTC: ['70000', minutesAgo(1)], ETH: ['2000', minutesAgo(1)] },
        { [deposit.id]: '2300' },
      ),
    );
    expect(result.totalValue).toBe('10000');
    expect(assetOf(result, btc)).toMatchObject({
      quantity: '0.06',
      value: '4200',
      costBasis: '4100',
      holdings: [
        { accountId: id(102), accountName: 'Bybit', quantity: '0.03', value: '2100' },
        { accountId: id(101), accountName: 'Trust Wallet', quantity: '0.03', value: '2100' },
      ],
    });
    const share = (list: { label: string; percent: string | null }[]) =>
      list.map((slice) => [slice.label, slice.percent]);
    expect(share(result.allocation.byAsset)).toEqual([
      ['Bitcoin', '42.00'],
      ['Deposit', '23.00'],
      ['Ethereum', '20.00'],
      ['US dollar', '15.00'],
    ]);
    expect(share(result.allocation.byType)).toEqual([
      ['Crypto', '62.00'],
      ['Manual', '23.00'],
      ['Cash', '15.00'],
    ]);
    expect(share(result.allocation.byAccount)).toEqual([
      ['Bybit', '59.00'],
      ['Trust Wallet', '41.00'],
    ]);
    expect(result.allocation.complete).toBe(true);
    expect(assetOf(result, deposit).price).toMatchObject({ value: '2300', status: 'manual' });
  });
});
