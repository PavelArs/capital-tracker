import { FxConverter } from '../fx-rates/fx-conversion';
import { calculateFifo, type FifoTrade } from './fifo';
import {
  type PortfolioAccountInput,
  type PortfolioInstrument,
  type PortfolioLot,
  type PortfolioPrices,
  portfolioAccount,
  projectPortfolio,
  resolvePrice,
  type StoredPrice,
  withoutAssets,
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

describe('PV-KNOWN-PART profit over the coins whose cost is known', () => {
  it('prices the known part on its own and leaves the unknown coins out', () => {
    const result = projectPortfolio(
      now,
      [btc, eth],
      [
        holding(1, 'Trezor', [
          position(btc, '1', '50000'),
          position(btc, '0.5', null),
          position(eth, '2', '4000'),
        ]),
      ],
      prices({ BTC: ['60000', minutesAgo(5)], ETH: ['3000', minutesAgo(5)] }),
    );
    expect(assetOf(result, btc)).toMatchObject({
      unrealizedPnl: null,
      knownCostQuantity: '1',
      knownUnrealizedPnl: '10000',
      knownUnrealizedReturnPercent: '20.00',
    });
    expect(assetOf(result, eth)).toMatchObject({
      unrealizedPnl: '2000',
      knownCostQuantity: '2',
      knownUnrealizedPnl: '2000',
    });
    // 60000 - 50000 + 6000 - 4000 over a known cost of 54000.
    expect(result).toMatchObject({
      costBasis: null,
      unrealizedPnl: null,
      knownCostSubtotal: '54000',
      knownUnrealizedPnl: '12000',
      knownUnrealizedReturnPercent: '22.22',
    });
  });

  it('stays empty when a coin with a known cost has no price', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [holding(1, 'Trezor', [position(btc, '1', '50000'), position(btc, '0.5', null)])],
      prices({}),
    );
    expect(assetOf(result, btc).knownUnrealizedPnl).toBeNull();
    expect(result.knownUnrealizedPnl).toBeNull();
  });

  it('leaves a coin without a price out and counts the priced ones', () => {
    const result = projectPortfolio(
      now,
      [btc, eth],
      [holding(1, 'Trezor', [position(btc, '1', '50000'), position(eth, '2', '4000')])],
      prices({ ETH: ['3000', minutesAgo(5)] }),
    );
    expect(result).toMatchObject({
      totalValue: null,
      missingPriceCount: 1,
      unrealizedPnl: null,
      // Only ETH is priced: 6000 - 4000 over its cost.
      knownUnrealizedPnl: '2000',
      knownUnrealizedReturnPercent: '50.00',
    });
    expect(assetOf(result, btc)).toMatchObject({ unrealizedPnl: null, knownUnrealizedPnl: null });
  });

  it('is empty when no coin has a known cost', () => {
    const result = projectPortfolio(
      now,
      [btc],
      [holding(1, 'Trezor', [position(btc, '0.5', null)])],
      prices({ BTC: ['60000', minutesAgo(5)] }),
    );
    expect(assetOf(result, btc)).toMatchObject({
      knownCostQuantity: '0',
      knownUnrealizedPnl: null,
    });
    expect(result.knownUnrealizedPnl).toBeNull();
    expect(result.knownUnrealizedReturnPercent).toBeNull();
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

describe('PV-24H price change over the last 24 hours', () => {
  const dayAgo = (minutes: number) =>
    new Date(now.getTime() - 24 * 3_600_000 - minutes * 60_000).toISOString();
  const previous = (
    marketEntries: Record<string, [string, string]>,
    manual: Record<string, string> = {},
  ): PortfolioPrices => ({
    market: market(marketEntries),
    manual: new Map(
      Object.entries(manual).map(([instrumentId, priceUsd]) => [
        instrumentId,
        { priceUsd, observedAt: dayAgo(600), source: 'manual' },
      ]),
    ),
  });
  const accounts = [
    holding(1, 'Trust Wallet', [
      position(btc, '1', '100'),
      position(eth, '1', '100'),
      position(usd, '10', '10'),
      position(deposit, '1', '100'),
    ]),
  ];

  it('compares each price with the one stored 24 hours earlier', () => {
    const result = projectPortfolio(
      now,
      [btc, eth, usd, deposit],
      accounts,
      prices(
        { BTC: ['80000', minutesAgo(30)], ETH: ['2000', minutesAgo(30)] },
        { [deposit.id]: '110' },
      ),
      undefined,
      previous({ BTC: ['75000', dayAgo(30)], ETH: ['2500', dayAgo(150)] }, { [deposit.id]: '100' }),
    );
    expect(assetOf(result, btc).priceChange24hPercent).toBe('6.67');
    // A price more than 2 hours older than the moment 24 hours ago is not that day's price.
    expect(assetOf(result, eth).priceChange24hPercent).toBeNull();
    expect(assetOf(result, usd).priceChange24hPercent).toBe('0.00');
    expect(assetOf(result, deposit).priceChange24hPercent).toBe('10.00');
  });

  it('follows the rate of each day for cash in another currency', () => {
    const fx = new FxConverter(
      {
        USD: [
          { date: '2026-10-03', rubPerUnit: '80' },
          { date: '2026-10-04', rubPerUnit: '100' },
        ],
        EUR: [],
      },
      'RUB',
    );
    const result = projectPortfolio(now, [usd], accounts, prices({}), fx, previous({}));
    // One dollar was 80 rubles on 3 October and 100 rubles on 4 October (Moscow dates).
    expect(assetOf(result, usd).priceChange24hPercent).toBe('25.00');
  });

  it('is unknown while the current market price is stale', () => {
    const result = projectPortfolio(
      now,
      [btc],
      accounts,
      prices({ BTC: ['80000', minutesAgo(20 * 60)] }),
      undefined,
      previous({ BTC: ['75000', dayAgo(30)] }),
    );
    // A price collected 20 hours ago against one from 24 hours ago is not a 24-hour change.
    expect(assetOf(result, btc).price?.status).toBe('stale');
    expect(assetOf(result, btc).priceChange24hPercent).toBeNull();
  });

  it('is unknown without an earlier price', () => {
    const result = projectPortfolio(
      now,
      [btc, deposit],
      accounts,
      prices({ BTC: ['80000', minutesAgo(30)] }, { [deposit.id]: '110' }),
      undefined,
      previous({}),
    );
    expect(assetOf(result, btc).priceChange24hPercent).toBeNull();
    expect(assetOf(result, deposit).priceChange24hPercent).toBeNull();
    const without = projectPortfolio(
      now,
      [btc],
      accounts,
      prices({ BTC: ['80000', minutesAgo(30)] }),
    );
    expect(assetOf(without, btc).priceChange24hPercent).toBeNull();
  });
});

describe('PV-HIDE an asset the owner hid', () => {
  const accounts = [
    account(1, 'Bybit', [
      trade(btc, 'buy', '1', '50000'),
      trade(eth, 'buy', '10', '20000'),
      trade(eth, 'sell', '4', '10000'),
    ]),
  ];
  const priced = prices({ BTC: ['80000', minutesAgo(30)], ETH: ['3000', minutesAgo(30)] });

  it('leaves it out of the assets, the total and the realized sum, whatever the books hold', () => {
    const all = projectPortfolio(now, [btc, eth], accounts, priced);
    expect(all.totalValue).toBe('98000');
    expect(all.realizedPnl).toBe('2000');
    const hidden = new Set([eth.id]);
    const result = projectPortfolio(now, [btc], withoutAssets(accounts, hidden), priced);
    expect(result.assets.map((item) => item.instrumentId)).toEqual([btc.id]);
    expect(result).toMatchObject({ totalValue: '80000', realizedPnl: '0' });
    // The books themselves are not changed.
    expect(accounts[0].lots.some((lot) => lot.instrumentId === eth.id)).toBe(true);
    expect(accounts[0].realizations.some((item) => item.instrumentId === eth.id)).toBe(true);
  });

  it('changes nothing while no asset is hidden', () => {
    expect(withoutAssets(accounts, new Set())).toEqual(accounts);
  });
});

describe('DEP-VALUE bank deposits in the portfolio', () => {
  const worth = (amount: number) => BigInt(amount) * 10n ** 60n;
  const bank = (n: number, bankName: string, value: bigint | null) => ({
    id: id(900 + n),
    name: `Deposit ${n}`,
    bank: bankName,
    value,
  });
  const wallet = () => [account(1, 'Trust Wallet', [trade(btc, 'buy', '1', '50000')])];
  const priced = () => prices({ BTC: ['80000', minutesAgo(30)] });

  it('adds what the deposits are worth to the value, the shares and the allocation', () => {
    const result = projectPortfolio(now, [btc], wallet(), priced(), undefined, undefined, [
      bank(1, 'First Bank', worth(15_000)),
      bank(2, 'First Bank', worth(5_000)),
    ]);
    expect(result).toMatchObject({
      completeness: 'complete',
      totalValue: '100000',
      pricedSubtotal: '100000',
      depositsValue: '20000',
      unratedDepositCount: 0,
      // Deposits have no cost: the coins' figures stay what they were.
      costBasis: '50000',
      unrealizedPnl: '30000',
    });
    expect(assetOf(result, btc).allocationPercent).toBe('80.00');
    expect(result.allocation.byType).toEqual([
      { key: 'crypto', label: 'Crypto', value: '80000', percent: '80.00' },
      { key: 'deposits', label: 'Bank deposits', value: '20000', percent: '20.00' },
    ]);
    expect(result.allocation.byAccount).toEqual([
      { key: id(101), label: 'Trust Wallet', value: '80000', percent: '80.00' },
      { key: 'bank:First Bank', label: 'First Bank', value: '20000', percent: '20.00' },
    ]);
    expect(result.allocation.byAsset.map((slice) => slice.key)).toEqual(
      [btc.id, id(901), id(902)].map((key, index) => (index === 0 ? key : `deposit:${key}`)),
    );
  });

  it('counts a deposit without a rate as missing, not as nothing', () => {
    const result = projectPortfolio(now, [btc], wallet(), priced(), undefined, undefined, [
      bank(1, 'First Bank', worth(15_000)),
      bank(2, 'Second Bank', null),
    ]);
    expect(result).toMatchObject({
      completeness: 'incomplete',
      totalValue: null,
      pricedSubtotal: '95000',
      depositsValue: '15000',
      unratedDepositCount: 1,
    });
    expect(result.allocation.complete).toBe(false);
  });

  it('DEP-ACCOUNT-ZERO keeps a zero lower bound incomplete while interest is missing', () => {
    const result = projectPortfolio(now, [], [], prices({}), undefined, undefined, [
      { ...bank(1, 'First Bank', 0n), interestMissing: true },
    ]);
    expect(result).toMatchObject({
      totalValue: '0',
      completeness: 'incomplete',
      interestMissingDepositCount: 1,
    });
    expect(result.allocation.complete).toBe(false);
  });

  it('DEP-ACCOUNT counts the accounts without a rate, whose interest is not in the value', () => {
    const result = projectPortfolio(now, [btc], wallet(), priced(), undefined, undefined, [
      bank(1, 'First Bank', worth(15_000)),
      { ...bank(2, 'First Bank', worth(5_000)), interestMissing: true },
      { ...bank(3, 'First Bank', 0n), interestMissing: true },
    ]);
    // Their balance is what the owner put in: the total stays a floor figure, marked incomplete
    // so the history and goals do not take it for exact, and it says what it leaves out.
    expect(result).toMatchObject({
      completeness: 'incomplete',
      totalValue: '100000',
      depositsValue: '20000',
      interestMissingDepositCount: 2,
    });
    const without = projectPortfolio(now, [btc], wallet(), priced(), undefined, undefined, [
      bank(1, 'First Bank', worth(15_000)),
    ]);
    expect(assetOf(result, btc).allocationPercent).toBeNull();
    expect(assetOf(without, btc).allocationPercent).toBe('84.21');
    expect(without.interestMissingDepositCount).toBe(0);
    expect(without.allocation.complete).toBe(true);
    // The shares are worked out against that floor, so they carry the same "incomplete" mark.
    expect(result.allocation.complete).toBe(false);
  });

  it('keeps a deposit that is worth nothing out of the allocation', () => {
    const result = projectPortfolio(now, [btc], wallet(), priced(), undefined, undefined, [
      bank(1, 'First Bank', 0n),
    ]);
    expect(result.depositsValue).toBe('0');
    expect(result.allocation.byType.map((slice) => slice.key)).toEqual(['crypto']);
  });

  it('values a portfolio of deposits alone', () => {
    const result = projectPortfolio(now, [], [], prices({}), undefined, undefined, [
      bank(1, 'First Bank', worth(3_000)),
    ]);
    expect(result).toMatchObject({ totalValue: '3000', depositsValue: '3000' });
  });
});

describe('AST-MANUAL-VALUE a hand value keeps the currency it was set in', () => {
  const flat = instrument(20, 'Flat', null, {
    assetType: 'manual',
    valuationCurrency: 'RUB',
    priceSource: 'manual',
  });
  const set = (priceUsd: string, currency?: StoredPrice['currency']): PortfolioPrices => ({
    market: new Map(),
    manual: new Map([
      [flat.id, { priceUsd, observedAt: '2026-10-02T09:00:00.000Z', source: 'manual', currency }],
    ]),
  });
  const rates = (report: 'RUB' | 'USD') =>
    new FxConverter(
      {
        USD: [
          { date: '2026-10-02', rubPerUnit: '80' },
          { date: '2026-10-04', rubPerUnit: '100' },
        ],
        EUR: [],
      },
      report,
    );

  it('reads 500,000 RUB as 500,000 RUB whatever the dollar rate of the day', () => {
    const day = (at: string) =>
      resolvePrice(flat, set('500000', 'RUB'), new Date(at), rates('RUB')).price?.value;
    expect(day('2026-10-02T12:00:00.000Z')).toBe('500000');
    expect(day('2026-10-04T12:00:00.000Z')).toBe('500000');
  });

  it('states it in dollars at the rate of each day', () => {
    const usdOn = (at: string) =>
      resolvePrice(flat, set('500000', 'RUB'), new Date(at), rates('USD')).price?.value;
    expect(usdOn('2026-10-02T12:00:00.000Z')).toBe('6250');
    expect(usdOn('2026-10-04T12:00:00.000Z')).toBe('5000');
  });

  it('keeps reading a price stored before quote currencies as dollars', () => {
    const legacy = resolvePrice(flat, set('6250'), now, rates('RUB')).price?.value;
    expect(legacy).toBe('625000');
  });

  it('is missing, not zero, without the rate of the day', () => {
    const noRate = new FxConverter({ USD: [], EUR: [] }, 'USD');
    expect(resolvePrice(flat, set('500000', 'RUB'), now, noRate)).toEqual({
      price: null,
      missingPrice: 'no-rate',
    });
  });

  it('shows no 24-hour change for an unchanged hand value in its own currency', () => {
    const result = projectPortfolio(
      now,
      [flat],
      [holding(20, 'Home', [position(flat, '1', '6250')])],
      set('500000', 'RUB'),
      rates('RUB'),
      set('500000', 'RUB'),
    );
    expect(assetOf(result, flat).value).toBe('500000');
    expect(assetOf(result, flat).priceChange24hPercent).toBe('0.00');
  });
});
