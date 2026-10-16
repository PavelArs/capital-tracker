import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrokersPage from './BrokersPage';

// Synthetic names, ids and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const broker = id(11);
const iis = id(12);
const wallet = id(13);
const account = (accountId: string, name: string, assetClass: AccountSummary['assetClass']) => ({
  id: accountId,
  name,
  kind: null,
  assetClass,
  currentRevision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
});
const asset = (
  n: number,
  name: string,
  holdings: AssetValuation['holdings'],
  changes: Partial<AssetValuation> = {},
): AssetValuation => ({
  instrumentId: id(n),
  name,
  symbol: name,
  assetType: 'manual',
  valuationCurrency: 'USD',
  priceSource: 'manual',
  quantity: '1',
  price: null,
  missingPrice: null,
  priceChange24hPercent: null,
  value: null,
  allocationPercent: null,
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  knownCostQuantity: '1',
  averageBuyPrice: null,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings,
  ...changes,
});
const priced = (value: string, observedAt: string) => ({
  value,
  observedAt,
  source: 'manual',
  status: 'manual' as const,
});
const valuation = (assets: AssetValuation[], totalValue: string | null = '40000') =>
  ({
    at: '2026-10-13T12:00:00.000Z',
    currency: 'USD',
    mainCurrency: 'USD',
    totalValue,
    assets,
    accounts: [],
  }) as unknown as PortfolioValuation;

