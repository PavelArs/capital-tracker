import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { type Deposit, depositsApi } from '@api/deposits.api';
import { type Goal, goalsApi } from '@api/goals.api';
import { operationsApi } from '@api/operations.api';
import { ownerSettingsApi } from '@api/owner-settings.api';
import {
  type HistoryPeriod,
  type PortfolioHistory,
  portfolioHistoryApi,
} from '@api/portfolio-history.api';
import {
  type AccountingCurrency,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type SyncSource, syncStatusApi } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../shell/attention-context';
import { setInflationBasis } from '../shell/inflation-basis';
import { MainCurrencyProvider } from '../shell/main-currency';
import SyncIndicator from '../shell/SyncIndicator';
import { setValueView } from '../shell/value-view';
import { useNeedsClassification } from '../transactions/useNeedsClassification';
import DashboardPage from './DashboardPage';

// The window has its own tests; here it only has to open and report a saved trade.
vi.mock('../portfolio/AddTransactionDialog', () => ({
  default: ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => (
    <div role="dialog" aria-label="Add transaction">
      <button type="button" onClick={onSaved}>
        Save
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  ),
}));

const history = (changes: Partial<PortfolioHistory> = {}): PortfolioHistory => ({
  period: '1M',
  currency: 'USD',
  mainCurrency: 'USD',
  from: '2026-09-04T12:30:00.000Z',
  at: '2026-10-04T12:30:00.000Z',
  value: '115000',
  complete: true,
  change: '15000',
  changePercent: '15.00',
  invested: '90000',
  profit: '25000',
  profitPercent: '27.78',
  deposits: '10000',
  withdrawals: '0',
  netFlow: '10000',
  marketEffect: '5000',
  marketReturnPercent: '4.55',
  points: [
    { at: '2026-09-05T00:00:00.000Z', value: '100000', complete: true, invested: '80000' },
    { at: '2026-09-06T00:00:00.000Z', value: '104000.5', complete: true, invested: '90000' },
    { at: '2026-10-04T12:30:00.000Z', value: '115000', complete: true, invested: '90000' },
  ],
  ...changes,
});

const get = vi.spyOn(portfolioHistoryApi, 'get');

// The big number dims its cents, so it is read from its element as a whole.
const heroValue = (hero: HTMLElement) => hero.querySelector('.dashboard-hero__value');

// An owner with nothing recorded yet: no holdings, nothing put in, nothing in the period.
const nothing = (changes: Partial<PortfolioHistory> = {}) =>
  history({
    value: '0',
    change: '0',
    changePercent: null,
    invested: '0',
    profit: '0',
    profitPercent: null,
    deposits: '0',
    withdrawals: '0',
    netFlow: '0',
    marketEffect: '0',
    marketReturnPercent: null,
    points: [
      { at: '2026-09-05T00:00:00.000Z', value: '0', complete: true, invested: '0' },
      { at: '2026-10-04T12:30:00.000Z', value: '0', complete: true, invested: '0' },
    ],
    ...changes,
  });

function renderPage(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AttentionProvider>
        <DashboardPage />
      </AttentionProvider>
    </MemoryRouter>,
  );
}

// Synthetic ids, names and amounts only (ALLOC: BTC 4200, ETH 2000, cash 1500, others 2300).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const cold = id(11);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// A synthetic goal for the GOAL-DASH cases.
const reserve: Goal = {
  id: id(90),
  name: 'Reserve',
  currency: 'USD',
  targetAmount: '200000.00',
  deadline: null,
  expectedReturnPercent: '7.0000',
  monthlyContribution: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-04',
  progress: { current: '115000.00', complete: true, percent: '57.50', remaining: '85000.00' },
  status: 'open',
  scenarios: [],
};

const asset = (
  n: number,
  name: string,
  symbol: string,
  value: string,
  changes: Partial<AssetValuation> = {},
): AssetValuation => ({
  instrumentId: id(n),
  name,
  symbol,
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
  quantity: '2',
  price: {
    value: String(Number(value) / 2),
    observedAt: ago(8),
    source: 'kraken',
    status: 'fresh',
  },
  missingPrice: null,
  priceChange24hPercent: '1.25',
  value,
  allocationPercent: String(Number(value) / 100),
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  averageBuyPrice: null,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownCostQuantity: '0',
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings: [{ accountId: trust, accountName: 'Trust Wallet', quantity: '2', value }],
  ...changes,
});

const assets = [
  asset(1, 'Bitcoin', 'BTC', '4200', { priceChange24hPercent: '-0.80', quantity: '0.05' }),
  asset(2, 'Ethereum', 'ETH', '2000'),
  asset(3, 'US Dollar', 'USD', '1500', {
    assetType: 'fiat',
    priceSource: 'fixed',
    price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
    priceChange24hPercent: null,
    quantity: '1500',
  }),
  asset(4, 'Solana', 'SOL', '900'),
  asset(5, 'Zcash', 'ZEC', '600'),
  asset(6, 'Tron', 'TRX', '500'),
  asset(7, 'Stellar', 'XLM', '300'),
  // Sold out: no longer a top asset.
  asset(8, 'Dogecoin', 'DOGE', '0', { quantity: '0', allocationPercent: null }),
];

const slice = (key: string, label: string, value: string) => ({
  key,
  label,
  value,
  percent: String(Number(value) / 100),
});

