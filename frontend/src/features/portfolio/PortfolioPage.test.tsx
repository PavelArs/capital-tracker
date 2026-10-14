import { accountingApi } from '@api/accounting.api';
import { type AssetHistory, assetHistoryApi } from '@api/asset-history.api';
import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import { type HiddenAsset, hiddenAssetsApi } from '@api/hidden-assets.api';
import { manualPricesApi, type PriceReceipt } from '@api/manual-prices.api';
import { type Operation, operationsApi } from '@api/operations.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import {
  type AssetLots,
  type AssetValuation,
  type LotAfterInflation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInflationBasis } from '../shell/inflation-basis';
import { setValueView } from '../shell/value-view';
import AssetLotsCard from './AssetLots';
import AssetPage from './AssetPage';
import PortfolioPage, { defaultSort, nextSort, phoneSort, sortAssets } from './PortfolioPage';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const valued = (
  n: number,
  name: string,
  symbol: string | null,
  kind: Pick<AssetValuation, 'assetType' | 'valuationCurrency' | 'priceSource'>,
  changes: Partial<AssetValuation> = {},
): AssetValuation => ({
  instrumentId: id(n),
  name,
  symbol,
  ...kind,
  quantity: '0',
  price: null,
  missingPrice: 'no-price',
  priceChange24hPercent: null,
  value: '0',
  allocationPercent: null,
  costBasis: '0',
  knownCostSubtotal: '0',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  knownCostQuantity: '0',
  averageBuyPrice: null,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: '0',
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings: [],
  ...changes,
});
const crypto = { assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market' } as const;
// PV-BR11: 1.2 BTC bought for 66000 USD, priced 80000.
const bitcoin = valued(1, 'Bitcoin', 'BTC', crypto, {
  quantity: '1.2',
  price: { value: '80000', observedAt: minutesAgo(30), source: 'kraken', status: 'fresh' },
  missingPrice: null,
  priceChange24hPercent: '-1.40',
  value: '96000',
  allocationPercent: '96.00',
  costBasis: '66000',
  knownCostSubtotal: '66000',
  averageBuyPrice: '55000',
  unrealizedPnl: '30000',
  unrealizedReturnPercent: '45.45',
  holdings: [
    { accountId: id(101), accountName: 'Trust Wallet', quantity: '1', value: '80000' },
    { accountId: id(102), accountName: 'Bybit', quantity: '0.2', value: '16000' },
  ],
});
const cash = valued(
  3,
  'US dollar',
  'USD',
  { assetType: 'fiat', valuationCurrency: 'USD', priceSource: 'fixed' },
  {
    quantity: '4000',
    price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
    missingPrice: null,
    priceChange24hPercent: '0.00',
    value: '4000',
    allocationPercent: '4.00',
    costBasis: '4000',
    averageBuyPrice: '1',
    unrealizedPnl: '0',
    unrealizedReturnPercent: '0.00',
  },
);
const rubles = valued(
  4,
  'Rubles',
  'RUB',
  {
    assetType: 'fiat',
    valuationCurrency: 'RUB',
    priceSource: 'fixed',
  },
  { quantity: '100000', missingPrice: 'no-rate', value: null, costBasis: '1200' },
);
const toncoin = valued(2, 'Toncoin', 'TON', {
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'manual',
});
const deposit = valued(5, 'Deposit', null, {
  assetType: 'manual',
  valuationCurrency: 'RUB',
  priceSource: 'manual',
});
const depositAsset: PortfolioAsset = {
  id: deposit.instrumentId,
  name: 'Deposit',
  symbol: null,
  namespace: 'manual',
  assetType: 'manual',
  valuationCurrency: 'RUB',
  priceSource: 'manual',
  createdAt: '2026-10-04T12:00:00.000Z',
};

function portfolio(assets: AssetValuation[], changes: Partial<PortfolioValuation> = {}) {
  return {
    at: new Date().toISOString(),
    currency: 'USD',
    mainCurrency: 'USD',
    rates: [],
    completeness: 'complete',
    totalValue: '100000',
    pricedSubtotal: '100000',
    missingPriceCount: 0,
    stalePriceCount: 0,
    unavailableAccountCount: 0,
    depositsValue: '0',
    unratedDepositCount: 0,
    costBasis: '70000',
    knownCostSubtotal: '70000',
    unknownCostCount: 0,
    missingRateCount: 0,
    unrealizedPnl: '30000',
    unrealizedReturnPercent: '42.86',
    knownUnrealizedPnl: '30000',
    knownUnrealizedReturnPercent: '42.86',
    realizedPnl: '-250.5',
    knownRealizedSubtotal: '-250.5',
    unknownRealizedCount: 0,
    assets,
    allocation: {
      complete: true,
      byAsset: [
        { key: bitcoin.instrumentId, label: 'Bitcoin', value: '96000', percent: '96.00' },
        { key: cash.instrumentId, label: 'US dollar', value: '4000', percent: '4.00' },
      ],
      byType: [
        { key: 'crypto', label: 'Crypto', value: '96000', percent: '96.00' },
        { key: 'fiat', label: 'Cash', value: '4000', percent: '4.00' },
      ],
      byAccount: [
        { key: id(101), label: 'Trust Wallet', value: '80000', percent: '80.00' },
        { key: id(102), label: 'Bybit', value: '20000', percent: '20.00' },
      ],
    },
    accounts: [],
    ...changes,
  } satisfies PortfolioValuation;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/portfolio/:assetId" element={<AssetPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
// Add opens Add to portfolio; a coin, cash or anything by hand is "Something else".
async function openAddAsset(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add' }));
  const picker = screen.getByRole('dialog', { name: 'Add to portfolio' });
  await user.click(within(picker).getByRole('button', { name: /^Something else/ }));
}
const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`) });
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
const httpError = (status: number) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

// One manual account without a journal yet: its first trade starts one (OPS-ADD-BUY).
const createTrade = vi.fn();
const setPrice = vi.fn();
const receiptFor = (quantity: string, grossUsd: string): TradeReceipt =>
  ({
    accountId: id(101),
    journalRevision: 1,
    trade: { quantity, grossUsd, feeUsd: '0', occurredAt: '2026-10-05T10:15:00.000Z' },
  }) as TradeReceipt;
const emptyHistory = (instrumentId: string): AssetHistory => ({
  instrumentId,
  period: '1M',
  currency: 'USD',
  mainCurrency: 'USD',
  from: '2026-09-05T00:00:00.000Z',
  at: '2026-10-05T12:00:00.000Z',
  points: [],
});

const rates = (usd: string | null, eur: string | null): FxRatesReport => ({
  date: '2026-10-05',
  source: 'cbr',
  rates: [
    { currency: 'USD', rubPerUnit: usd, date: usd && '2026-10-05' },
    { currency: 'EUR', rubPerUnit: eur, date: eur && '2026-10-05' },
  ],
  sync: null,
});

beforeEach(() => {
  vi.restoreAllMocks();
  createTrade.mockReset();
  setPrice.mockReset();
  vi.spyOn(fxRatesApi, 'get').mockResolvedValue(rates('90.12', '100.5'));
  vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      {
        id: id(101),
        name: 'Trust Wallet',
        kind: null,
        currentRevision: 0,
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    nextCursor: null,
  });
  vi.spyOn(tradesApi, 'state').mockResolvedValue({
    accountId: id(101),
    eligible: true,
    ineligibilityReason: null,
    journal: null,
  } as JournalState);
  createTrade.mockImplementation(async (_account, command) =>
    receiptFor(command.quantity, command.grossUsd ?? '1500'),
  );
  vi.spyOn(tradesApi, 'create').mockImplementation(createTrade);
  setPrice.mockResolvedValue({} as PriceReceipt);
  vi.spyOn(manualPricesApi, 'set').mockImplementation(setPrice);
  vi.spyOn(operationsApi, 'list').mockResolvedValue({
    at: '2026-10-05T12:00:00.000Z',
    quoteCurrency: 'USD',
    needsClassificationCount: 0,
    dustThresholdUsd: null,
    operations: [],
  });
  vi.spyOn(assetHistoryApi, 'get').mockImplementation(async (instrumentId) =>
    emptyHistory(instrumentId),
  );
  vi.spyOn(portfolioValuationApi, 'lots').mockImplementation(async (instrumentId) => ({
    instrumentId,
    currency: 'USD',
    complete: true,
    lots: [],
  }));
});
afterEach(cleanup);

describe('PV-UI Portfolio values every asset', () => {
  it('shows the summary, allocation groupings and valued rows', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin, cash, rubles, toncoin], {
        completeness: 'incomplete',
        totalValue: null,
        missingPriceCount: 1,
        allocation: { ...portfolio([]).allocation, complete: false },
      }),
    );
    const user = userEvent.setup();
    renderAt('/portfolio');
    expect(screen.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading portfolio' })).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    // The priced assets are the value; the unpriced one is named under it, and one tooltip
    // says the figures leave out coins without a price.
    expect(summary).toHaveTextContent('Current value$100,000.001 asset without a price');
    expect(within(summary).getByRole('img', { name: /Coins without a price/ })).toBeInTheDocument();
    expect(summary).toHaveTextContent('Cost basis$70,000.00');
    expect(summary).toHaveTextContent('Unrealized P&L+$30,000.00+42.86%');
    expect(summary).toHaveTextContent('Realized P&L-$250.50');

    expect(cells(rowOf('Bitcoin'))).toEqual([
      'BitcoinBTC · Crypto · USD',
      '1.2',
      '$80,000.00Market price · 30 min ago',
      '$96,000.00',
      '96.00%',
      '$55,000.00',
      '+$30,000.00+45.45%',
      '-1.40%',
    ]);
    expect(cells(rowOf('US dollar'))).toEqual([
      'US dollarUSD · Cash · USD',
      '4,000',
      '$1.00Fixed',
      '$4,000.00',
      '4.00%',
      '$1.00',
      '$0.000.00%',
      '0.00%',
    ]);
    expect(cells(rowOf('Rubles'))).toEqual([
      'RublesRUB · Cash · RUB',
      '100,000',
      'No rateFixed',
      '—',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(cells(rowOf('Toncoin'))).toEqual([
      'ToncoinTON · Crypto · USD',
      '0',
      'No priceManual',
      '$0.00',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(within(rowOf('Bitcoin')).getByRole('link', { name: 'Bitcoin' })).toHaveAttribute(
      'href',
      `/portfolio/${bitcoin.instrumentId}`,
    );

    const allocation = screen.getByRole('region', { name: 'Allocation' });
    // The assets table comes first; how they are split follows it (review item P1).
    const assetsCard = screen.getByRole('region', { name: 'Assets' });
    expect(
      assetsCard.compareDocumentPosition(allocation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const grouping = within(allocation).getByRole('radiogroup', { name: 'Group allocation by' });
    const slices = () =>
      within(allocation)
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    // Each asset keeps its own colour, whatever its place in the list (asset identity).
    const swatches = () =>
      within(allocation)
        .getAllByRole('listitem')
        .map((item) => (item.querySelector('.portfolio-swatch') as HTMLElement).style.background);
    expect(slices()).toEqual(['Bitcoin BTC$96,000.0096.00%', 'US dollar USD$4,000.004.00%']);
    expect(swatches()).toEqual(['var(--c-btc)', 'var(--c-cash)']);
    expect(
      within(rowOf('Bitcoin')).getAllByRole('cell')[0].querySelector('.asset-icon'),
    ).toHaveAttribute('data-glyph', '₿');
    await user.click(within(grouping).getByRole('radio', { name: 'Type' }));
    expect(slices()).toEqual(['Crypto$96,000.0096.00%', 'Cash$4,000.004.00%']);
    expect(swatches()).toEqual(['var(--c-eth)', 'var(--c-cash)']);
    await user.click(within(grouping).getByRole('radio', { name: 'Wallets' }));
    expect(slices()).toEqual(['Trust Wallet$80,000.0080.00%', 'Bybit$20,000.0020.00%']);
    expect(allocation).toHaveTextContent('Assets without a price are not included.');
  });

  it('marks stale prices and unknown cost honestly', async () => {
    const stale = {
      ...bitcoin,
      price: { ...bitcoin.price!, observedAt: minutesAgo(180), status: 'stale' as const },
      costBasis: null,
      unknownCostQuantity: '0.2',
      knownCostSubtotal: '50000',
      averageBuyPrice: '50000',
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
      knownCostQuantity: '1',
      knownUnrealizedPnl: '30000',
      knownUnrealizedReturnPercent: '60.00',
    };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([stale], {
        stalePriceCount: 1,
        costBasis: null,
        knownCostSubtotal: '50000',
        unknownCostCount: 1,
        unrealizedPnl: null,
        unrealizedReturnPercent: null,
        knownUnrealizedPnl: '30000',
        knownUnrealizedReturnPercent: '60.00',
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(cells(rowOf('Bitcoin'))[2]).toBe('$80,000.00Market price · stale, 3 h ago');
    // The table shows the profit of the coins with a known purchase price, not a dash.
    expect(cells(rowOf('Bitcoin'))[6]).toBe('+$30,000.00+60.00%');
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    // The known part stands on its own instead of emptying cost basis and profit.
    expect(summary).toHaveTextContent('Cost basis$50,000.00Unrealized P&L+$30,000.00+60.00%');
    expect(summary).not.toHaveTextContent('known part only');
    expect(within(summary).getByRole('img', { name: /Coins without a price/ })).toBeInTheDocument();
    expect(within(summary).getByRole('note')).toHaveTextContent(
      '1 price is older than 2 hours; the last stored price is used.',
    );
  });

  it('PV-KNOWN-PART shows the profit of the priced coins when another has no price', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin, toncoin], {
        completeness: 'incomplete',
        totalValue: null,
        missingPriceCount: 1,
        unrealizedPnl: null,
        unrealizedReturnPercent: null,
        knownUnrealizedPnl: '30000',
        knownUnrealizedReturnPercent: '60.00',
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    // The coin without a price stays out of the profit instead of emptying it.
    expect(summary).toHaveTextContent('Unrealized P&L+$30,000.00+60.00%');
    expect(within(summary).getByRole('img', { name: /Coins without a price/ })).toBeInTheDocument();
  });

  it('PV-KNOWN-PART shows realized P&L of the sales with a known cost and no tooltip when complete', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin], {
        realizedPnl: null,
        knownRealizedSubtotal: '-250.5',
        unknownRealizedCount: 1,
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent('Realized P&L-$250.50');
    expect(within(summary).getByRole('img', { name: /Coins without a price/ })).toBeInTheDocument();
    cleanup();
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(
      within(screen.getByRole('region', { name: 'Portfolio summary' })).queryByRole('img'),
    ).toBeNull();
  });

  it('names a later-starting account as the gap and shows a dust amount as non-zero', async () => {
    const dust = { ...bitcoin, quantity: '0.000000001', holdings: [] };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([dust], {
        completeness: 'incomplete',
        totalValue: null,
        unavailableAccountCount: 1,
        costBasis: null,
        knownCostSubtotal: '70000',
        unrealizedPnl: null,
        unrealizedReturnPercent: null,
        allocation: { ...portfolio([]).allocation, complete: false },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent(
      'Cost basis—$70,000.00 known, an account history starts later',
    );
    expect(summary).not.toHaveTextContent('no purchase price');
    const allocation = screen.getByRole('region', { name: 'Allocation' });
    expect(allocation).toHaveTextContent('Accounts whose history starts later are not included.');
    expect(cells(rowOf('Bitcoin'))[1]).toBe('<0.00000001');
  });

  it('counts bank deposits in the value, links them and lists them in the allocation', async () => {
    const base = portfolio([bitcoin]);
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin], {
        depositsValue: '20000',
        allocation: {
          ...base.allocation,
          byType: [
            { key: 'crypto', label: 'Crypto', value: '80000', percent: '80.00' },
            { key: 'deposits', label: 'Bank deposits', value: '20000', percent: '20.00' },
          ],
          byAccount: [
            { key: id(101), label: 'Trust Wallet', value: '80000', percent: '80.00' },
            {
              key: 'bank:Synthetic Bank',
              label: 'Synthetic Bank',
              value: '20000',
              percent: '20.00',
            },
          ],
        },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent('$20,000.00 in bank deposits');
    expect(within(summary).getByRole('link', { name: 'bank deposits' })).toHaveAttribute(
      'href',
      '/deposits',
    );
    const allocation = screen.getByRole('region', { name: 'Allocation' });
    const user = userEvent.setup();
    await user.click(within(allocation).getByRole('radio', { name: 'Type' }));
    expect(allocation).toHaveTextContent('Bank deposits$20,000.0020.00%');
    await user.click(within(allocation).getByRole('radio', { name: 'Wallets' }));
    expect(allocation).toHaveTextContent('Synthetic Bank$20,000.00');
  });

  it('shows the value and allocation of an owner who holds nothing but bank deposits', async () => {
    const base = portfolio([]);
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([], {
        totalValue: '20000',
        pricedSubtotal: '20000',
        depositsValue: '20000',
        allocation: {
          ...base.allocation,
          byType: [{ key: 'deposits', label: 'Bank deposits', value: '20000', percent: '100.00' }],
        },
      }),
    );
    renderAt('/portfolio');
    const summary = await screen.findByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent('$20,000.00 in bank deposits');
    expect(screen.getByText('No assets yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('region', { name: 'Allocation' })).toBeInTheDocument();
  });

  it('says so when a deposit has no current rate and leaves it out of the value', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin], {
        completeness: 'incomplete',
        totalValue: null,
        unratedDepositCount: 2,
        allocation: { ...portfolio([]).allocation, complete: false },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(screen.getByRole('region', { name: 'Portfolio summary' })).toHaveTextContent(
      '2 deposits without a rate',
    );
    expect(screen.getByRole('region', { name: 'Allocation' })).toHaveTextContent(
      'Deposits without a current exchange rate are not included.',
    );
  });

  it('keeps the loaded portfolio when a later refresh fails and ignores a stale reply', async () => {
    let resolveSlow: (value: PortfolioValuation) => void = () => {};
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockResolvedValueOnce(portfolio([bitcoin]))
      .mockImplementationOnce(
        () =>
          new Promise<PortfolioValuation>((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValueOnce(portfolio([bitcoin, cash]))
      .mockRejectedValueOnce(new AxiosError('offline'));
    // A saved asset drops what was kept, as the client does after any write, so a refresh
    // asks again instead of joining the one still on its way.
    vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      forgetReads();
      return depositAsset;
    });
    const user = userEvent.setup();
    const add = async () => {
      await openAddAsset(user);
      const dialog = screen.getByRole('dialog', { name: 'Add asset' });
      await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
      await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
      await user.type(within(dialog).getByLabelText('Ticker'), 'TON');
      await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    // The first refresh hangs; the second answers first, then the late reply arrives.
    await add();
    await add();
    await screen.findByRole('row', { name: /^US dollar/ });
    resolveSlow(portfolio([toncoin]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('row', { name: /^Toncoin/ })).toBeNull();
    expect(rowOf('US dollar')).toBeInTheDocument();

    await add();
    expect(await screen.findByText(/could not refresh/i)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(4);
    expect(rowOf('Bitcoin')).toBeInTheDocument();
    expect(screen.queryByText(/could not load your portfolio/i)).toBeNull();
  });

  it('opens an asset with its numbers, price source and holdings', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash]));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await user.click(await screen.findByRole('link', { name: 'Bitcoin' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bitcoin' })).toBeInTheDocument();
    const stats = screen.getByRole('region', { name: 'Position' });
    const stat = (label: string) =>
      within(stats).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(stat('Amount')).toBe('1.2 BTC');
    expect(stat('Current value')).toBe('$96,000.00');
    expect(stat('Average buy price')).toBe('$55,000.00');
    expect(stat('Cost basis')).toBe('$66,000.00');
    expect(stat('Unrealized P&L')).toBe('+$30,000.00+45.45%');
    expect(stat('Realized P&L')).toBe('$0.00');
    expect(screen.getByText('Kraken · updated 30 min ago')).toBeInTheDocument();
    const holdings = screen.getByRole('region', { name: 'Holdings' });
    expect(
      within(holdings)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Trust Wallet1 BTC$80,000.00', 'Bybit0.2 BTC$16,000.00']);
    expect(within(holdings).getByRole('link', { name: 'Trust Wallet' })).toHaveAttribute(
      'href',
      `/wallets/${id(101)}`,
    );
    await user.click(screen.getByRole('link', { name: '← Portfolio' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
  });

  it('A3 names how a wallet is held under its name in Holdings, when the owner said', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash]));
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: id(101),
          name: 'Trust Wallet',
          kind: 'software',
          currentRevision: 0,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/portfolio');
    await user.click(await screen.findByRole('link', { name: 'Bitcoin' }));
    const holdings = await screen.findByRole('region', { name: 'Holdings' });
    await waitFor(() =>
      expect(
        within(holdings)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['Trust WalletSoftware wallet1 BTC$80,000.00', 'Bybit0.2 BTC$16,000.00']),
    );
  });

  it('names a property account in Holdings without sending it to Wallets (v8)', async () => {
    // Codex P2: a property account has no wallet page.
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash]));
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: id(101),
          name: 'Trust Wallet',
          kind: null,
          assetClass: 'property',
          currentRevision: 0,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/portfolio');
    await user.click(await screen.findByRole('link', { name: 'Bitcoin' }));
    const holdings = await screen.findByRole('region', { name: 'Holdings' });
    await waitFor(() => expect(within(holdings).getAllByRole('link')).toHaveLength(1));
    expect(within(holdings).queryByRole('link', { name: 'Trust Wallet' })).toBeNull();
    expect(holdings).toHaveTextContent('Trust Wallet1 BTC');
  });

  it('explains a missing rate, an unknown asset and a failed load', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue(portfolio([rubles]));
    const user = userEvent.setup();
    renderAt(`/portfolio/${rubles.instrumentId}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load this asset/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rubles' })).toBeInTheDocument();
    expect(screen.getByText('No rate')).toBeInTheDocument();
    expect(screen.getByText('No Bank of Russia rate stored to show it in USD')).toBeInTheDocument();
    expect(screen.getByText('Nothing held right now.')).toBeInTheDocument();
    cleanup();
    renderAt(`/portfolio/${id(999)}`);
    expect(await screen.findByRole('heading', { name: 'Asset not found' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);
  });
});

