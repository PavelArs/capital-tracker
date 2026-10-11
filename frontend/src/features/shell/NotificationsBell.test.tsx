import { announceClassificationChange, operationsApi } from '@api/operations.api';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { announceSyncChange, type SyncSource, syncStatusApi } from '@api/sync-status.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from './attention-context';
import PageHeader from './PageHeader';

vi.mock('../portfolio/AddTransactionDialog', () => ({ default: () => null }));

// Synthetic ids, names and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cold = id(11);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

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

const ethereumWallet: WalletAddress = {
  id: id(22),
  network: 'ethereum',
  address: `0x${'ab'.repeat(20)}`,
  accountId: cold,
  label: 'Cold ETH',
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 0,
  chainBalance: null,
  balances: null,
  sync: {
    state: 'never',
    completedAt: null,
    status: 'failed',
    lastAttemptAt: ago(5),
    lastSuccessAt: null,
    nextRunAt: null,
    errorMessage: 'Ethereum sync needs a valid Etherscan API key on the server.',
  },
};

const valuation = { assets: [], stalePriceCount: 0, accounts: [] } as unknown as PortfolioValuation;

const toClassify = vi.spyOn(operationsApi, 'needsClassification');
const valued = vi.spyOn(portfolioValuationApi, 'get');
const sources = vi.spyOn(syncStatusApi, 'get');
const wallets = vi.spyOn(walletAddressesApi, 'list');

function renderHeader(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AttentionProvider>
        <PageHeader title="Dashboard" currency="USD" />
      </AttentionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  toClassify.mockReset();
  toClassify.mockResolvedValue(0);
  valued.mockReset();
  valued.mockResolvedValue(valuation);
  sources.mockReset();
  sources.mockResolvedValue([pricesSource()]);
  wallets.mockReset();
  wallets.mockResolvedValue([]);
});
afterEach(cleanup);

describe('ATTN-BELL: the header bell', () => {
  it('shows how many things need the owner and lists them with their way out', async () => {
    const user = userEvent.setup();
    toClassify.mockResolvedValue(3);
    sources.mockResolvedValue([
      pricesSource({ state: 'failed', lastSuccessAt: ago(125), errorMessage: null }),
    ]);
    wallets.mockResolvedValue([ethereumWallet]);
    renderHeader('/dashboard?currency=EUR');
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 need attention' });
    expect(bell).toHaveTextContent('3');
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    await user.click(bell);
    const panel = screen.getByRole('region', { name: 'Notifications' });
    expect(
      within(panel)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Prices are 2 hours oldMarket data is temporarily unavailable. Values use the last stored prices.',
      '3 blockchain transactions need classificationFound by wallet syncReview',
      'Ethereum wallet sync failedCold ETH · Ethereum sync needs a valid Etherscan API key on the server. Never synced.Open',
    ]);
    expect(within(panel).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/transactions?status=needs-classification&currency=EUR',
    );
    expect(within(panel).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/wallets/${cold}?currency=EUR`,
    );
    expect(panel).not.toHaveTextContent('Everything is up to date');
  });

  it('says that all is well, without a counter, when nothing needs the owner', async () => {
    const user = userEvent.setup();
    renderHeader();
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(bell).toHaveAttribute('aria-expanded', 'false'));
    await user.click(bell);
    const panel = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() =>
      expect(panel).toHaveTextContent('Everything is up to date. Prices updated 8 min ago.'),
    );
    expect(within(panel).queryByRole('listitem')).toBeNull();
    expect(bell).not.toHaveTextContent(/\d/);
  });

  it('does not say everything is fine when the status cannot be read', async () => {
    const user = userEvent.setup();
    sources.mockRejectedValue(new Error('offline'));
    renderHeader();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    const panel = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() =>
      expect(panel).toHaveTextContent('Could not check the sync status. Try again later.'),
    );
    expect(panel).not.toHaveTextContent('Everything is up to date');
  });

  it('reads the status again when a wallet sync or a classification changes it', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    const panel = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() => expect(panel).toHaveTextContent('Everything is up to date'));
    wallets.mockResolvedValue([ethereumWallet]);
    announceSyncChange();
    await waitFor(() => expect(panel).toHaveTextContent('Ethereum wallet sync failed'));
    toClassify.mockResolvedValue(2);
    announceClassificationChange();
    await waitFor(() => expect(panel).toHaveTextContent('2 blockchain transactions'));
    toClassify.mockResolvedValue(0);
    wallets.mockResolvedValue([]);
    announceClassificationChange();
    await waitFor(() => expect(panel).toHaveTextContent('Everything is up to date'));
  });

  it('closes on Escape, on a click outside and after following a link', async () => {
    const user = userEvent.setup();
    toClassify.mockResolvedValue(1);
    renderHeader();
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 need attention' });
    await user.click(bell);
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    expect(bell).toHaveFocus();
    await user.click(bell);
    await user.click(screen.getByRole('heading', { name: 'Dashboard' }));
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    await user.click(bell);
    await user.click(screen.getByRole('link', { name: 'Review' }));
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
  });

  it('is absent where the page has no shell around it', () => {
    render(
      <MemoryRouter>
        <PageHeader title="Dashboard" currency="USD" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
  });
});