const valuation = (changes: Partial<PortfolioValuation> = {}): PortfolioValuation => ({
  at: new Date().toISOString(),
  currency: 'USD',
  mainCurrency: 'USD',
  rates: [],
  completeness: 'complete',
  totalValue: '10000',
  pricedSubtotal: '10000',
  missingPriceCount: 0,
  stalePriceCount: 0,
  unavailableAccountCount: 0,
  depositsValue: '0',
  unratedDepositCount: 0,
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostCount: 0,
  missingRateCount: 0,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  assets,
  allocation: {
    complete: true,
    byAsset: assets
      .filter((item) => item.value !== '0')
      .map((item) => slice(item.instrumentId, item.name, item.value ?? '0')),
    byType: [slice('crypto', 'Crypto', '8500'), slice('fiat', 'Cash', '1500')],
    byAccount: [slice(trust, 'Trust Wallet', '7000'), slice(cold, 'Cold storage', '3000')],
  },
  accounts: [
    {
      accountId: trust,
      name: 'Trust Wallet',
      coverage: 'covered',
      pricedValue: '7000',
      missingPriceCount: 0,
    },
    {
      accountId: cold,
      name: 'Cold storage',
      coverage: 'covered',
      pricedValue: '3000',
      missingPriceCount: 0,
    },
  ],
  ...changes,
});

const pricesSource = (changes: Partial<SyncSource> = {}): SyncSource => ({
  key: 'prices',
  kind: 'prices',
  name: 'Prices',
  state: 'synced',
  lastAttemptAt: ago(8),
  lastSuccessAt: ago(8),
  errorMessage: null,
  ...changes,
});

const toClassify = vi.spyOn(operationsApi, 'needsClassification');
const valued = vi.spyOn(portfolioValuationApi, 'get');
const sources = vi.spyOn(syncStatusApi, 'get');
const wallets = vi.spyOn(walletAddressesApi, 'list');
const goals = vi.spyOn(goalsApi, 'list');
const accounts = vi.spyOn(accountingApi, 'listAccounts');
const account = (
  accountId: string,
  name: string,
  assetClass: AccountSummary['assetClass'] = null,
): AccountSummary => ({
  id: accountId,
  name,
  kind: null,
  assetClass,
  currentRevision: 0,
  createdAt: '2025-01-01T00:00:00Z',
});

beforeEach(() => {
  toClassify.mockReset();
  toClassify.mockResolvedValue(0);
  valued.mockReset();
  valued.mockImplementation(async (currency?: AccountingCurrency) =>
    valuation({ currency: currency ?? 'USD' }),
  );
  sources.mockReset();
  sources.mockResolvedValue([pricesSource()]);
  wallets.mockReset();
  wallets.mockResolvedValue([]);
  goals.mockReset();
  goals.mockResolvedValue({ asOf: '2026-10-04', items: [] });
  // The asset colours read the class of each account; unanswered, that read signs out.
  accounts.mockReset();
  accounts.mockResolvedValue({
    items: [account(trust, 'Trust Wallet'), account(cold, 'Cold storage')],
    nextCursor: null,
  });
  get.mockReset();
  get.mockImplementation(async (period: HistoryPeriod, currency?: AccountingCurrency) =>
    history({ period, currency: currency ?? 'USD' }),
  );
});
afterEach(cleanup);