// INFL-REAL-PF: the cost in today's money and the profit over it, under the Nominal / Real switch.
describe('Portfolio after inflation', () => {
  const read = (cost: string, pnl: string | null, percent: string | null, estimated = false) => ({
    costBasis: cost,
    unrealizedPnl: pnl,
    unrealizedReturnPercent: percent,
    estimated,
  });
  const realBitcoin = {
    ...bitcoin,
    real: {
      official: read('75000', '21000', '28.00'),
      personal: { ...read('80000', '16000', '20.00', true), ownRate: true },
    },
  };
  const realCash = {
    ...cash,
    real: {
      official: read('4100', '-100', '-2.44'),
      personal: { ...read('4200', '-200', '-4.76', true), ownRate: true },
    },
  };
  const withReal = (extra: Partial<PortfolioValuation> = {}) =>
    portfolio([realBitcoin, realCash], {
      real: {
        official: read('79100', '20900', '26.42'),
        personal: { ...read('84200', '15800', '18.76', true), ownRate: true },
      },
      ...extra,
    });
  beforeEach(() => {
    setValueView('nominal');
    setInflationBasis('official');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(withReal());
  });
  // The choice is kept in this browser, so the next test must not inherit it.
  afterEach(() => {
    setValueView('nominal');
    setInflationBasis('official');
  });
  const summary = () => screen.getByRole('region', { name: 'Portfolio summary' });

  it('PF-REAL-NOMINAL opens on the nominal figures and shows the real ones beside them', async () => {
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent("Cost basis$70,000.00$79,100.00 in today's money");
    expect(summary()).toHaveTextContent('Unrealized P&L+$30,000.00+42.86%Real +$20,900.00');
    expect(screen.getByRole('button', { name: 'Unrealized P&L' })).toBeInTheDocument();
    expect(cells(rowOf('Bitcoin')).at(-2)).toBe('+$30,000.00+45.45%');
    expect(screen.getByRole('radio', { name: 'Nominal' })).toBeChecked();
  });

  it('PF-REAL-SWITCH Real puts the cost in today money and the real profit first', async () => {
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    await user.click(screen.getByRole('radio', { name: 'Real' }));
    expect(summary()).toHaveTextContent(
      "Cost in today's money$79,100.00$70,000.00 paid + $9,100.00 inflation",
    );
    expect(summary()).toHaveTextContent('Real P&L+$20,900.00+26.42%Nominal +$30,000.00');
    expect(summary()).toHaveTextContent("In today's USD, at the official rate");
    expect(within(summary()).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('button', { name: 'Real P&L' })).toBeInTheDocument();
    expect(cells(rowOf('Bitcoin')).at(-2)).toBe('+$21,000.00+28.00%nominal +$30,000.00');
    expect(cells(rowOf('US dollar')).at(-2)).toBe('-$100.00-2.44%nominal $0.00');
  });

  it('PF-REAL-OWN-RATE reads the figures at the own rate when that is chosen', async () => {
    setInflationBasis('personal');
    setValueView('real');
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent("Cost in today's money$84,200.00");
    expect(summary()).toHaveTextContent('Real P&L+$15,800.00+18.76%');
    expect(summary()).toHaveTextContent("In today's USD, at your own rate");
    expect(cells(rowOf('Bitcoin')).at(-2)).toContain('+$16,000.00+20.00%');
  });

  it('PF-REAL-SORT orders by the real profit under Real', async () => {
    const user = userEvent.setup();
    // Nominal: Bitcoin +30000 before the dollar 0. Real: the dollar is ahead only by being less negative.
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio(
        [
          {
            ...realBitcoin,
            real: { ...realBitcoin.real, official: read('99000', '-3000', '-3.03') },
          },
          { ...realCash, real: { ...realCash.real, official: read('3900', '100', '2.56') } },
        ],
        { real: withReal().real },
      ),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    await user.click(screen.getByRole('radio', { name: 'Real' }));
    await user.click(screen.getByRole('button', { name: 'Real P&L' }));
    const order = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent?.slice(0, 7));
    expect(order()).toEqual(['US doll', 'Bitcoin']);
  });

  it('PF-REAL-EXACT states the inflation added to a cost wider than a float holds', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      withReal({
        costBasis: '9007199254740993',
        real: { official: read('9007199254740995', '1', '0'), personal: null },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent('+ $2.00 inflation');
  });

  it('PF-REAL-SORT-EXACT orders profits a float cannot tell apart', async () => {
    const user = userEvent.setup();
    setValueView('real');
    const big = (name: string, pnl: string) => ({
      ...realBitcoin,
      instrumentId: `id-${name}`,
      name,
      symbol: name,
      real: { official: read('1', pnl, '1'), personal: null },
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([big('Aaa', '9007199254740992'), big('Zzz', '9007199254740993')], {
        real: withReal().real,
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Aaa/ });
    await user.click(screen.getByRole('button', { name: 'Real P&L' }));
    const order = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent?.slice(0, 3));
    // The first click is largest first; the floats are equal, so only an exact compare puts Zzz first.
    expect(order()).toEqual(['Zzz', 'Aaa']);
  });

  it('PF-REAL-UNKNOWN keeps the nominal figures and says why there is no real one', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([{ ...bitcoin, real: { official: null, personal: null } }], {
        real: { official: null, personal: null },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent("Cost in today's money—");
    expect(summary()).toHaveTextContent('Real P&L—');
    expect(summary()).toHaveTextContent(
      'a purchase price, exchange rate or inflation figure is missing',
    );
    expect(summary()).toHaveTextContent('$70,000.00 paid');
    expect(summary()).toHaveTextContent('Nominal +$30,000.00');
    expect(cells(rowOf('Bitcoin')).at(-2)).toBe('—');
  });

  it('PF-REAL-UNKNOWN-PARTIAL keeps the known nominal cost when only part of it is known', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio(
        [{ ...bitcoin, knownCostQuantity: '0.7', real: { official: null, personal: null } }],
        {
          costBasis: null,
          unrealizedPnl: null,
          knownCostSubtotal: '40000',
          knownUnrealizedPnl: '12000',
          unknownCostCount: 1,
          real: { official: null, personal: null },
        },
      ),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent("Cost in today's money—");
    expect(summary()).toHaveTextContent('$40,000.00 known');
    expect(summary()).toHaveTextContent('Nominal +$12,000.00 known');
    expect(summary()).not.toHaveTextContent('paid');
  });

  it('PF-REAL-UNAVAILABLE names the account history that starts later, not a missing lot figure', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([{ ...bitcoin, real: withReal().assets[0].real }], {
        unavailableAccountCount: 1,
        real: { official: null, personal: null },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent("Cost in today's money—");
    expect(summary()).toHaveTextContent('an account history starts later');
    expect(summary()).not.toHaveTextContent('a purchase price, exchange rate or inflation');
  });

  it('PF-REAL-LEGACY keeps the nominal page for an answer saved before real figures existed', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash]));
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent('Cost basis');
    expect(summary()).toHaveTextContent('Unrealized P&L');
    expect(summary()).not.toHaveTextContent('is missing for some lots');
    expect(screen.getByRole('button', { name: 'Unrealized P&L' })).toBeInTheDocument();
  });

  const position = () => screen.getByRole('region', { name: 'Position' });

  it('ASSET-REAL-NOMINAL shows the real cost and profit beside the nominal ones', async () => {
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent("Cost basis$66,000.00$75,000.00 in today's money");
    expect(position()).toHaveTextContent('Unrealized P&L+$30,000.00+45.45%Real +$21,000.00');
    expect(screen.getByRole('radio', { name: 'Nominal' })).toBeChecked();
  });

  it('ASSET-REAL-SWITCH Real puts the cost in today money and the real profit first', async () => {
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    await user.click(screen.getByRole('radio', { name: 'Real' }));
    expect(position()).toHaveTextContent(
      "Cost in today's money$75,000.00$66,000.00 paid + $9,000.00 inflation",
    );
    expect(position()).toHaveTextContent('Real P&L+$21,000.00+28.00%Nominal +$30,000.00');
    expect(position()).toHaveTextContent("In today's USD, at the official rate");
    // The choice is the same one the Portfolio and the Dashboard use.
    await user.click(screen.getByRole('radio', { name: 'Nominal' }));
    expect(position()).toHaveTextContent('Unrealized P&L');
  });

  it('ASSET-REAL-OWN-RATE follows the basis chosen in Settings', async () => {
    setValueView('real');
    setInflationBasis('personal');
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent('Real P&L+$16,000.00+20.00%');
    expect(position()).toHaveTextContent("In today's USD, at your own rate");
  });

  it('ASSET-REAL-UNKNOWN keeps the nominal figures and says why there is no real one', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([{ ...bitcoin, real: { official: null, personal: null } }]),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent("Cost in today's money—");
    expect(position()).toHaveTextContent('a purchase price, exchange rate or inflation figure');
    expect(position()).toHaveTextContent('Real P&L—');
    // Both nominal figures stay on screen beside the dashes.
    expect(position()).toHaveTextContent('$66,000.00 paid');
    expect(position()).toHaveTextContent('Nominal +$30,000.00');
  });

  it('ASSET-REAL-UNKNOWN-PARTIAL keeps the known nominal cost when only part of it is known', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([
        {
          ...bitcoin,
          costBasis: null,
          unrealizedPnl: null,
          knownCostSubtotal: '40000',
          knownUnrealizedPnl: '12000',
          knownCostQuantity: '0.7',
          unknownCostQuantity: '0.5',
          real: { official: null, personal: null },
        },
      ]),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent("Cost in today's money—");
    expect(position()).toHaveTextContent('$40,000.00 known');
    expect(position()).toHaveTextContent('Nominal +$12,000.00 known');
    expect(position()).not.toHaveTextContent('paid');
  });

  it('ASSET-REAL-ZERO-COST keeps a known zero cost beside an unknown one', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([
        {
          ...bitcoin,
          costBasis: null,
          unrealizedPnl: null,
          knownCostSubtotal: '0',
          knownCostQuantity: '0.7',
          unknownCostQuantity: '0.5',
          real: { official: null, personal: null },
        },
      ]),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent('$0.00 known');
  });

  it('ASSET-REAL-INCOMPLETE says the figures leave out an account whose history starts later, in every view', async () => {
    const user = userEvent.setup();
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      withReal({ unavailableAccountCount: 2 }),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    const notice = '2 accounts whose history starts later are left out of these figures';
    expect(position()).toHaveTextContent(notice);
    await user.click(screen.getByRole('radio', { name: 'Real' }));
    expect(position()).toHaveTextContent('Real P&L+$21,000.00');
    expect(position()).toHaveTextContent(notice);
  });

  it('ASSET-REAL-INCOMPLETE-NULL keeps the notice when there is no real reading', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([{ ...bitcoin, real: { official: null, personal: null } }], {
        unavailableAccountCount: 1,
      }),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent(
      '1 account whose history starts later is left out of these figures',
    );
  });

  it('ASSET-REAL-SOLD does not call a fully sold asset incomplete', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([
        {
          ...bitcoin,
          quantity: '0',
          value: '0',
          costBasis: '0',
          unrealizedPnl: null,
          knownUnrealizedPnl: null,
          real: { official: null, personal: null },
        },
      ]),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent("Cost in today's money$0.00");
    expect(position()).toHaveTextContent('Nothing held, so there is no real cost or profit');
    expect(position()).toHaveTextContent('Real P&L$0.00Nominal $0.00');
    expect(position()).not.toHaveTextContent('is missing');
  });

  it('ASSET-REAL-DEFLATION words a fall in prices as deflation', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([
        { ...bitcoin, real: { official: read('60000', '36000', '60.00'), personal: null } },
      ]),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent('$66,000.00 paid − $6,000.00 deflation');
    expect(position()).not.toHaveTextContent('+ -');
  });

  it('ASSET-REAL-SOLD-PARTIAL keeps the missing-history state when an account is unavailable', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio(
        [{ ...bitcoin, quantity: '0', value: '0', real: { official: null, personal: null } }],
        { unavailableAccountCount: 1 },
      ),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent('an account history starts later');
    expect(position()).not.toHaveTextContent('Nothing held');
  });

  it('PF-REAL-DEFLATION words a fall in prices as deflation in the summary', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      withReal({ real: { official: read('65000', '35000', '53.85'), personal: null } }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).toHaveTextContent('$70,000.00 paid − $5,000.00 deflation');
  });

  it('ASSET-REAL-LEGACY stays nominal for an answer saved before real figures existed', async () => {
    setValueView('real');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(position()).toHaveTextContent('Cost basis');
    expect(position()).not.toHaveTextContent('is missing');
  });

  it('PF-REAL-OLD-ANSWER shows nothing extra for an answer saved before this existed', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash]));
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(summary()).not.toHaveTextContent("in today's money");
    expect(summary()).not.toHaveTextContent('Real +');
  });

  it('PF-REAL-PHONE shows the real profit in a phone row under Real', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      setValueView('real');
      renderAt('/portfolio');
      const row = await screen.findByRole('link', { name: /^Bitcoin/ });
      expect(row).toHaveTextContent('Bitcoin1.2 BTC$96,000.00+$21,000.00 · +28.00%');
      const sort = screen.getByRole('combobox', { name: 'Sort by' });
      expect(within(sort).getByRole('option', { name: 'Real P&L' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('INFL-REAL-LOTS Purchases after inflation', () => {
  const lot = (changes: Partial<LotAfterInflation> = {}): LotAfterInflation => ({
    accountId: id(101),
    accountName: 'Trust Wallet',
    acquiredAt: '2026-01-10T09:00:00.000Z',
    quantity: '0.2',
    paid: '12000',
    value: '16000',
    nominalPnl: '4000',
    real: {
      official: {
        inflationPercent: '10.00',
        costBasis: '13200',
        unrealizedPnl: '2800',
        unrealizedReturnPercent: '21.21',
        estimated: true,
      },
      personal: {
        inflationPercent: '7.00',
        costBasis: '12840',
        unrealizedPnl: '3160',
        unrealizedReturnPercent: '24.61',
        estimated: true,
        ownRate: true,
      },
    },
    ...changes,
  });
  const older = lot({
    accountName: 'Bybit',
    acquiredAt: '2025-01-10T09:00:00.000Z',
    quantity: '1',
    paid: '54000',
    value: '80000',
    nominalPnl: '26000',
    real: {
      official: {
        inflationPercent: '50.00',
        costBasis: '81000',
        unrealizedPnl: '-1000',
        unrealizedReturnPercent: '-1.23',
        estimated: false,
      },
      personal: null,
    },
  });
  const unreadable = lot({
    accountName: 'Old exchange',
    acquiredAt: '2024-05-01T09:00:00.000Z',
    quantity: '0.05',
    paid: null,
    value: '4000',
    nominalPnl: null,
    real: { official: null, personal: null },
  });
  const answer = (lots: LotAfterInflation[], complete = true): AssetLots => ({
    instrumentId: bitcoin.instrumentId,
    currency: 'USD',
    complete,
    lots,
  });
  const withLots = (lots: LotAfterInflation[], complete = true) =>
    vi.spyOn(portfolioValuationApi, 'lots').mockResolvedValue(answer(lots, complete));
  // The card is there while it loads; its answer is in once the placeholder is gone.
  const card = async () => {
    const region = await screen.findByRole('region', { name: 'Purchases after inflation' });
    await waitFor(() => expect(within(region).queryByRole('status')).toBeNull());
    return region;
  };
  const bodyRows = (region: HTMLElement) => within(region).getAllByRole('row').slice(1);

  beforeEach(() => {
    setValueView('nominal');
    setInflationBasis('official');
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
  });
  afterEach(() => {
    setValueView('nominal');
    setInflationBasis('official');
    vi.unstubAllGlobals();
  });

  it('LOTS-ROWS lists each purchase newest first with what it cost in today money', async () => {
    withLots([lot(), older]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(portfolioValuationApi.lots).toHaveBeenCalledWith(bitcoin.instrumentId, undefined);
    const rows = bodyRows(region);
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])).toEqual([
      'Jan 10, 2026Trust Wallet',
      '0.2',
      '$12,000.00',
      '+10.00%',
      '$13,200.00',
      '$16,000.00',
      '+$2,800.00+21.21%nominal +$4,000.00',
    ]);
    expect(cells(rows[1])).toEqual([
      'Jan 10, 2025Bybit',
      '1',
      '$54,000.00',
      '+50.00%',
      '$81,000.00',
      '$80,000.00',
      '-$1,000.00-1.23%nominal +$26,000.00',
    ]);
    expect(within(region).getByText(/at the official rate, latest months estimated/)).toBeVisible();
  });

  it('LOTS-OWN-RATE reads each purchase at the own rate when that is chosen', async () => {
    setInflationBasis('personal');
    withLots([lot()]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(cells(bodyRows(region)[0])).toEqual([
      'Jan 10, 2026Trust Wallet',
      '0.2',
      '$12,000.00',
      '+7.00%',
      '$12,840.00',
      '$16,000.00',
      '+$3,160.00+24.61%nominal +$4,000.00',
    ]);
    expect(within(region).getByText(/at your own rate/)).toBeVisible();
  });

  it('LOTS-UNREADABLE shows dashes for the figures a purchase lacks and keeps its value', async () => {
    withLots([unreadable]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(cells(bodyRows(region)[0])).toEqual([
      'May 1, 2024Old exchange',
      '0.05',
      '—',
      '—',
      '—',
      '$4,000.00',
      '—',
    ]);
    expect(region).toHaveTextContent('A dash means a purchase price');
  });

  it('LOTS-NOMINAL-ONLY keeps the paid, value and nominal profit when a basis has no reading', async () => {
    setInflationBasis('personal');
    withLots([older]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(cells(bodyRows(region)[0]).slice(2)).toEqual([
      '$54,000.00',
      '—',
      '—',
      '$80,000.00',
      '—nominal +$26,000.00',
    ]);
  });

  it('LOTS-OWN-FALLBACK says so when the currency has no own rate and the official one is used', async () => {
    setInflationBasis('personal');
    const fallback = lot();
    withLots([
      {
        ...fallback,
        real: {
          ...fallback.real,
          personal: { ...fallback.real.personal!, ownRate: false, inflationPercent: '10.00' },
        },
      },
    ]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(region).toHaveTextContent('no rate of your own for USD, so the official one');
  });

  it('LOTS-INCOMPLETE warns while an account whose history starts later may hold more', async () => {
    withLots([lot()], false);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(within(region).getByRole('note')).toHaveTextContent(
      'An account whose history starts later may hold more purchases than are listed',
    );
  });

  it('LOTS-NOTE explains when a purchase is ahead in real terms', async () => {
    withLots([lot()]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(region).toHaveTextContent(
      'A purchase is ahead in real terms when it is worth more than what you paid grown by USD inflation since that day.',
    );
  });

  it('LOTS-NOTE-READING explains the dash when only the inflation figure is missing', async () => {
    withLots([lot({ real: { official: null, personal: null } })]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(region).toHaveTextContent('$12,000.00');
    expect(region).toHaveTextContent('A dash means a purchase price');
  });

  it('LOTS-EMPTY says nothing is held instead of drawing an empty table', async () => {
    withLots([]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(within(region).queryByRole('table')).toBeNull();
    expect(region).toHaveTextContent('No purchases to show.');
  });

  it('LOTS-FAILED offers to try again without hiding the rest of the page', async () => {
    const user = userEvent.setup();
    const lots = vi
      .spyOn(portfolioValuationApi, 'lots')
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue(answer([lot()]));
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(within(region).getByRole('alert')).toHaveTextContent('Could not load the purchases');
    expect(screen.getByRole('region', { name: 'Position' })).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bodyRows(region)).toHaveLength(1));
    expect(lots).toHaveBeenCalledTimes(2);
  });

  it('LOTS-SAME-INSTANT lists two purchases of one account made at the same moment', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    withLots([lot(), lot({ quantity: '0.3', paid: '18000' })]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(bodyRows(region)).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
  });

  it('LOTS-PHONE-NOMINAL-READ shows the nominal profit under the real one in a phone row', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    withLots([lot()]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(within(region).getAllByRole('listitem')[0]).toHaveTextContent(
      '+$2,800.00 · +21.21%nominal +$4,000.00',
    );
  });

  it('LOTS-PHONE-NOMINAL keeps the nominal profit of a purchase whose real reading is missing', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    withLots([{ ...unreadable, paid: '4000', nominalPnl: '0' }]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(within(region).getAllByRole('listitem')[0]).toHaveTextContent('nominal $0.00');
  });

  it('LOTS-STALE says when a refresh failed and the figures on screen may be out of date', async () => {
    withLots([lot()]);
    const { rerender } = render(
      <AssetLotsCard instrumentId={bitcoin.instrumentId} asked={undefined} at="a" />,
    );
    const region = await card();
    expect(bodyRows(region)).toHaveLength(1);
    vi.spyOn(portfolioValuationApi, 'lots').mockRejectedValueOnce(httpError(500));
    rerender(<AssetLotsCard instrumentId={bitcoin.instrumentId} asked={undefined} at="b" />);
    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent('Could not refresh the purchases');
    expect(bodyRows(region)).toHaveLength(1);
    expect(within(region).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('LOTS-STALE-RETRY keeps the stale warning until a retry succeeds', async () => {
    const user = userEvent.setup();
    withLots([lot()]);
    const { rerender } = render(
      <AssetLotsCard instrumentId={bitcoin.instrumentId} asked={undefined} at="a" />,
    );
    const region = await card();
    vi.spyOn(portfolioValuationApi, 'lots')
      .mockRejectedValueOnce(httpError(500))
      .mockReturnValueOnce(new Promise(() => undefined));
    rerender(<AssetLotsCard instrumentId={bitcoin.instrumentId} asked={undefined} at="b" />);
    await within(region).findByRole('alert');
    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    expect(within(region).getByRole('alert')).toHaveTextContent('Could not refresh the purchases');
    expect(bodyRows(region)).toHaveLength(1);
  });

  it('LOTS-SOLD asks for nothing when the asset is no longer held', async () => {
    const sold = { ...bitcoin, quantity: '0', value: '0', holdings: [] };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([sold]));
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await screen.findByRole('region', { name: 'Position' });
    expect(screen.queryByRole('region', { name: 'Purchases after inflation' })).toBeNull();
    expect(portfolioValuationApi.lots).not.toHaveBeenCalled();
  });

  it('LOTS-PHONE draws a list of rows instead of a table below 640 px', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    withLots([lot(), unreadable]);
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const region = await card();
    expect(within(region).queryByRole('table')).toBeNull();
    const rows = within(region).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(
      'Jan 10, 2026Trust Wallet · 0.2 · paid $12,000.00 → $13,200.00 (+10.00%)$16,000.00+$2,800.00 · +21.21%',
    );
    expect(rows[1]).toHaveTextContent('May 1, 2024Old exchange · 0.05$4,000.00—');
  });
});

describe('AST-UI Portfolio lists assets with their classification', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await openAddAsset(user);
    const dialog = screen.getByRole('dialog', { name: 'Add asset' });
    // The wallet list is loaded before a balance can be added.
    await within(dialog).findByLabelText('Wallet or account');
    return dialog;
  };

  it('shows a field problem when the field loses focus and clears it once fixed', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => portfolio([bitcoin]));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    const name = within(dialog).getByLabelText(/^Name/);
    await user.click(name);
    expect(within(dialog).queryByText('Enter a name')).not.toBeInTheDocument();
    await user.tab();
    expect(within(dialog).getByText('Enter a name')).toBeInTheDocument();
    await user.type(name, 'Gold');
    expect(within(dialog).queryByText('Enter a name')).not.toBeInTheDocument();
  });

  it('DIALOG-CLOSE closes Add asset from the ✕ at the right of the title', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("ADD-PICK asks what to add, then opens that kind's own form or page", async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const Wallets = () => {
      const location = useLocation();
      return (
        <p>
          Wallets page, add wallet: {String((location.state as { addWallet?: boolean })?.addWallet)}
        </p>
      );
    };
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/portfolio?currency=EUR']}>
        <Routes>
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/wallets" element={<Wallets />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const picker = screen.getByRole('dialog', { name: 'Add to portfolio' });
    expect(
      within(picker)
        .getAllByRole('button')
        .map(
          (button) => button.querySelector('b')?.textContent ?? button.getAttribute('aria-label'),
        ),
    ).toEqual(['Close', 'Crypto', 'Bank', 'Broker', 'Real estate', 'Something else']);

    await user.click(within(picker).getByRole('button', { name: /^Real estate/ }));
    expect(screen.getByRole('dialog', { name: 'Add property' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await user.click(
      within(screen.getByRole('dialog', { name: 'Add to portfolio' })).getByRole('button', {
        name: /^Broker/,
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Add broker account' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await user.click(
      within(screen.getByRole('dialog', { name: 'Add to portfolio' })).getByRole('button', {
        name: /^Bank/,
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Add to portfolio' })).toBeNull();
    const deposit = screen.getByRole('dialog', { name: 'Add deposit' });
    await user.keyboard('{Escape}');
    expect(deposit).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add to portfolio' })).getByRole('button', {
        name: /^Crypto/,
      }),
    );
    expect(await screen.findByText('Wallets page, add wallet: true')).toBeInTheDocument();
  });

  it('ADD-ASSET-BALANCE adds a ruble deposit with its value as a deposit and filters by type', async () => {
    let assets = [bitcoin, toncoin];
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async () => portfolio(assets));
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, { ...deposit, quantity: '150000' }];
      return depositAsset;
    });
    createTrade.mockResolvedValue(receiptFor('150000', '1500'));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(cells(rowOf('Toncoin'))[0]).toBe('ToncoinTON · Crypto · USD');
    expect(cells(rowOf('Toncoin'))[2]).toBe('No priceManual');

    const dialog = await openDialog(user);
    expect(within(dialog).getByRole('radiogroup', { name: 'Type' }).textContent).toBe(
      'CashDepositCryptocurrencyOther',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), '  Deposit ');
    await user.type(within(dialog).getByLabelText('Amount'), '150000');
    expect(within(dialog).getByLabelText('Current value')).toHaveAttribute(
      'placeholder',
      'Same as amount',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    expect(within(dialog).getByLabelText('Wallet or account')).toHaveDisplayValue('Trust Wallet');
    await user.type(within(dialog).getByLabelText('Notes (optional)'), 'Savings account');
    expect(within(dialog).getByRole('note')).toHaveTextContent(
      'Adding it counts as a deposit. Later price changes count as market movement.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Deposit',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
    // The balance is a buy of the amount for its value, paid in rubles.
    expect(createTrade).toHaveBeenCalledWith(id(101), {
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedJournalRevision: 0,
      instrumentId: deposit.instrumentId,
      side: 'buy',
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/),
      quantity: '150000',
      comment: 'Savings account',
      paid: { currency: 'RUB', gross: '150000', fee: '0' },
    });
    // A hand-valued asset starts at the USD price its value implies at that moment.
    expect(setPrice).toHaveBeenCalledWith(deposit.instrumentId, {
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedRevision: 0,
      observedAt: '2026-10-05T10:15:00.000Z',
      priceUsd: '0.01',
      assertReviewed: true,
    });
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(cells(rowOf('Deposit')).slice(0, 2)).toEqual(['DepositManual · RUB', '150,000']);

    await user.click(screen.getByRole('button', { name: /^Manual/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(rowOf('Deposit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
  });

  it('adds cash at its amount and a coin at its cost, with no price for either', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const create = vi
      .spyOn(portfolioAssetsApi, 'create')
      .mockResolvedValueOnce({
        ...depositAsset,
        id: cash.instrumentId,
        name: 'Cash at home',
        symbol: 'USD',
        assetType: 'fiat',
        valuationCurrency: 'USD',
        priceSource: 'fixed',
      })
      .mockResolvedValueOnce({
        ...depositAsset,
        id: id(7),
        name: 'Ether',
        symbol: 'ETH',
        assetType: 'crypto',
        valuationCurrency: 'USD',
        priceSource: 'market',
      });
    const user = userEvent.setup();
    renderAt('/portfolio');
    let dialog = await openDialog(user);
    // Cash is worth its amount: no separate value field and no ticker.
    expect(within(dialog).queryByLabelText('Current value')).toBeNull();
    expect(within(dialog).queryByLabelText(/Ticker/)).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Cash at home');
    await user.type(within(dialog).getByLabelText('Amount'), '1 000,50');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Cash at home',
      assetType: 'fiat',
      symbol: 'USD',
    });
    expect(createTrade.mock.calls[0][1]).toMatchObject({
      instrumentId: cash.instrumentId,
      quantity: '1000.50',
      grossUsd: '1000.50',
      feeUsd: '0',
    });

    dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
    expect(within(dialog).getByLabelText('Amount (optional)')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), 'Ether');
    await user.type(within(dialog).getByLabelText('Ticker'), 'eth');
    await user.type(within(dialog).getByLabelText('Amount (optional)'), '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(within(dialog).getByText('Enter what it cost')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'EUR' }));
    await user.type(within(dialog).getByLabelText('Total cost'), '1200');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[1][0]).toMatchObject({ assetType: 'crypto', symbol: 'ETH' });
    expect(createTrade.mock.calls[1][1]).toMatchObject({
      instrumentId: id(7),
      quantity: '0.5',
      paid: { currency: 'EUR', gross: '1200', fee: '0' },
    });
    expect(setPrice).not.toHaveBeenCalled();
  });

  it('ADD-ASSET-RATE adds nothing when a RUB or EUR balance has no Bank of Russia rate', async () => {
    vi.mocked(fxRatesApi.get).mockResolvedValueOnce(rates(null, null));
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockResolvedValue(depositAsset);
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Name'), 'Cash at home');
    await user.type(within(dialog).getByLabelText('Amount'), '90120');
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No Bank of Russia rate is stored for today yet, so the RUB balance cannot be converted. Nothing was saved; try again later.',
    );
    expect(create).not.toHaveBeenCalled();
    expect(createTrade).not.toHaveBeenCalled();
    // Still editable: nothing was saved.
    expect(within(dialog).getByLabelText('Name')).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(createTrade.mock.calls[0][1]).toMatchObject({
      paid: { currency: 'RUB', gross: '90120' },
    });
  });

  it('asks for the amount and keeps a saved asset when its balance is refused', async () => {
    let assets = [bitcoin];
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async () => portfolio(assets));
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, deposit];
      return depositAsset;
    });
    createTrade
      .mockRejectedValueOnce(new AxiosError('offline'))
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValueOnce(receiptFor('100', '1'));
    setPrice.mockRejectedValueOnce(new AxiosError('offline'));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(within(dialog).getByText('Enter an amount greater than 0')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The asset was added, but its balance was not saved. Could not reach the server; try again.',
    );
    // The saved asset is not asked for again and cannot change.
    expect(within(dialog).getByLabelText('Name')).toBeDisabled();
    // The lost answer may have saved the balance: the retry must repeat the same request.
    for (const label of ['Amount', 'Current value', 'Wallet or account', 'Notes (optional)'])
      expect(within(dialog).getByLabelText(label)).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The account was changed elsewhere; try again.',
    );
    // A refusal saved nothing, so the balance may be corrected again.
    expect(within(dialog).getByLabelText('Amount')).toBeEnabled();
    expect(createTrade.mock.calls[1][1].requestId).toBe(createTrade.mock.calls[0][1].requestId);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The asset and its balance were saved, but its price was not. Try again.',
    );
    // A refused request saved nothing, so the next one has its own id.
    expect(createTrade.mock.calls[2][1].requestId).not.toBe(createTrade.mock.calls[1][1].requestId);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(createTrade).toHaveBeenCalledTimes(3);
    expect(setPrice).toHaveBeenCalledTimes(2);
    expect(setPrice.mock.calls[1][1].requestId).toBe(setPrice.mock.calls[0][1].requestId);
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('closing after a saved asset still shows it, and no account means no balance', async () => {
    let assets = [bitcoin];
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => portfolio(assets));
    vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, deposit];
      return depositAsset;
    });
    createTrade.mockRejectedValue(httpError(500));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await within(dialog).findByRole('alert');
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement,
    );
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();

    vi.mocked(accountingApi.listAccounts).mockResolvedValue({ items: [], nextCursor: null });
    await openAddAsset(user);
    const empty = screen.getByRole('dialog', { name: 'Add asset' });
    // G1: with no account yet, the balance gets a new one made right here.
    expect(await within(empty).findByText(/You have no account yet/)).toBeInTheDocument();
    expect(within(empty).getByLabelText('Wallet or account')).toHaveValue('');
    expect(within(empty).queryByRole('link', { name: 'manual accounts' })).toBeNull();
  });

  it('G1: makes the account first when there is none, and keeps it on a retry', async () => {
    vi.mocked(accountingApi.listAccounts).mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => portfolio([bitcoin]));
    const createAccount = vi.spyOn(accountingApi, 'createAccount').mockResolvedValue({
      id: id(150),
      name: 'Home safe',
      kind: null,
      currentRevision: 0,
      createdAt: '2026-10-05T00:00:00Z',
    });
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockResolvedValue(depositAsset);
    createTrade.mockRejectedValueOnce(httpError(500));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.type(within(dialog).getByLabelText('Amount'), '100');

    // The name is asked for before anything is saved.
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(within(dialog).getByText('Enter a name for the account')).toBeInTheDocument();
    expect(createAccount).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Wallet or account'), 'Home safe');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await within(dialog).findByRole('alert');
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(createAccount.mock.calls[0][0]).toMatchObject({ name: 'Home safe' });
    expect(createTrade.mock.calls[0][0]).toBe(id(150));
    // A new account starts its journal at revision 0.
    expect(createTrade.mock.calls[0][1]).toMatchObject({ expectedJournalRevision: 0 });

    // The retry goes to the same account and sends the same trade request.
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(createTrade.mock.calls[1][0]).toBe(id(150));
    expect(createTrade.mock.calls[1][1].requestId).toBe(createTrade.mock.calls[0][1].requestId);
  });

  it('G1: offers a new account next to the existing ones', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => portfolio([bitcoin]));
    const createAccount = vi.spyOn(accountingApi, 'createAccount').mockResolvedValue({
      id: id(151),
      name: 'Bank',
      kind: null,
      currentRevision: 0,
      createdAt: '2026-10-05T00:00:00Z',
    });
    vi.spyOn(portfolioAssetsApi, 'create').mockResolvedValue(depositAsset);
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.selectOptions(within(dialog).getByLabelText('Wallet or account'), 'New account…');
    await user.type(within(dialog).getByLabelText('Name of the new account'), 'Bank');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(createTrade.mock.calls[0][0]).toBe(id(151));
  });

  it('keeps the dialog and request id on a refusal, then retries the same request', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([]));
    const create = vi
      .spyOn(portfolioAssetsApi, 'create')
      .mockRejectedValueOnce(new AxiosError('offline'))
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce(depositAsset);
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
    await user.type(within(dialog).getByLabelText('Ticker'), 'TON');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not reach/i);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/check the fields/i);
    expect(create.mock.calls[1][0].requestId).toBe(create.mock.calls[0][0].requestId);
    await user.type(within(dialog).getByLabelText('Ticker'), 'C');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[2][0].requestId).not.toBe(create.mock.calls[0][0].requestId);
    expect(createTrade).not.toHaveBeenCalled();
  });

  it('shows a new asset even when a filter or search would hide it', async () => {
    let assets = [bitcoin];
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => portfolio(assets));
    vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, deposit];
      return depositAsset;
    });
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search assets' }), 'bit');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All(?!o)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('searchbox', { name: 'Search assets' })).toHaveValue('');
  });

  it('keeps focus inside the dialog, returns it on close and cannot close mid-save', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    let finish: (asset: PortfolioAsset) => void = () => undefined;
    vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const opener = screen.getByRole('button', { name: 'Add' });
    let dialog = await openDialog(user);
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    const submit = within(dialog).getByRole('button', { name: 'Add asset' });
    submit.focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();

    dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
    await user.type(within(dialog).getByLabelText('Ticker'), 'TON');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Add asset' })).toBeInTheDocument();
    finish(depositAsset);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('SEARCH finds assets by name or ticker next to the type filter', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash, toncoin]));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const search = screen.getByRole('searchbox', { name: 'Search assets' });
    expect(search).toHaveAttribute('placeholder', 'Search assets');
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent?.split(' ')[0]);
    await user.type(search, 'BIT');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(rowOf('Bitcoin')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'usd');
    expect(names()).toHaveLength(1);
    expect(rowOf('US dollar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    expect(screen.getByText('No assets match "usd".')).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
  });

  it('SORT-HEADERS opens by value, largest first; a column name sorts by it and a second click turns it around', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash, toncoin]));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const order = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('.portfolio-asset__name')?.textContent);
    const header = (name: string) => screen.getByRole('columnheader', { name });
    const click = (name: string) => user.click(within(header(name)).getByRole('button', { name }));
    expect(order()).toEqual(['Bitcoin', 'US dollar', 'Toncoin']);
    expect(header('Value')).toHaveAttribute('aria-sort', 'descending');
    expect(document.querySelectorAll('th[aria-sort]')).toHaveLength(1);

    await click('Amount');
    expect(order()).toEqual(['US dollar', 'Bitcoin', 'Toncoin']);
    expect(header('Amount')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Value')).not.toHaveAttribute('aria-sort');
    await click('Amount');
    // Toncoin is no longer held, so it stays below the holdings either way.
    expect(order()).toEqual(['Bitcoin', 'US dollar', 'Toncoin']);
    expect(header('Amount')).toHaveAttribute('aria-sort', 'ascending');
    await click('Amount');
    expect(order()).toEqual(['US dollar', 'Bitcoin', 'Toncoin']);
    expect(header('Amount')).toHaveAttribute('aria-sort', 'descending');

    // Another column starts over; names run A to Z first; unknown figures stay last.
    await click('Asset');
    expect(order()).toEqual(['Bitcoin', 'Toncoin', 'US dollar']);
    expect(header('Asset')).toHaveAttribute('aria-sort', 'ascending');
    await click('Avg buy price');
    expect(order()).toEqual(['Bitcoin', 'US dollar', 'Toncoin']);
    expect(header('Asset')).not.toHaveAttribute('aria-sort');
    await click('Avg buy price');
    expect(order()).toEqual(['US dollar', 'Bitcoin', 'Toncoin']);
    // The chosen order holds when the search narrows the rows.
    await user.type(screen.getByRole('searchbox', { name: 'Search assets' }), 'coin');
    expect(order()).toEqual(['Bitcoin', 'Toncoin']);
  });

  it('SORT-ORDER turns a column around and keeps unknown figures last in both directions', () => {
    const named = (n: number, name: string, value: string | null) =>
      valued(n, name, null, crypto, { value });
    const assets = [named(1, 'B', '2'), named(2, 'A', null), named(3, 'C', '9')];
    const names = (sort: Parameters<typeof sortAssets>[1]) =>
      sortAssets(assets, sort).map((asset) => asset.name);
    expect(names({ key: 'value', direction: 'desc' })).toEqual(['C', 'B', 'A']);
    expect(names({ key: 'value', direction: 'asc' })).toEqual(['B', 'C', 'A']);
    expect(names({ key: 'name', direction: 'desc' })).toEqual(['C', 'B', 'A']);
    expect(nextSort({ key: 'value', direction: 'desc' }, 'value')).toEqual({
      key: 'value',
      direction: 'asc',
    });
    expect(nextSort({ key: 'value', direction: 'asc' }, 'value')).toEqual({
      key: 'value',
      direction: 'desc',
    });
    expect(nextSort({ key: 'value', direction: 'desc' }, 'name')).toEqual({
      key: 'name',
      direction: 'asc',
    });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'value')).toEqual({
      key: 'value',
      direction: 'desc',
    });
  });

  it('SORT-HELD keeps a holding without a price ahead of assets no longer held, as the server ranks them', () => {
    const priced = valued(1, 'Priced', null, crypto, { quantity: '1', value: '50' });
    const unpriced = valued(2, 'Unpriced', null, crypto, { quantity: '3', value: null });
    const unheld = valued(3, 'Unheld', null, crypto, { quantity: '0', value: '0' });
    const names = (sort: Parameters<typeof sortAssets>[1]) =>
      sortAssets([unheld, unpriced, priced], sort).map((asset) => asset.name);
    expect(names(defaultSort)).toEqual(['Priced', 'Unpriced', 'Unheld']);
    expect(names({ key: 'value', direction: 'asc' })).toEqual(['Priced', 'Unpriced', 'Unheld']);
    expect(names({ key: 'amount', direction: 'asc' })).toEqual(['Priced', 'Unpriced', 'Unheld']);
    // A name order is only names.
    expect(names({ key: 'name', direction: 'asc' })).toEqual(['Priced', 'Unheld', 'Unpriced']);
  });

  it('SORT-PHONE shows on a phone only an order its Sort by can name', () => {
    expect(phoneSort({ key: 'amount', direction: 'asc' })).toEqual(defaultSort);
    expect(phoneSort({ key: 'value', direction: 'asc' })).toEqual(defaultSort);
    expect(phoneSort({ key: 'pnl', direction: 'asc' })).toEqual({ key: 'pnl', direction: 'desc' });
    expect(phoneSort({ key: 'name', direction: 'desc' })).toEqual({
      key: 'name',
      direction: 'asc',
    });
  });

  it('PHONE-LIST shows two-line asset rows and a Sort by select instead of the table', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash, toncoin]));
      const user = userEvent.setup();
      renderAt('/portfolio');
      const row = await screen.findByRole('link', { name: /^Bitcoin/ });
      // The whole row opens the asset; price, allocation, average and 24h live on its page.
      expect(row).toHaveAttribute('href', `/portfolio/${bitcoin.instrumentId}`);
      expect(row).toHaveTextContent('Bitcoin1.2 BTC$96,000.00+$30,000.00 · +45.45%');
      expect(screen.queryByRole('table')).toBeNull();
      const order = () =>
        [...document.querySelectorAll('.ui-row__title')].map((name) => name.textContent);
      expect(order()).toEqual(['Bitcoin', 'US dollar', 'Toncoin']);
      // The prototype's four choices; the list opens by value, largest first.
      const sort = screen.getByRole('combobox', { name: 'Sort by' });
      expect(sort).toHaveValue('value');
      expect(
        within(sort)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Value', 'Unrealized P&L', '24h change', 'Name']);
      await user.selectOptions(sort, 'Name');
      expect(order()).toEqual(['Bitcoin', 'Toncoin', 'US dollar']);
      // An unknown change sorts last.
      await user.selectOptions(sort, '24h change');
      expect(order()).toEqual(['US dollar', 'Bitcoin', 'Toncoin']);
      await user.type(screen.getByRole('searchbox', { name: 'Search assets' }), 'coin');
      expect(order()).toEqual(['Bitcoin', 'Toncoin']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the empty, loading and error states honestly', async () => {
    let fail = true;
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => {
      if (fail) throw httpError(500);
      return portfolio([]);
    });
    const user = userEvent.setup();
    renderAt('/portfolio');
    expect(screen.getByRole('status', { name: 'Loading portfolio' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your portfolio/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No assets yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add' }).length).toBeGreaterThan(0);
  });
});