const held = [
  asset(
    1,
    'VWRA',
    [
      { accountId: broker, accountName: 'Sample Broker', quantity: '30', value: '4263' },
      { accountId: iis, accountName: 'Sample Broker · IIS', quantity: '10', value: '1421' },
    ],
    { price: priced('142.1', '2026-10-01T09:00:00.000Z') },
  ),
  asset(
    2,
    'Bond fund 2030',
    [{ accountId: broker, accountName: 'Sample Broker', quantity: '4', value: null }],
    { symbol: null },
  ),
  asset(
    3,
    'US dollar',
    [{ accountId: broker, accountName: 'Sample Broker', quantity: '250', value: '250' }],
    { symbol: 'USD', assetType: 'fiat', priceSource: 'fixed' },
  ),
  asset(
    5,
    'Euro bond fund',
    [{ accountId: iis, accountName: 'Sample Broker · IIS', quantity: '3', value: null }],
    { symbol: null, valuationCurrency: 'EUR', missingPrice: 'no-rate' },
  ),
  asset(4, 'Gold coins', [
    { accountId: wallet, accountName: 'Home safe', quantity: '1', value: '900' },
  ]),
];

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      account(broker, 'Sample Broker', 'broker'),
      account(iis, 'Sample Broker · IIS', 'broker'),
      account(wallet, 'Home safe', null),
    ],
    nextCursor: null,
  });
});
afterEach(cleanup);

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/brokers']}>
      <Routes>
        <Route path="/brokers" element={<BrokersPage />} />
        <Route path="/portfolio/:instrumentId" element={<p>Asset page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('BROKERS the Brokers page', () => {
  it('shows each broker account with its positions, then its cash', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    const user = userEvent.setup();
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(within(sample).getByText('2 positions')).toBeInTheDocument();
    expect(within(sample).getByText('$4,513.00')).toBeInTheDocument();
    const rows = within(sample).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      `/portfolio/${id(1)}`,
      `/portfolio/${id(2)}`,
      `/portfolio/${id(3)}`,
    ]);
    expect(rows[0]).toHaveTextContent('VWRA30 × $142.10$4,263.00Price of Oct 1, 2026');
    expect(rows[1]).toHaveTextContent('Bond fund 20304 × ——No price yet');
    expect(rows[2]).toHaveTextContent('Cash, USD250$250.00');
    const other = screen.getByRole('region', { name: 'Sample Broker · IIS' });
    expect(within(other).getByText('2 positions')).toBeInTheDocument();
    // Codex P2: a stored price without an exchange rate is not a missing price.
    expect(within(other).getAllByRole('link')[1]).toHaveTextContent('Euro bond fund3 × ——No rate');
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent(
      'At brokers$5,934.00Share of net worth14.8%1 position without a price left out. 1 position without an exchange rate left out.',
    );
    expect(screen.queryByText('Gold coins')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add broker account' }));
    expect(screen.getByRole('dialog', { name: 'Add broker account' })).toBeInTheDocument();
  });

  it('says which cash balance has no exchange rate', async () => {
    // Codex P2: euro cash without a rate to the shown currency is left out; its row says why.
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      valuation([
        asset(
          6,
          'Euro',
          [{ accountId: broker, accountName: 'Sample Broker', quantity: '300', value: null }],
          { symbol: 'EUR', assetType: 'fiat', priceSource: 'fixed', missingPrice: 'no-rate' },
        ),
      ]),
    );
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(within(sample).getByRole('link')).toHaveTextContent('Cash, EUR300—No rate');
  });

  it('offers to add the first broker account', async () => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(wallet, 'Home safe', null)],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([held[3]]));
    renderPage();
    expect(await screen.findByText('No broker account yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add broker account' })).toBeInTheDocument();
  });

  it('SECTION-LAYOUT-ACTION keeps Add broker account in the intro line as the primary button, also with nothing to list', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Sample Broker' });
    const add = screen.getByRole('button', { name: 'Add broker account' });
    expect(add.closest('.ui-intro')).toHaveTextContent('Positions are entered by hand for now');
    expect(add).toHaveClass('shell-button--primary');
    unmount();
    forgetReads();
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(wallet, 'Home safe', null)],
      nextCursor: null,
    });
    get.mockResolvedValue(valuation([held[3]]));
    renderPage();
    await screen.findByText('No broker account yet');
    const empty = screen.getByRole('button', { name: 'Add broker account' });
    expect(empty.closest('.ui-intro')).not.toBeNull();
    expect(empty).toHaveClass('shell-button--primary');
  });

  it('SECTION-STATES keeps the Add broker account action while the page loads and when it cannot load', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockRejectedValue(new Error('offline'));
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Add broker account' }).closest('.ui-intro'),
    ).not.toBeNull();
    await screen.findByText('Could not load your broker accounts. Your data is safe; try again.');
    expect(
      screen.getByRole('button', { name: 'Add broker account' }).closest('.ui-intro'),
    ).not.toBeNull();
  });

  it('SECTION-STATES says nothing about last loaded figures above the empty card', async () => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(wallet, 'Home safe', null)],
      nextCursor: null,
    });
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([held[3]]));
    await cachedReads.portfolio.load(undefined);
    await cachedReads.accounts.load();
    get.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    await screen.findByText('No broker account yet');
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SECTION-LAYOUT-GRID lists the accounts as wide cards, one on each line', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(sample.closest('ul')).toHaveClass('section-grid', 'section-grid--wide');
  });

  it('says so when a refresh fails and keeps the last loaded figures', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    await cachedReads.portfolio.load(undefined);
    await cachedReads.accounts.load();
    get.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not refresh your broker accounts; showing the last loaded figures.',
    );
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent('$5,934.00');
    await user.click(within(alert).getByRole('button', { name: 'Refresh' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers to try again when nothing could be loaded', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(valuation(held));
    const user = userEvent.setup();
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your broker accounts.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Sample Broker' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('classes-22 says why the share of net worth is unknown, with no number made up', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      ...valuation(held, null),
      completeness: 'incomplete',
      missingPriceCount: 2,
      unratedDepositCount: 1,
      unavailableAccountCount: 0,
    });
    renderPage();
    const summary = await screen.findByRole('region', { name: 'Total at brokers' });
    expect(summary).toHaveTextContent(
      'Share of net worth—Net worth unknown: 2 assets without a price or exchange rate, 1 deposit without an exchange rate.',
    );
    expect(summary).not.toHaveTextContent('%');
  });

  it('classes-22 notes under an account total the positions it leaves out', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(within(sample).getByText('$4,513.00').parentElement).toHaveTextContent(
      '$4,513.001 position without a price left out.',
    );
    const other = screen.getByRole('region', { name: 'Sample Broker · IIS' });
    // The account's total comes before its one position, worth the same.
    expect(within(other).getAllByText('$1,421.00')[0].parentElement).toHaveTextContent(
      '$1,421.001 position without an exchange rate left out.',
    );
  });
});