describe('record-portfolio-snapshots dashboard', () => {
  it('DASH-MAIN shows net worth, the profit to date, the month and the chart', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(get).toHaveBeenCalledWith('1M', undefined);
    expect(within(hero).getByText('Total net worth · USD')).toBeInTheDocument();
    expect(heroValue(hero)).toHaveTextContent(/^\$115,000\.00$/);
    const profit = within(hero).getByLabelText('Profit or loss to date');
    expect(profit).toHaveTextContent('▲ +$25,000.00+27.78%on $90,000.00 net invested');
    expect(profit).toHaveClass('portfolio-pos');
    expect(within(hero).getByLabelText('What changed')).toHaveTextContent(/^Past month/);
    expect(within(hero).queryByText('+$15,000.00')).toBeNull();
    const chart = screen.getByRole('region', { name: 'Portfolio value over time' });
    expect(within(chart).getByRole('tab', { name: '1M' })).toHaveAttribute('aria-selected', 'true');
    expect(
      within(chart).getByRole('img', {
        name: 'Portfolio value, past month, from $100,000.00 to $115,000.00',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not built yet/i)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('DEP-VALUE names the part of the net worth held in bank deposits, with a link', async () => {
    valued.mockImplementation(async (currency?: AccountingCurrency) =>
      valuation({ currency: currency ?? 'USD', depositsValue: '12500' }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    await waitFor(() => expect(hero).toHaveTextContent('Includes $12,500.00 in bank deposits'));
    expect(within(hero).getByRole('link', { name: 'bank deposits' })).toHaveAttribute(
      'href',
      '/deposits',
    );
  });

  it('DEP-VALUE says nothing about deposits when there are none', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    await screen.findByRole('region', { name: 'Allocation' });
    expect(hero).not.toHaveTextContent('bank deposits');
  });

  it('dashboard-tabs the chart periods follow the tabs pattern: one tab stop, arrow keys and a panel', async () => {
    const user = userEvent.setup();
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Portfolio value over time' });
    const tab = (name: string) => within(chart).getByRole('tab', { name });
    expect(
      within(chart)
        .getAllByRole('tab')
        .map((item) => item.tabIndex),
    ).toEqual([-1, -1, 0, -1, -1, -1]);
    tab('1M').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('3M')).toHaveFocus();
    await waitFor(() => expect(tab('3M')).toHaveAttribute('aria-selected', 'true'));
    expect(get).toHaveBeenLastCalledWith('3M', undefined);
    await user.keyboard('{End}');
    expect(tab('ALL')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('24H')).toHaveFocus();
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('24H', undefined));
    await user.keyboard('{Home}{ArrowLeft}');
    expect(tab('ALL')).toHaveFocus();
    const panel = within(chart).getByRole('tabpanel', { name: 'ALL' });
    expect(tab('ALL')).toHaveAttribute('aria-controls', panel.id);
    await waitFor(() => expect(within(panel).getByRole('img')).toBeInTheDocument());
  });

  it('CHART-PERIODS switches the period and reads each point with its date, value and change', async () => {
    const user = userEvent.setup();
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Portfolio value over time' });
    for (const period of ['24H', '7D', '3M', '1Y', 'ALL', '1M'] as const) {
      await user.click(within(chart).getByRole('tab', { name: period }));
      await waitFor(() =>
        expect(within(chart).getByRole('tab', { name: period })).toHaveAttribute(
          'aria-selected',
          'true',
        ),
      );
      expect(get).toHaveBeenLastCalledWith(period, undefined);
    }
    await user.click(within(chart).getByRole('tab', { name: '7D' }));
    await waitFor(() =>
      expect(screen.getByLabelText('What changed')).toHaveTextContent(/^Past 7 days/),
    );
    const plot = within(chart).getByRole('group');
    plot.focus();
    await user.keyboard('{Home}');
    let tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Sep 5, 00:00 UTC');
    expect(tip).toHaveTextContent('$100,000.00');
    expect(tip).toHaveTextContent('Change in period$0.00');
    await user.keyboard('{ArrowRight}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Sep 6, 00:00 UTC');
    expect(tip).toHaveTextContent('$104,000.50');
    expect(tip).toHaveTextContent('Change in period+$4,000.50');
    await user.keyboard('{End}');
    expect(within(chart).getByRole('status')).toHaveTextContent('Now$115,000.00');
    await user.keyboard('{Escape}');
    expect(within(chart).queryByRole('status')).toBeNull();
  });

  it('switches the currency and keeps it in the address', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: 'Net worth' });
    await user.click(screen.getByRole('radio', { name: 'EUR' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('1M', 'EUR'));
    expect(await screen.findByText('Total net worth · EUR')).toBeInTheDocument();
    expect(heroValue(screen.getByRole('region', { name: 'Net worth' }))).toHaveTextContent(
      /^€115,000\.00$/,
    );
  });

  it('marks an incomplete period, a falling value and a missing rate honestly', async () => {
    get.mockResolvedValue(
      history({
        complete: false,
        change: '-500',
        changePercent: '-0.50',
        profit: '-500',
        profitPercent: '-0.50',
        invested: '100000',
        points: [
          { at: '2026-09-05T00:00:00.000Z', value: null, complete: false, invested: null },
          { at: '2026-09-06T00:00:00.000Z', value: '100000', complete: false, invested: null },
          { at: '2026-10-04T12:30:00.000Z', value: '99500', complete: true, invested: null },
        ],
        value: '99500',
      }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const loss = within(hero).getByLabelText('Profit or loss to date');
    expect(loss).toHaveTextContent('▼ -$500.00-0.50%on $100,000.00 net invested');
    expect(loss).toHaveClass('portfolio-neg');
    expect(within(hero).getByRole('img', { name: /Incomplete/ })).toHaveAttribute(
      'data-tip',
      expect.stringContaining('Add the missing prices on the Portfolio page.'),
    );
    expect(within(hero).queryByRole('note')).toBeNull();
    cleanup();
    get.mockResolvedValue(
      history({
        value: null,
        change: null,
        changePercent: null,
        complete: false,
        invested: null,
        profit: null,
        profitPercent: null,
        deposits: null,
        withdrawals: null,
        netFlow: null,
        marketEffect: null,
        marketReturnPercent: null,
        points: [{ at: '2026-10-04T12:30:00.000Z', value: null, complete: false, invested: null }],
      }),
    );
    renderPage('/dashboard?currency=RUB');
    const empty = await screen.findByRole('region', { name: 'Net worth' });
    expect(heroValue(empty)).toHaveTextContent(/^No rate$/);
    expect(within(empty).getByLabelText('Profit or loss to date')).toHaveTextContent('—');
    expect(within(empty).getByLabelText('What changed')).toHaveTextContent(
      'Past monthMarket—Net deposits—',
    );
    expect(screen.getByText(/No value can be shown for this period/)).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('1M', 'RUB');
  });

  it('PROFIT-ALL-TIME the profit line is net worth minus all-time net invested, whatever the period', async () => {
    const user = userEvent.setup();
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const chart = screen.getByRole('region', { name: 'Portfolio value over time' });
    for (const period of ['24H', 'ALL'] as const) {
      await user.click(within(chart).getByRole('tab', { name: period }));
      await waitFor(() => expect(get).toHaveBeenLastCalledWith(period, undefined));
      expect(within(hero).getByLabelText('Profit or loss to date')).toHaveTextContent(
        '▲ +$25,000.00+27.78%on $90,000.00 net invested',
      );
    }
    cleanup();
    // A month where only the market rose still shows the loss against the money put in.
    get.mockResolvedValue(
      history({
        value: '80000',
        change: '8000',
        changePercent: '11.11',
        profit: '-10000',
        profitPercent: '-11.11',
        deposits: '0',
        netFlow: '0',
        marketEffect: '8000',
        marketReturnPercent: '11.11',
      }),
    );
    renderPage();
    const down = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(down).getByLabelText('Profit or loss to date')).toHaveTextContent(
      '▼ -$10,000.00-11.11%on $90,000.00 net invested',
    );
    expect(within(down).getByLabelText('What changed')).toHaveTextContent(
      'Past monthMarket+$8,000.00+11.11%Net deposits$0.00',
    );
    cleanup();
    // More taken out than put in: no percentage of nothing.
    get.mockResolvedValue(history({ invested: '-2000', profit: '117000', profitPercent: null }));
    renderPage();
    const out = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(out).getByLabelText('Profit or loss to date')).toHaveTextContent(
      '▲ +$117,000.00on -$2,000.00 net invested',
    );
  });

  it('FLOW-SPLIT splits the change into market and net deposits for the period', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const split = within(hero).getByLabelText('What changed');
    expect(split).toHaveTextContent('Past monthMarket+$5,000.00+4.55%Net deposits+$10,000.00');
    expect(within(split).getByText('+$5,000.00')).toHaveClass('portfolio-pos');
    expect(within(split).getByText('+$10,000.00')).not.toHaveClass('portfolio-pos');
    cleanup();
    get.mockResolvedValue(
      history({
        value: '99994',
        change: '-6',
        changePercent: '-0.01',
        deposits: '0',
        withdrawals: '0',
        netFlow: '0',
        marketEffect: '-6',
        marketReturnPercent: '-0.01',
      }),
    );
    renderPage();
    const transfer = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(transfer).getByLabelText('What changed')).toHaveTextContent(
      'Past monthMarket-$6.00-0.01%Net deposits$0.00',
    );
    cleanup();
    get.mockResolvedValue(history({ withdrawals: '2500', netFlow: '-2500', deposits: '0' }));
    renderPage();
    const sold = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(sold).getByLabelText('What changed')).toHaveTextContent('Net deposits-$2,500.00');
  });

  it('draws the net invested line and reads it with each point', async () => {
    const user = userEvent.setup();
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Portfolio value over time' });
    const legend = within(chart).getByLabelText('Chart legend');
    expect(legend).toHaveTextContent('Portfolio valueNet investedDeposit');
    expect(
      within(chart).getByRole('img', {
        name: 'Portfolio value, past month, from $100,000.00 to $115,000.00',
      }),
    ).toBeInTheDocument();
    const plot = within(chart).getByRole('group');
    plot.focus();
    await user.keyboard('{Home}');
    let tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Net invested$80,000.00');
    expect(tip).not.toHaveTextContent('Deposit');
    await user.keyboard('{ArrowRight}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Net invested$90,000.00');
    expect(tip).toHaveTextContent('Deposit+$10,000.00');
    await user.keyboard('{End}');
    tip = within(chart).getByRole('status');
    expect(tip).toHaveTextContent('Net invested$90,000.00');
    expect(tip).not.toHaveTextContent('Deposit');
  });

  it('GOAL-DASH puts the nearest goal between the net worth and the chart, only when there is one', async () => {
    goals.mockResolvedValue({ asOf: '2026-10-04', items: [reserve] });
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    const chart = screen.getByRole('region', { name: 'Portfolio value over time' });
    expect(hero.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Reserve' })).toHaveAttribute(
      'href',
      `/goals/${id(90)}`,
    );
  });

  it('GOAL-DASH shows a goal set before anything was recorded above the empty state', async () => {
    get.mockResolvedValue(nothing());
    goals.mockResolvedValue({
      asOf: '2026-10-04',
      items: [
        {
          ...reserve,
          progress: { current: '0.00', complete: true, percent: '0.00', remaining: '200000.00' },
        },
      ],
    });
    renderPage();
    await screen.findByRole('region', { name: 'Your portfolio is empty' });
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    expect(within(card).getByRole('link', { name: 'Reserve' })).toBeInTheDocument();
  });

  it('GOAL-DASH leaves the dashboard as it was without goals', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Net worth' });
    expect(screen.queryByRole('region', { name: 'Nearest goal' })).toBeNull();
  });

  it('DASH-CENTS dims the cents of the net worth', async () => {
    renderPage();
    const value = heroValue(await screen.findByRole('region', { name: 'Net worth' }));
    expect(value).toHaveTextContent(/^\$115,000\.00$/);
    expect(value?.querySelector('.dashboard-hero__cents')).toHaveTextContent(/^\.00$/);
  });

  it('DASH-LOADING shows skeleton blocks in the page layout, not a sentence', async () => {
    get.mockReturnValue(new Promise(() => {}));
    renderPage();
    const loading = screen.getByRole('status', { name: 'Loading your capital' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('.dashboard-loading__block').length).toBeGreaterThan(3);
    expect(loading.querySelector('.dashboard-loading__chart')).not.toBeNull();
    expect(loading.textContent).toBe('');
    expect(screen.queryByRole('region', { name: 'Net worth' })).toBeNull();
  });

  it('DASH-EMPTY invites the first wallet or transaction when nothing is recorded', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(nothing());
    renderPage();
    const empty = await screen.findByRole('region', { name: 'Your portfolio is empty' });
    expect(empty).toHaveTextContent(/Add your first wallet or asset/);
    expect(within(empty).getByRole('link', { name: 'Add wallet' })).toHaveAttribute(
      'href',
      '/wallets',
    );
    expect(screen.queryByRole('region', { name: 'Net worth' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Portfolio value over time' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Currency' })).toBeInTheDocument();
    // A saved first trade reloads the page with it.
    get.mockResolvedValue(history());
    await user.click(within(empty).getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add transaction' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('region', { name: 'Net worth' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('DASH-EMPTY is not shown once money went in, a value is unknown or the period held something', async () => {
    for (const changes of [
      // Everything sold, but money went in and out: the history still matters.
      { invested: '-150', profit: '150' },
      // A holding without a price is not nothing.
      { complete: false },
      // Held something earlier in the period.
      {
        points: [
          { at: '2026-09-05T00:00:00.000Z', value: '120', complete: true, invested: '0' },
          { at: '2026-10-04T12:30:00.000Z', value: '0', complete: true, invested: '0' },
        ],
      },
    ] satisfies Partial<PortfolioHistory>[]) {
      get.mockResolvedValue(nothing(changes));
      renderPage();
      expect(await screen.findByRole('region', { name: 'Net worth' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Your portfolio is empty' })).toBeNull();
      cleanup();
    }
  });

  it('CHART-NOTE keeps the chart rules behind an info button instead of a paragraph', async () => {
    const user = userEvent.setup();
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Portfolio value over time' });
    expect(chart).not.toHaveTextContent(/snapshots/);
    const about = within(chart).getByRole('button', { name: 'About this chart' });
    expect(about).toHaveAttribute('aria-expanded', 'false');
    await user.click(about);
    expect(about).toHaveAttribute('aria-expanded', 'true');
    const note = within(chart).getByRole('note');
    expect(note).toHaveTextContent(/hourly for the last week, daily since Jan 1, 2025/);
    expect(note).toHaveTextContent(/Net invested/);
    await user.keyboard('{Escape}');
    expect(about).toHaveAttribute('aria-expanded', 'false');
    expect(within(chart).queryByRole('note')).toBeNull();
  });

  it('says when the history cannot be loaded and retries', async () => {
    const user = userEvent.setup();
    get.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your capital history');
    expect(document.body.textContent).not.toMatch(/\$0\.00/);
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Net worth' })).toBeInTheDocument();
  });
});

describe('show-dashboard-top-assets', () => {
  it('DASH-MAIN shows the top five assets with price, 24h change, value and share', async () => {
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    expect(valued).toHaveBeenCalledWith(undefined);
    const rows = within(top).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Bitcoin0.05 BTC$2,100.00-0.80%$4,200.0042.00%',
      'Ethereum2 ETH$1,000.00+1.25%$2,000.0020.00%',
      // dashboard-06: a fixed price is no market quote, so its 24h says so as on phones.
      'US Dollar1,500 USD$1.00Fixed$1,500.0015.00%',
      'Solana2 SOL$450.00+1.25%$900.009.00%',
      'Zcash2 ZEC$300.00+1.25%$600.006.00%',
    ]);
    expect(within(rows[0]).getByText('-0.80%')).toHaveClass('portfolio-neg');
    expect(within(rows[0]).getByRole('link', { name: 'Bitcoin' })).toHaveAttribute(
      'href',
      `/portfolio/${id(1)}`,
    );
    expect(within(top).getByRole('link', { name: 'All assets' })).toHaveAttribute(
      'href',
      '/portfolio',
    );
  });

  it('ALLOC groups by asset, type and account and folds the smallest assets into Other', async () => {
    const user = userEvent.setup();
    renderPage();
    const allocation = await screen.findByRole('region', { name: 'Allocation' });
    const shares = () =>
      within(allocation)
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    expect(shares()).toEqual([
      'Bitcoin BTC$4,200.0042.00%',
      'Ethereum ETH$2,000.0020.00%',
      'US Dollar USD$1,500.0015.00%',
      'Solana SOL$900.009.00%',
      'Zcash ZEC$600.006.00%',
      'Other 2 assets$800.008.00%',
    ]);
    await user.click(within(allocation).getByRole('radio', { name: 'Type' }));
    expect(shares()).toEqual(['Crypto$8,500.0085.00%', 'Cash$1,500.0015.00%']);
    await user.click(within(allocation).getByRole('radio', { name: 'Wallets' }));
    expect(shares()).toEqual(['Trust Wallet$7,000.0070.00%', 'Cold storage$3,000.0030.00%']);
  });

  it('PHONE-LIST shows top assets as two-line rows with the 24h change', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      renderPage();
      const top = await screen.findByRole('region', { name: 'Top assets' });
      expect(within(top).queryByRole('table')).toBeNull();
      const links = within(top).getAllByRole('link', { name: /today|Fixed/ });
      expect(links.map((link) => link.textContent)).toEqual([
        'Bitcoin0.05 BTC$4,200.00-0.80% today',
        'Ethereum2 ETH$2,000.00+1.25% today',
        'US Dollar1,500 USD$1,500.00Fixed',
        'Solana2 SOL$900.00+1.25% today',
        'Zcash2 ZEC$600.00+1.25% today',
      ]);
      expect(links[0]).toHaveAttribute('href', `/portfolio/${id(1)}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ATTN-BELL keeps what needs the owner off the page; the header bell holds it', async () => {
    toClassify.mockResolvedValue(3);
    renderPage();
    await screen.findByRole('region', { name: 'Net worth' });
    await screen.findByRole('button', { name: 'Notifications, 1 needs attention' });
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/blockchain transactions need classification/);
  });

  it('DASH-UNKNOWN-COST names the coins without a purchase price in a tooltip by the profit', async () => {
    valued.mockImplementation(async (currency?: AccountingCurrency) =>
      valuation({
        currency: currency ?? 'USD',
        assets: [
          asset(1, 'Bitcoin', 'BTC', '4200', { unknownCostQuantity: '0.0087' }),
          asset(2, 'Ethereum', 'ETH', '2000', { unknownCostQuantity: '1.5' }),
          asset(3, 'Solana', 'SOL', '900', { unknownCostQuantity: '3' }),
          asset(4, 'Zcash', 'ZEC', '600'),
        ],
      }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const tip = await within(hero).findByRole('img', { name: /without purchase price/ });
    expect(tip).toHaveAttribute(
      'data-tip',
      '0.0087 BTC, 1.5 ETH and 1 more without purchase price, so cost basis and profit are incomplete.',
    );
    expect(within(hero).queryByRole('note')).toBeNull();
  });

  it('DASH-UNKNOWN-COST stays quiet when every coin has a purchase price', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    await screen.findByRole('region', { name: 'Top assets' });
    expect(within(hero).queryByRole('img')).not.toBeInTheDocument();
  });

  it('says when the assets cannot be loaded and keeps the net worth', async () => {
    const user = userEvent.setup();
    valued.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    expect(await within(top).findByRole('alert')).toHaveTextContent('Could not load your assets.');
    expect(screen.getByRole('region', { name: 'Net worth' })).toBeInTheDocument();
    await user.click(within(top).getByRole('button', { name: 'Try again' }));
    expect(await within(top).findByRole('link', { name: 'Bitcoin' })).toBeInTheDocument();
  });

  it('CACHE-ONCE asks for each route once when the dashboard opens', async () => {
    const settings = vi
      .spyOn(ownerSettingsApi, 'get')
      .mockResolvedValue({ mainCurrency: 'USD' } as never);
    // The shell reads these for the bell, the sidebar and the menu badge, the page for itself.
    function Badge() {
      return <span data-testid="to-classify">{useNeedsClassification()}</span>;
    }
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <MainCurrencyProvider>
          <AttentionProvider>
            <Badge />
            <SyncIndicator />
            <DashboardPage />
          </AttentionProvider>
        </MainCurrencyProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('region', { name: 'Top assets' });
    await waitFor(() => expect(screen.getByTestId('to-classify')).toHaveTextContent('0'));
    await waitFor(() => expect(settings).toHaveBeenCalled());
    expect(sources).toHaveBeenCalledTimes(1);
    expect(toClassify).toHaveBeenCalledTimes(1);
    expect(valued).toHaveBeenCalledTimes(1);
    expect(wallets).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
  });
});

// VIEW-ONE: the profit to date in one reading at a time, under one switch.
describe('Dashboard after inflation', () => {
  const real = {
    official: { invested: '96000', profit: '19000', profitPercent: '19.79', estimated: true },
    personal: {
      invested: '92500',
      profit: '22500',
      profitPercent: '24.32',
      estimated: true,
      ownRate: true,
    },
  };
  beforeEach(() => {
    setValueView('nominal');
    setInflationBasis('official');
    get.mockImplementation(async (period: HistoryPeriod, currency?: AccountingCurrency) =>
      history({ period, currency: currency ?? 'USD', real }),
    );
  });
  const profitLine = (hero: HTMLElement, name: string) => within(hero).getByLabelText(name);

  it('DASH-ONE-NOMINAL shows the nominal profit and nothing about inflation', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(profitLine(hero, 'Profit or loss to date')).toHaveTextContent(
      '▲ +$25,000.00+27.78%on $90,000.00 net invested',
    );
    expect(within(hero).queryByLabelText('Profit or loss after inflation')).toBeNull();
    expect(within(hero).queryByLabelText('Real profit or loss to date')).toBeNull();
    expect(hero).not.toHaveTextContent(/inflation|official rate|\+\$19,000\.00/);
    expect(within(hero).queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Nominal' })).toBeChecked();
  });

  it('DASH-ONE-REAL shows only the real profit, with the rate it rests on', async () => {
    const user = userEvent.setup();
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    await user.click(screen.getByRole('radio', { name: 'Real' }));
    const real = profitLine(hero, 'Real profit or loss to date');
    expect(real).toHaveTextContent(
      "▲ +$19,000.00+19.79%real, on $96,000.00 put in, in today's money · at the official rate, latest months estimated · Settings",
    );
    expect(within(real).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(hero).queryByLabelText('Nominal profit or loss')).toBeNull();
    expect(within(hero).queryByLabelText('Profit or loss to date')).toBeNull();
    expect(hero).not.toHaveTextContent(/nominal|before inflation|\+\$25,000\.00|net invested/i);
    // The net worth itself is the same in both readings.
    expect(heroValue(hero)).toHaveTextContent(/^\$115,000\.00$/);
    expect(window.localStorage.setItem).toHaveBeenCalledWith('value-view', 'real');
  });

  it('DASH-REAL-REMEMBER opens on the last choice', async () => {
    setValueView('real');
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(profitLine(hero, 'Real profit or loss to date')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Real' })).toBeChecked();
  });

  it('DASH-REAL-OWN-RATE reads the profit after the owner own rate when that is chosen', async () => {
    setInflationBasis('personal');
    setValueView('real');
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(profitLine(hero, 'Real profit or loss to date')).toHaveTextContent(
      "+$22,500.00+24.32%real, on $92,500.00 put in, in today's money · at your own rate · Settings",
    );
    expect(hero).not.toHaveTextContent(/nominal|\+\$25,000\.00/i);
  });

  it('DASH-ONE-REAL-UNKNOWN shows a dash and why, not the nominal profit', async () => {
    setValueView('real');
    get.mockImplementation(async (period: HistoryPeriod) =>
      history({ period, real: { official: null, personal: null } }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const line = profitLine(hero, 'Real profit or loss to date');
    expect(line).toHaveTextContent(
      '—No real profit: an inflation figure, exchange rate or price is missing for some of your deposits.',
    );
    expect(hero).not.toHaveTextContent(/\+\$25,000\.00|net invested|nominal/i);
    setInflationBasis('personal');
    expect(
      await within(hero).findByText(/No real profit: an inflation figure, exchange rate or price/),
    ).toBeInTheDocument();
  });

  it('DASH-ONE-NOMINAL-UNKNOWN keeps quiet about a real profit that is missing', async () => {
    get.mockImplementation(async (period: HistoryPeriod) =>
      history({ period, real: { official: null, personal: null } }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(profitLine(hero, 'Profit or loss to date')).toHaveTextContent('+$25,000.00');
    expect(hero).not.toHaveTextContent(/No real profit/);
  });

  it('DASH-REAL-FOLLOW-OFFICIAL says so when My rate has no rate for the currency', async () => {
    setInflationBasis('personal');
    setValueView('real');
    get.mockImplementation(async (period: HistoryPeriod) =>
      history({
        period,
        real: { official: real.official, personal: { ...real.official, ownRate: false } },
      }),
    );
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const line = profitLine(hero, 'Real profit or loss to date');
    expect(line).toHaveTextContent('+$19,000.00+19.79%');
    expect(line).toHaveTextContent('no rate of your own for USD, so the official one');
    expect(line).not.toHaveTextContent('at your own rate');
  });

  it('DASH-REAL-OLD-ANSWER shows nothing extra for an answer saved before this existed', async () => {
    get.mockImplementation(async (period: HistoryPeriod) => history({ period }));
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(hero).queryByLabelText('Profit or loss after inflation')).toBeNull();
    expect(within(hero).getByLabelText('Profit or loss to date')).toBeInTheDocument();
  });
});

// UI audit fixes (dashboard-NN): synthetic data only.
describe('Dashboard UI audit', () => {
  const phone = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  afterEach(() => vi.unstubAllGlobals());

  const savings: Deposit = {
    id: id(70),
    name: 'Savings A',
    bank: 'Synthetic Bank',
    currency: 'USD',
    startDate: '2026-07-01',
    endDate: '2026-12-01',
    payout: 'monthly',
    capitalized: false,
    dayBasis: 'actual-365',
    earlyClose: 'forfeits-interest',
    ratePercent: '12',
    status: 'active',
    closedOn: null,
    principal: '1780.00',
    accrued: '20.00',
    due: '0.00',
    balance: '1800.00',
    values: { USD: '1800.00', EUR: '1620.00', RUB: '162000.00' },
    nextPayout: { date: '2026-11-01', interest: '18.00', treatment: 'payable' },
    atMaturity: { date: '2026-12-01', balance: '1836.00', interest: '36.00' },
    lastCheck: null,
  };
  // The deposit is third by value: after Bitcoin and Ethereum, before the dollars.
  const withDeposit = (currency: AccountingCurrency = 'USD') => {
    const base = valuation({ currency, depositsValue: '1800' });
    const byAsset = [...base.allocation.byAsset];
    byAsset.splice(2, 0, slice(`deposit:${savings.id}`, 'Savings A', '1800'));
    return { ...base, allocation: { ...base.allocation, byAsset } };
  };

  it('dashboard-01 keeps the loaded dashboard when a later history load fails', async () => {
    const user = userEvent.setup();
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    await screen.findByRole('link', { name: 'Bitcoin' });
    get.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('tab', { name: '7D' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not update your capital history. Showing the last loaded figures.',
    );
    expect(screen.getByRole('region', { name: 'Net worth' })).toBe(hero);
    expect(heroValue(hero)).toHaveTextContent(/^\$115,000\.00$/);
    expect(screen.getByRole('region', { name: 'Portfolio value over time' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Top assets' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Allocation' })).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByLabelText('What changed')).toHaveTextContent(/^Past 7 days/),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dashboard-01 keeps the loaded assets and allocation when a later portfolio load fails', async () => {
    const user = userEvent.setup();
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    await within(top).findByRole('link', { name: 'Bitcoin' });
    valued.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('radio', { name: 'EUR' }));
    expect(await within(top).findByRole('alert')).toHaveTextContent(
      'Could not update your assets. Showing the last loaded figures.',
    );
    expect(within(top).getByRole('link', { name: 'Bitcoin' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Allocation' })).toBeInTheDocument();
  });

  it('dashboard-02 ranks a bank deposit among the top assets by its value', async () => {
    valued.mockImplementation(async (currency?: AccountingCurrency) => withDeposit(currency));
    vi.spyOn(depositsApi, 'list').mockResolvedValue({
      asOf: '2026-10-04',
      items: [savings],
      totals: savings.values,
    });
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    await within(top).findByText('Synthetic Bank · 12% · until Dec 1, 2026');
    const rows = within(top).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Bitcoin0.05 BTC$2,100.00-0.80%$4,200.0042.00%',
      'Ethereum2 ETH$1,000.00+1.25%$2,000.0020.00%',
      'Savings ASynthetic Bank · 12% · until Dec 1, 2026——$1,800.0018.00%',
      'US Dollar1,500 USD$1.00Fixed$1,500.0015.00%',
      'Solana2 SOL$450.00+1.25%$900.009.00%',
    ]);
    expect(within(rows[2]).getByRole('link', { name: 'Savings A' })).toHaveAttribute(
      'href',
      `/deposits/${savings.id}`,
    );
  });

  it('dashboard-02 lists the bank deposit among the top assets on phones', async () => {
    phone();
    valued.mockImplementation(async (currency?: AccountingCurrency) => withDeposit(currency));
    vi.spyOn(depositsApi, 'list').mockResolvedValue({
      asOf: '2026-10-04',
      items: [savings],
      totals: savings.values,
    });
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    const deposit = await within(top).findByRole('link', { name: /Savings A/ });
    await waitFor(() =>
      expect(deposit).toHaveTextContent(
        'Savings ASynthetic Bank · 12% · until Dec 1, 2026$1,800.00Interest daily',
      ),
    );
    expect(deposit).toHaveAttribute('href', `/deposits/${savings.id}`);
    expect(within(top).getAllByRole('listitem')).toHaveLength(5);
  });

  it('dashboard-04 says when prices are old and marks the stale price', async () => {
    valued.mockImplementation(async (currency?: AccountingCurrency) =>
      valuation({
        currency: currency ?? 'USD',
        stalePriceCount: 1,
        assets: assets.map((item) =>
          item.symbol === 'BTC'
            ? {
                ...item,
                priceChange24hPercent: null,
                price: { ...item.price!, observedAt: ago(180), status: 'stale' as const },
              }
            : item,
        ),
      }),
    );
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    await within(top).findByRole('link', { name: 'Bitcoin' });
    expect(
      screen.getByText('1 price is older than 2 hours; the last stored price is used.'),
    ).toHaveClass('ui-banner');
    const bitcoin = within(top).getAllByRole('row')[1];
    expect(within(bitcoin).getAllByRole('cell')[1]).toHaveTextContent('$2,100.00stale, 3 h ago');
  });

  it('dashboard-04 says nothing about old prices when every price is fresh', async () => {
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    await within(top).findByRole('link', { name: 'Bitcoin' });
    expect(document.body.textContent).not.toMatch(/older than 2 hours|stale/);
  });

  it('dashboard-06 shows Manual and Fixed in the 24h column and no unit price for a whole item', async () => {
    const held = [
      asset(1, 'Bitcoin', 'BTC', '4200'),
      asset(20, 'Painting', '', '3000', {
        symbol: null,
        assetType: 'manual',
        priceSource: 'manual',
        quantity: '1',
        price: { value: '3000', observedAt: ago(60), source: 'manual', status: 'manual' },
        priceChange24hPercent: '0.00',
      }),
      asset(3, 'Euro', 'EUR', '1500', {
        assetType: 'fiat',
        priceSource: 'fixed',
        quantity: '1380',
        price: { value: '1.086957', observedAt: null, source: 'fixed', status: 'fixed' },
        priceChange24hPercent: '0.01',
      }),
    ];
    valued.mockImplementation(async (currency?: AccountingCurrency) => {
      const base = valuation({ currency: currency ?? 'USD', assets: held });
      const byAsset = held.map((item) => slice(item.instrumentId, item.name, item.value ?? '0'));
      return { ...base, allocation: { ...base.allocation, byAsset } };
    });
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    await within(top).findByRole('link', { name: 'Painting' });
    const cells = (name: string) =>
      within(within(top).getByRole('link', { name }).closest('tr')!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells('Painting').slice(1, 3)).toEqual(['—', 'Manual']);
    expect(cells('Euro').slice(1, 3)).toEqual(['$1.09', 'Fixed']);
    expect(cells('Bitcoin').slice(1, 3)).toEqual(['$2,100.00', '+1.25%']);
  });

  it('dashboard-19 shows row skeletons, not a sentence, while the assets load', async () => {
    valued.mockReturnValue(new Promise(() => {}));
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top assets' });
    expect(top).not.toHaveTextContent('Loading assets');
    expect(top.querySelectorAll('.dashboard-loading__row')).toHaveLength(5);
    expect(document.querySelector('.dashboard-loading__allocation')).not.toBeNull();
  });

  it('dashboard-19 the first skeleton covers the goal, top assets and allocation too', async () => {
    get.mockReturnValue(new Promise(() => {}));
    valued.mockReturnValue(new Promise(() => {}));
    renderPage();
    const loading = screen.getByRole('status', { name: 'Loading your capital' });
    expect(loading.querySelector('.dashboard-loading__goal')).not.toBeNull();
    expect(loading.querySelectorAll('.dashboard-loading__row')).toHaveLength(5);
    expect(loading.querySelector('.dashboard-loading__allocation')).not.toBeNull();
    expect(loading.textContent).toBe('');
  });

  it('dashboard-22 opens the asset from anywhere on its row', async () => {
    function Where() {
      return <p data-testid="where">{useLocation().pathname}</p>;
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AttentionProvider>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/portfolio/:id" element={<Where />} />
          </Routes>
        </AttentionProvider>
      </MemoryRouter>,
    );
    const top = await screen.findByRole('region', { name: 'Top assets' });
    const row = (await within(top).findByRole('link', { name: 'Ethereum' })).closest('tr')!;
    await user.click(within(row).getByText('$2,000.00'));
    expect(await screen.findByTestId('where')).toHaveTextContent(`/portfolio/${id(2)}`);
  });

  it('dashboard-23 keeps the note icon on the line of the text it qualifies', async () => {
    get.mockImplementation(async (period: HistoryPeriod) => history({ period, complete: false }));
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    const note = within(hero).getByRole('img', { name: /Incomplete/ });
    expect(note.closest('.dashboard-hero__period')).toHaveTextContent('on $90,000.00 net invested');
  });

  it('dashboard-13 colours a broker fund and a property by their class in the allocation and top assets, not the Other grey', async () => {
    const broker = id(20);
    const home = id(21);
    accounts.mockResolvedValue({
      items: [
        account(trust, 'Trust Wallet'),
        account(broker, 'Synthetic Broker', 'broker'),
        account(home, 'Studio account', 'property'),
      ],
      nextCursor: null,
    });
    const manual = (n: number, name: string, symbol: string | null, value: string, at: string) =>
      asset(n, name, symbol ?? '', value, {
        symbol,
        assetType: 'manual',
        priceSource: 'manual',
        quantity: '1',
        price: { value, observedAt: ago(60), source: 'manual', status: 'manual' },
        priceChange24hPercent: null,
        holdings: [{ accountId: at, accountName: 'Account', quantity: '1', value }],
      });
    const held = [
      manual(30, 'Sample index fund', 'SIF', '5000', broker),
      manual(31, 'Studio apartment', null, '4000', home),
      assets[0],
    ];
    valued.mockImplementation(async (currency?: AccountingCurrency) =>
      valuation({
        currency: currency ?? 'USD',
        assets: held,
        allocation: {
          complete: true,
          byAsset: held.map((item) => slice(item.instrumentId, item.name, item.value ?? '0')),
          byType: [slice('manual', 'Other', '9000'), slice('crypto', 'Crypto', '4200')],
          byAccount: [
            slice(broker, 'Synthetic Broker', '5000'),
            slice(home, 'Studio account', '4000'),
            slice(trust, 'Trust Wallet', '4200'),
          ],
        },
      }),
    );
    renderPage();
    const allocation = await screen.findByRole('region', { name: 'Allocation' });
    const swatch = (label: string) =>
      within(allocation)
        .getByText(label)
        .closest('li')
        ?.querySelector<HTMLElement>('.portfolio-swatch')?.style.background;
    await waitFor(() => expect(swatch('Sample index fund')).toBe('var(--c-broker)'));
    expect(swatch('Studio apartment')).toBe('var(--c-prop)');
    const top = await screen.findByRole('region', { name: 'Top assets' });
    const icon = (name: string) =>
      within(top)
        .getByRole('link', { name })
        .closest('tr')
        ?.querySelector<HTMLElement>('.asset-icon')?.style.background;
    expect(icon('Sample index fund')).toBe('var(--c-broker)');
    expect(icon('Studio apartment')).toBe('var(--c-prop)');
    // An asset held in a wallet keeps its own colour.
    expect(icon('Bitcoin')).toBe('var(--c-btc)');
  });
});