describe('CACHE-UI coming back to a page shows the last answer at once', () => {
  const later = (assets: AssetValuation[]) => portfolio(assets, { totalValue: '123456' });

  it('paints the kept portfolio without a skeleton, then swaps in the fresh answer', async () => {
    let refresh: (value: PortfolioValuation) => void = () => undefined;
    vi.spyOn(portfolioValuationApi, 'get')
      .mockResolvedValueOnce(portfolio([bitcoin]))
      .mockReturnValueOnce(new Promise((resolve) => (refresh = resolve)));
    const first = renderAt('/portfolio');
    expect(await screen.findByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();
    first.unmount();

    renderAt('/portfolio');
    expect(screen.queryByRole('status', { name: 'Loading portfolio' })).toBeNull();
    expect(screen.getByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();
    expect(portfolioValuationApi.get).toHaveBeenCalledTimes(2);

    refresh(later([bitcoin, cash]));
    expect(await screen.findByRole('row', { name: /^US dollar/ })).toBeInTheDocument();
  });

  it('keeps the kept values and says so when the refresh fails', async () => {
    vi.spyOn(portfolioValuationApi, 'get')
      .mockResolvedValueOnce(portfolio([bitcoin]))
      .mockRejectedValueOnce(httpError(500));
    const first = renderAt('/portfolio');
    expect(await screen.findByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();
    first.unmount();

    renderAt('/portfolio');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not refresh the values/i);
    expect(screen.getByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();
  });

  it('does not paint another currency or anything older than a change by the owner', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const first = renderAt('/portfolio');
    expect(await screen.findByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();
    first.unmount();

    renderAt('/portfolio?currency=EUR');
    expect(screen.getByRole('status', { name: 'Loading portfolio' })).toBeInTheDocument();
    cleanup();

    forgetReads();
    renderAt('/portfolio');
    expect(screen.getByRole('status', { name: 'Loading portfolio' })).toBeInTheDocument();
  });
});

describe('ASSET-UI the asset page shows its chart, transactions and daily change', () => {
  const operation = (n: number, changes: Partial<Operation> = {}): Operation => ({
    id: `trade:${id(500 + n)}`,
    kind: 'trade',
    type: 'buy',
    direction: 'in',
    occurredAt: `2026-09-${String(n).padStart(2, '0')}T10:00:00.000Z`,
    asset: { instrumentId: bitcoin.instrumentId, symbol: 'BTC', name: 'Bitcoin' },
    quantity: '0.01',
    counterAsset: null,
    counterQuantity: null,
    valueUsd: '800',
    estimatedValueUsd: null,
    costBasisUsd: null,
    feeUsd: '0',
    fee: null,
    account: { id: id(101), name: 'Trust Wallet' },
    counterAccount: null,
    wallet: null,
    counterWallet: null,
    chain: null,
    status: 'recorded',
    source: 'manual',
    version: 1,
    paid: null,
    comment: null,
    classification: null,
    orderWithinTimestamp: 0,
    settlement: null,
    value: '800',
    estimatedValue: null,
    costBasis: null,
    feeValue: '0',
    ...changes,
  });
  const point = (at: string, value: string | null, cost: string, quantity = '1') => ({
    at,
    quantity,
    value,
    complete: value !== null,
    cost,
    costComplete: true,
  });

  const tokenWallet = (n: number, symbol: string, other: boolean) =>
    ({
      id: id(n),
      balances: [{ symbol, quantity: '1', ...(other ? { name: symbol } : {}) }],
    }) as unknown as WalletAddress;

  const hiddenAsset = (instrumentId: string, symbol: string) =>
    ({ instrumentId, symbol, name: symbol, hiddenAt: '2026-10-11T09:00:00.000Z' }) as HiddenAsset;

  it('ASSET-HIDE hides a token asset from its own page, in every wallet that holds it too', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, toncoin]));
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([
      tokenWallet(601, 'TON', true),
      tokenWallet(602, 'TON', true),
      tokenWallet(603, 'BTC', false),
    ]);
    const hide = vi.spyOn(walletAddressesApi, 'tokens').mockResolvedValue({} as WalletAddress);
    const hideAsset = vi
      .spyOn(hiddenAssetsApi, 'hide')
      .mockResolvedValue(hiddenAsset(toncoin.instrumentId, 'TON'));
    const user = userEvent.setup();
    renderAt(`/portfolio/${toncoin.instrumentId}`);
    await user.click(await screen.findByRole('button', { name: 'Hide asset' }));
    expect(hide).not.toHaveBeenCalled();
    expect(hideAsset).not.toHaveBeenCalled();
    const ask = screen.getByRole('region', { name: 'Hide this asset' });
    expect(ask).toHaveTextContent('It also leaves the wallet balances.');
    expect(ask).toHaveTextContent('Bring it back in Settings under Hidden assets.');
    await user.click(screen.getByRole('button', { name: 'Hide TON' }));
    await waitFor(() =>
      expect(hide.mock.calls).toEqual([
        [id(601), ['TON'], 'hidden'],
        [id(602), ['TON'], 'hidden'],
      ]),
    );
    await waitFor(() => expect(hideAsset).toHaveBeenCalledWith(toncoin.instrumentId));
    // The asset is gone from the portfolio, so the owner lands on it.
    expect(await screen.findByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
  });

  it('ASSET-HIDE hides an asset no wallet holds as a token by itself, wallets untouched', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, toncoin]));
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([tokenWallet(603, 'BTC', false)]);
    const tokens = vi.spyOn(walletAddressesApi, 'tokens').mockResolvedValue({} as WalletAddress);
    const hideAsset = vi
      .spyOn(hiddenAssetsApi, 'hide')
      .mockResolvedValue(hiddenAsset(bitcoin.instrumentId, 'BTC'));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await user.click(await screen.findByRole('button', { name: 'Hide asset' }));
    expect(screen.getByRole('region', { name: 'Hide this asset' })).not.toHaveTextContent(
      'wallet balances',
    );
    await user.click(screen.getByRole('button', { name: 'Hide BTC' }));
    await waitFor(() => expect(hideAsset).toHaveBeenCalledWith(bitcoin.instrumentId));
    expect(tokens).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
  });

  it('ASSET-HIDE keeps the owner on the page and says so when hiding fails', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
    vi.spyOn(hiddenAssetsApi, 'hide').mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    await user.click(await screen.findByRole('button', { name: 'Hide asset' }));
    await user.click(screen.getByRole('button', { name: 'Hide BTC' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not hide BTC');
    expect(screen.getByRole('button', { name: 'Hide BTC' })).toBeEnabled();
  });

  it('shows the price change today, the value against cost chart and its periods', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      dustThresholdUsd: null,
      operations: [operation(20, { quantity: '0.2', occurredAt: '2026-09-20T09:00:00.000Z' })],
    });
    const history = vi
      .mocked(assetHistoryApi.get)
      .mockImplementation(async (instrumentId, period) => ({
        ...emptyHistory(instrumentId),
        period,
        points: [
          point('2026-09-19T00:00:00.000Z', '50000', '50000'),
          point('2026-09-20T00:00:00.000Z', '52000', '50000'),
          point('2026-09-21T00:00:00.000Z', '62400', '66000', '1.2'),
          point('2026-10-05T12:00:00.000Z', '96000', '66000', '1.2'),
        ],
      }));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    expect(await screen.findByText('today')).toHaveTextContent('-1.40% today');
    const chart = await screen.findByRole('region', { name: 'Position value over time' });
    expect(within(chart).getByLabelText('Chart legend')).toHaveTextContent(
      'Position valueCost basisPurchase',
    );
    expect(
      within(chart).getByRole('img', {
        name: 'Bitcoin position value and cost basis, past month, in USD',
      }),
    ).toBeInTheDocument();
    expect(history).toHaveBeenLastCalledWith(bitcoin.instrumentId, '1M', undefined);
    // The buy on 20 September 09:00 is drawn on the first point after it.
    expect(chart.querySelectorAll('.dashboard-chart__deposit')).toHaveLength(1);
    await user.click(within(chart).getByRole('tab', { name: '7D' }));
    expect(within(chart).getByRole('tab', { name: '7D' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(history).toHaveBeenLastCalledWith(bitcoin.instrumentId, '7D', undefined),
    );
    expect(
      await within(chart).findByRole('img', {
        name: 'Bitcoin position value and cost basis, past 7 days, in USD',
      }),
    ).toBeInTheDocument();
  });

  it('ASSET-NO-COST leaves the cost line out and offers the transactions when no purchase price is known', async () => {
    const unpriced = {
      ...bitcoin,
      costBasis: null,
      unknownCostQuantity: '1.2',
      knownCostSubtotal: '0',
      averageBuyPrice: null,
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
    };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([unpriced], { costBasis: null, unknownCostCount: 1 }),
    );
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      dustThresholdUsd: null,
      operations: [],
    });
    vi.mocked(assetHistoryApi.get).mockImplementation(async (instrumentId, period) => ({
      ...emptyHistory(instrumentId),
      period,
      points: [
        { ...point('2026-09-19T00:00:00.000Z', '50000', '0'), costComplete: false },
        { ...point('2026-10-05T12:00:00.000Z', '96000', '0', '1.2'), costComplete: false },
      ],
    }));
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const chart = await screen.findByRole('region', { name: 'Position value over time' });
    await waitFor(() =>
      expect(within(chart).getByLabelText('Chart legend')).toHaveTextContent(
        'Position valueCost basis unknown',
      ),
    );
    await within(chart).findByRole('img');
    expect(chart.querySelector('.dashboard-chart__invested')).toBeNull();
    const details = screen.getByRole('region', { name: 'Position' });
    expect(within(details).getByRole('note')).toHaveTextContent('has no purchase price');
    expect(within(details).getByRole('link', { name: 'Review transactions' })).toHaveAttribute(
      'href',
      '/transactions?asset=BTC&cost=unknown',
    );
  });

  it('keeps the chosen period when an earlier period answers later', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    let answerMonth: (history: AssetHistory) => void = () => undefined;
    vi.mocked(assetHistoryApi.get)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerMonth = resolve;
          }),
      )
      .mockImplementationOnce(async (instrumentId, period) => ({
        ...emptyHistory(instrumentId),
        period,
        points: [point('2026-10-05T12:00:00.000Z', '96000', '66000', '1.2')],
      }));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const chart = await screen.findByRole('region', { name: 'Position value over time' });
    await user.click(within(chart).getByRole('tab', { name: '7D' }));
    const week = await within(chart).findByRole('img', {
      name: 'Bitcoin position value and cost basis, past 7 days, in USD',
    });
    answerMonth({
      ...emptyHistory(bitcoin.instrumentId),
      period: '1M',
      points: [point('2026-10-05T12:00:00.000Z', null, '66000', '1.2')],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(week).toBeInTheDocument();
    expect(within(chart).queryByText(/No value can be shown/)).toBeNull();
  });

  it('lists the latest five operations of the asset and links to all of them in Transactions', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const buys = Array.from({ length: 11 }, (_, index) => operation(index + 1));
    const unclassified = operation(28, {
      id: 'chain:abc',
      kind: 'chain',
      type: null,
      asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
      quantity: '0.0087',
      valueUsd: null,
      value: null,
      account: null,
      wallet: {
        id: id(301),
        network: 'bitcoin',
        address: 'bc1qsyntheticaddress000000000000',
        label: null,
      },
      status: 'needs-classification',
      source: 'chain',
    });
    const ether = operation(29, {
      asset: { instrumentId: id(9), symbol: 'ETH', name: 'Ethereum' },
    });
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 1,
      dustThresholdUsd: null,
      operations: [...buys, unclassified, ether],
    });
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const card = await screen.findByRole('region', { name: 'Transactions' });
    const rows = await within(card).findAllByRole('listitem');
    // Twelve operations move the asset; the card keeps the five latest.
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(
      'Needs classificationSep 28, 2026 · Bitcoin wallet bc1qsy…0000+0.0087 BTC',
    );
    expect(rows[1]).toHaveTextContent('BuySep 11, 2026 · Trust Wallet+0.01 BTC$800.00');
    expect(card).toHaveTextContent('Latest 5 of 12');
    expect(within(card).queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(within(card).getByRole('link', { name: 'Open in Transactions' })).toHaveAttribute(
      'href',
      '/transactions?asset=BTC',
    );
  });

  it('shows every operation when there are five or fewer, still with the Transactions button', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      dustThresholdUsd: null,
      operations: Array.from({ length: 5 }, (_, index) => operation(index + 1)),
    });
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const card = await screen.findByRole('region', { name: 'Transactions' });
    expect(await within(card).findAllByRole('listitem')).toHaveLength(5);
    expect(card).not.toHaveTextContent('Latest');
    expect(within(card).getByRole('link', { name: 'Open in Transactions' })).toHaveAttribute(
      'href',
      '/transactions?asset=BTC',
    );
  });

  it('never pages the asset card: twenty-five operations show the five latest only', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      dustThresholdUsd: null,
      operations: Array.from({ length: 25 }, (_, index) => operation(index + 1)),
    });
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const card = await screen.findByRole('region', { name: 'Transactions' });
    expect(await within(card).findAllByRole('listitem')).toHaveLength(5);
    expect(card).toHaveTextContent('Latest 5 of 25');
    expect(within(card).queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(within(card).queryByRole('status')).toBeNull();
  });

  it('reports a chart or transactions failure and recovers on retry', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.mocked(operationsApi.list)
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue({
        at: '2026-10-05T12:00:00.000Z',
        quoteCurrency: 'USD',
        needsClassificationCount: 0,
        dustThresholdUsd: null,
        operations: [operation(3)],
      });
    vi.mocked(assetHistoryApi.get).mockRejectedValueOnce(httpError(500));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const card = await screen.findByRole('region', { name: 'Transactions' });
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      "Could not load this asset's transactions.",
    );
    await user.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(
      await within(card).findByRole('link', { name: 'Open in Transactions' }),
    ).toBeInTheDocument();
    const chart = screen.getByRole('region', { name: 'Position value over time' });
    expect(await within(chart).findByRole('alert')).toHaveTextContent('Could not load the chart.');
    await user.click(within(chart).getByRole('button', { name: 'Try again' }));
    expect(
      await within(chart).findByText('No value can be shown for this period in USD.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Holdings' })).not.toHaveTextContent('not built');
  });

  const priceBook = (currentRevision: number) =>
    ({ currentRevision, items: [], nextOffset: null }) as unknown as Awaited<
      ReturnType<typeof manualPricesApi.list>
    >;

  it('G1: a hand-valued asset has Update price; a market-priced one does not', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, deposit]));
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    expect((await screen.findAllByRole('heading', { name: 'Bitcoin' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Update price' })).toBeNull();
    cleanup();
    renderAt(`/portfolio/${deposit.instrumentId}`);
    expect(await screen.findByRole('button', { name: 'Update price' })).toBeInTheDocument();
  });

  it('G1: Update price saves a new manual price on the current revision and refreshes', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([deposit]));
    vi.spyOn(manualPricesApi, 'list').mockResolvedValue(priceBook(3));
    const user = userEvent.setup();
    renderAt(`/portfolio/${deposit.instrumentId}`);
    await user.click(await screen.findByRole('button', { name: 'Update price' }));
    const dialog = screen.getByRole('dialog', { name: 'Update price' });
    const field = within(dialog).getByLabelText('Price of one unit, USD');
    await user.click(field);
    await user.tab();
    expect(within(dialog).getByText('Enter a price greater than 0')).toBeInTheDocument();
    await user.type(field, '1,250');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    expect(within(dialog).getByText(/without a comma between thousands/)).toBeInTheDocument();
    expect(setPrice).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '1250.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setPrice).toHaveBeenCalledWith(deposit.instrumentId, {
      requestId: expect.any(String),
      expectedRevision: 3,
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      priceUsd: '1250.5',
      assertReviewed: true,
    });
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it('G1: a lost answer is retried with the same request, a refusal starts a new one', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([deposit]));
    const list = vi.spyOn(manualPricesApi, 'list').mockResolvedValue(priceBook(3));
    setPrice
      .mockRejectedValueOnce(new AxiosError('offline'))
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValueOnce({} as PriceReceipt);
    const user = userEvent.setup();
    renderAt(`/portfolio/${deposit.instrumentId}`);
    await user.click(await screen.findByRole('button', { name: 'Update price' }));
    const dialog = screen.getByRole('dialog', { name: 'Update price' });
    await user.type(within(dialog).getByLabelText('Price of one unit, USD'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not reach the server',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(setPrice).toHaveBeenCalledTimes(2));
    expect(setPrice.mock.calls[1][1]).toEqual(setPrice.mock.calls[0][1]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText(/changed elsewhere/)).toBeInTheDocument();
    list.mockResolvedValue(priceBook(4));
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setPrice.mock.calls[2][1].expectedRevision).toBe(4);
    expect(setPrice.mock.calls[2][1].requestId).not.toBe(setPrice.mock.calls[0][1].requestId);
  });
});

