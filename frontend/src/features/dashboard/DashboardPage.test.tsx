import { operationsApi } from '@api/operations.api';
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
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../shell/attention-context';
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
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostCount: 0,
  missingRateCount: 0,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
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
    expect(within(hero).getByRole('note')).toHaveTextContent(/Incomplete/);
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
      'US Dollar1,500 USD$1.00—$1,500.0015.00%',
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
    await user.click(within(allocation).getByRole('radio', { name: 'Account' }));
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
        'Bitcoin$4,200.000.05 BTC-0.80% today',
        'Ethereum$2,000.002 ETH+1.25% today',
        'US Dollar$1,500.001,500 USDFixed',
        'Solana$900.002 SOL+1.25% today',
        'Zcash$600.002 ZEC+1.25% today',
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
    await screen.findByRole('button', { name: 'Notifications, 1 need attention' });
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/blockchain transactions need classification/);
  });

  it('DASH-UNKNOWN-COST names the coins without a purchase price under the net worth', async () => {
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
    expect(await within(hero).findByRole('note')).toHaveTextContent(
      '0.0087 BTC, 1.5 ETH and 1 more without purchase price, so cost basis and profit are incomplete.',
    );
  });

  it('DASH-UNKNOWN-COST stays quiet when every coin has a purchase price', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Net worth' });
    await screen.findByRole('region', { name: 'Top assets' });
    expect(within(hero).queryByRole('note')).not.toBeInTheDocument();
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
});