describe('CUR-UI values in the main currency with a switch to the other two', () => {
  // CUR-SWITCH: 1000 USD at 0.92 EUR per USD (92 and 100 RUB per unit).
  const eurBitcoin = {
    ...bitcoin,
    price: { ...bitcoin.price!, value: '920' },
    value: '920',
    allocationPercent: '100.00',
    costBasis: '828',
    knownCostSubtotal: '828',
    averageBuyPrice: '828',
    unrealizedPnl: '92',
    unrealizedReturnPercent: '11.11',
    holdings: [{ accountId: id(101), accountName: 'Trust Wallet', quantity: '1', value: '920' }],
  };
  const inEur = portfolio([{ ...eurBitcoin, quantity: '1' }], {
    currency: 'EUR',
    mainCurrency: 'EUR',
    rates: [
      { currency: 'USD', date: '2026-10-01', rubPerUnit: '92' },
      { currency: 'EUR', date: '2026-10-01', rubPerUnit: '100' },
    ],
    totalValue: '920',
    pricedSubtotal: '920',
    costBasis: '828',
    knownCostSubtotal: '828',
    unrealizedPnl: '92',
    unrealizedReturnPercent: '11.11',
    realizedPnl: '0',
    knownRealizedSubtotal: '0',
    allocation: {
      complete: true,
      byAsset: [{ key: bitcoin.instrumentId, label: 'Bitcoin', value: '920', percent: '100.00' }],
      byType: [{ key: 'crypto', label: 'Crypto', value: '920', percent: '100.00' }],
      byAccount: [{ key: id(101), label: 'Trust Wallet', value: '920', percent: '100.00' }],
    },
  });

  it('CUR-SWITCH: shows the main currency first and switches to RUB on request', async () => {
    const inRub = portfolio([], {
      ...inEur,
      currency: 'RUB',
      totalValue: null,
      completeness: 'incomplete',
      rates: [],
      assets: [
        {
          ...eurBitcoin,
          quantity: '1',
          price: null,
          missingPrice: 'no-rate',
          value: null,
          costBasis: null,
          knownCostSubtotal: '0',
          missingRateQuantity: '1',
          averageBuyPrice: null,
          unrealizedPnl: null,
          unrealizedReturnPercent: null,
          allocationPercent: null,
          holdings: [
            { accountId: id(101), accountName: 'Trust Wallet', quantity: '1', value: null },
          ],
        },
      ],
      pricedSubtotal: '0',
      missingPriceCount: 1,
      costBasis: null,
      knownCostSubtotal: '0',
      missingRateCount: 1,
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
      allocation: { complete: false, byAsset: [], byType: [], byAccount: [] },
    });
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async (currency) => (currency === 'RUB' ? inRub : inEur));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(get).toHaveBeenLastCalledWith(undefined);
    const switcher = screen.getByRole('radiogroup', { name: 'Currency' });
    expect(within(switcher).getByRole('radio', { name: 'EUR' })).toBeChecked();
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent('Current value€920.00');
    expect(summary).toHaveTextContent('Cost basis€828.00');
    expect(summary).toHaveTextContent('Unrealized P&L+€92.00+11.11%');
    expect(cells(rowOf('Bitcoin')).slice(2, 7)).toEqual([
      '€920.00Market price · 30 min ago',
      '€920.00',
      '100.00%',
      '€828.00',
      '+€92.00+11.11%',
    ]);
    expect(
      screen.getByText(
        /Bank of Russia rates: 1 USD = 92\.00 RUB \(Oct 1, 2026\), 1 EUR = 100\.00 RUB/,
      ),
    ).toBeInTheDocument();

    await user.click(within(switcher).getByRole('radio', { name: 'RUB' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('RUB'));
    await screen.findByText(/No Bank of Russia rate is stored yet, so values in RUB/);
    expect(cells(rowOf('Bitcoin')).slice(2, 7)).toEqual([
      'No rateMarket price',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(screen.getByRole('region', { name: 'Portfolio summary' })).toHaveTextContent(
      'Cost basis—₽0.00 known, part predates the stored rates',
    );
    expect(
      screen.getByText(/1 asset has operations dated before the stored Bank of Russia rates/),
    ).toBeInTheDocument();
    // The asset page keeps the switched currency.
    expect(within(rowOf('Bitcoin')).getByRole('link', { name: 'Bitcoin' })).toHaveAttribute(
      'href',
      `/portfolio/${bitcoin.instrumentId}?currency=RUB`,
    );
  });

  it('marks the chosen currency at once while its values load', async () => {
    let answer: (value: PortfolioValuation) => void = () => {};
    const get = vi.spyOn(portfolioValuationApi, 'get').mockImplementation((currency) =>
      currency === 'RUB'
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(inEur),
    );
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    );
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('RUB'));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    ).toBeChecked();
    answer({ ...inEur, currency: 'RUB' });
    await screen.findByRole('row', { name: /^Bitcoin/ });

    cleanup();
    let assetAnswer: (value: PortfolioValuation) => void = () => {};
    get.mockImplementation((currency) =>
      currency === 'RUB'
        ? new Promise((resolve) => {
            assetAnswer = resolve;
          })
        : Promise.resolve(inEur),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}?currency=EUR`);
    await screen.findByRole('region', { name: 'Position' });
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    );
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('RUB'));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    ).toBeChecked();
    assetAnswer({ ...inEur, currency: 'RUB' });
    await screen.findByRole('region', { name: 'Position' });
  });

  it('shows one asset in the asked currency', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(inEur);
    renderAt(`/portfolio/${bitcoin.instrumentId}?currency=EUR`);
    const position = await screen.findByRole('region', { name: 'Position' });
    expect(get).toHaveBeenCalledWith('EUR');
    // The transactions card is valued in the same currency as the page.
    expect(operationsApi.list).toHaveBeenCalledWith('EUR');
    expect(position).toHaveTextContent('Current value€920.00');
    expect(position).toHaveTextContent('Cost basis€828.00');
    expect(screen.getByRole('link', { name: '← Portfolio' })).toHaveAttribute(
      'href',
      '/portfolio?currency=EUR',
    );
    expect(screen.getByRole('region', { name: 'Holdings' })).toHaveTextContent('€920.00');
  });
});
