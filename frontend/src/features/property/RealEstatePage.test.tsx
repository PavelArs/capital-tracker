import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import {
  type AssetLots,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RealEstatePage from './RealEstatePage';

// Synthetic names, ids and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const studio = id(11);
const plot = id(12);
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
  accountId: string,
  changes: Partial<AssetValuation>,
): AssetValuation => ({
  instrumentId: id(n),
  name,
  symbol: null,
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
  holdings: [{ accountId, accountName: name, quantity: changes.quantity ?? '1', value: null }],
  ...changes,
});
const valuation = (assets: AssetValuation[]) =>
  ({
    at: '2026-10-12T12:00:00.000Z',
    currency: 'USD',
    mainCurrency: 'USD',
    assets,
    accounts: [],
  }) as unknown as PortfolioValuation;

const properties = [
  asset(1, 'Studio', studio, {
    quantity: '0.5',
    price: {
      value: '92000',
      observedAt: '2026-08-01T00:00:00.000Z',
      source: 'manual',
      status: 'fresh',
    },
    value: '46000',
    costBasis: '42500',
    unrealizedPnl: '3500',
    unrealizedReturnPercent: '8.24',
  }),
  asset(2, 'Land', plot, {
    price: {
      value: '15000',
      observedAt: '2026-10-12T09:00:00.000Z',
      source: 'manual',
      status: 'fresh',
    },
    value: '15000',
    costBasis: '16000',
    unrealizedPnl: '-1000',
    unrealizedReturnPercent: '-6.25',
  }),
  asset(3, 'Gold coins', wallet, { value: '900' }),
];

// The held lots the server lists for an asset, newest first (GET .../lots).
const lot = (accountId: string, acquiredAt: string, quantity = '1') => ({
  accountId,
  accountName: 'Synthetic',
  acquiredAt,
  quantity,
  paid: null,
  value: null,
  nominalPnl: null,
  real: { official: null, personal: null },
});
const lotsOf: Record<string, Omit<AssetLots, 'instrumentId' | 'currency'>> = {
  // Half of the studio was bought, the rest later; the first purchase is the one shown.
  [id(1)]: {
    complete: true,
    lots: [
      lot(studio, '2026-02-10T00:00:00.000Z', '0.25'),
      lot(studio, '2025-09-01T00:00:00.000Z', '0.25'),
    ],
  },
  // An account whose history starts later may hold earlier lots: the purchase date is unknown.
  [id(2)]: { complete: false, lots: [lot(plot, '2026-03-01T00:00:00.000Z')] },
};

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  vi.spyOn(portfolioValuationApi, 'lots').mockImplementation(async (instrumentId) => ({
    instrumentId,
    currency: 'USD',
    ...(lotsOf[instrumentId] ?? { complete: true, lots: [] }),
  }));
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      account(studio, 'Studio', 'property'),
      account(plot, 'Land', 'property'),
      account(wallet, 'Home safe', null),
    ],
    nextCursor: null,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/real-estate']}>
      <Routes>
        <Route path="/real-estate" element={<RealEstatePage />} />
        <Route path="/portfolio/:instrumentId" element={<p>Asset page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('PROPERTY-LIST Real estate', () => {
  it('shows each property held in a property account with the owner’s share', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    const user = userEvent.setup();
    renderPage();
    const list = await screen.findByRole('list');
    const cards = within(list).getAllByRole('link');
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      `/portfolio/${id(1)}`,
      `/portfolio/${id(2)}`,
    ]);
    await vi.waitFor(() => expect(cards[0]).toHaveTextContent('Bought'));
    expect(cards[0]).toHaveTextContent(
      'Studio50% yours$46,000.00Whole property$92,000.00Estimate ofAug 1, 2026Over 60 days oldBoughtSep 1, 2025Paid$42,500.00Gain+$3,500.00 (+8.24%)',
    );
    expect(cards[1]).toHaveTextContent(
      'LandFully yours$15,000.00Estimate ofOct 12, 2026Paid$16,000.00Gain-$1,000.00 (-6.25%)',
    );
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      'In real estate$61,000.00',
    );
    expect(screen.queryByText('Gold coins')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add property' }));
    expect(screen.getByRole('dialog', { name: 'Add property' })).toBeInTheDocument();
  });

  it('counts only what is held in property accounts when the asset is also held elsewhere', async () => {
    // Codex P2: an asset bought into a wallet as well must not bring the wallet's part along.
    const mixed = asset(4, 'Garage', plot, {
      quantity: '1.5',
      value: '30000',
      costBasis: '25000',
      unrealizedPnl: '5000',
      unrealizedReturnPercent: '20',
      holdings: [
        { accountId: plot, accountName: 'Land', quantity: '1', value: '20000' },
        { accountId: wallet, accountName: 'Home safe', quantity: '0.5', value: '10000' },
      ],
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([mixed]));
    renderPage();
    const [card] = within(await screen.findByRole('list')).getAllByRole('link');
    expect(card).toHaveTextContent('GarageFully yours$20,000.00');
    expect(card).toHaveTextContent('Paid—Gain—');
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      '$20,000.00',
    );
  });

  it('keeps a share too small to round to a hundredth of a percent', async () => {
    // Codex P2: 0.004% of an expensive property is still held and still worth something.
    const sliver = asset(5, 'Tower', studio, {
      quantity: '0.00004',
      price: {
        value: '500000000',
        observedAt: '2026-10-12T09:00:00.000Z',
        source: 'manual',
        status: 'fresh',
      },
      value: '20000',
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([sliver]));
    renderPage();
    const [card] = within(await screen.findByRole('list')).getAllByRole('link');
    expect(card).toHaveTextContent('TowerLess than 0.01% yours$20,000.00');
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      '$20,000.00',
    );
  });

  it('offers to add the first property', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([properties[2]]));
    renderPage();
    expect(await screen.findByText('No property yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument();
  });

  it('SECTION-LAYOUT-ACTION keeps Add property in the intro line as the primary button, also with nothing to list', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    const { unmount } = renderPage();
    await screen.findByRole('list');
    const add = screen.getByRole('button', { name: 'Add property' });
    expect(add.closest('.ui-intro')).toHaveTextContent('Valued at your own estimate.');
    expect(add).toHaveClass('shell-button--primary');
    unmount();
    forgetReads();
    get.mockResolvedValue(valuation([properties[2]]));
    renderPage();
    await screen.findByText('No property yet');
    expect(
      screen.getByRole('button', { name: 'Add property' }).closest('.ui-intro'),
    ).not.toBeNull();
  });

  it('SECTION-LAYOUT-SHARE shows the share of net worth beside the total, and why when it is unknown', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockResolvedValue({ ...valuation(properties), totalValue: '122000' } as PortfolioValuation);
    const { unmount } = renderPage();
    await screen.findByRole('list');
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      'In real estate$61,000.00Share of net worth50%',
    );
    unmount();
    forgetReads();
    get.mockResolvedValue({
      ...valuation(properties),
      totalValue: null,
      missingPriceCount: 1,
      unratedDepositCount: 0,
      unavailableAccountCount: 0,
    } as unknown as PortfolioValuation);
    renderPage();
    await screen.findByRole('list');
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      'Share of net worth—Net worth unknown: 1 asset without a price or exchange rate.',
    );
  });

  it('says so when a refresh fails and keeps the last loaded figures', async () => {
    // Codex P2: kept cards must not pass for current ones when the fresh read fails.
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    await cachedReads.portfolio.load(undefined);
    await cachedReads.accounts.load();
    get.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not refresh your real estate; showing the last loaded figures.',
    );
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      '$61,000.00',
    );
    await user.click(within(alert).getByRole('button', { name: 'Refresh' }));
    expect(get).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers to try again when nothing could be loaded', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(valuation(properties));
    const user = userEvent.setup();
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your real estate.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('classes-17 marks an estimate more than 60 Moscow days old, from 21:00 UTC', async () => {
    // Set at 00:30 on Aug 1 in Moscow, which is still Jul 31 in UTC.
    const studioAt = (observedAt: string) =>
      valuation([
        asset(1, 'Studio', studio, {
          price: { value: '92000', observedAt, source: 'manual', status: 'manual' },
          value: '92000',
        }),
      ]);
    const badge = async (now: string, observedAt: string) => {
      cleanup();
      forgetReads();
      vi.setSystemTime(new Date(now));
      vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(studioAt(observedAt));
      renderPage();
      const [card] = within(await screen.findByRole('list')).getAllByRole('link');
      return within(card).queryByText('Over 60 days old');
    };
    // Sep 30, 23:59 in Moscow: 60 days after Aug 1, not yet over 60 days.
    expect(await badge('2026-09-30T20:59:00Z', '2026-07-31T21:30:00.000Z')).toBeNull();
    // Oct 1, 00:00 in Moscow: 61 days.
    const warned = await badge('2026-09-30T21:00:00Z', '2026-07-31T21:30:00.000Z');
    expect(warned).toHaveClass('ui-badge', 'ui-badge--warn');
    expect(screen.getByRole('link', { name: /Studio/ })).toHaveTextContent(
      'Estimate ofAug 1, 2026Over 60 days old',
    );
    expect(await badge('2026-09-30T21:00:00Z', '2026-08-02T00:00:00.000Z')).toBeNull();
  });

  it('classes-23 dates the estimate and the first purchase as the rest of the app does', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    renderPage();
    const [first, second] = within(await screen.findByRole('list')).getAllByRole('link');
    expect(await within(first).findByText('Sep 1, 2025')).toBeInTheDocument();
    expect(first).toHaveTextContent('Estimate ofAug 1, 2026');
    expect(portfolioValuationApi.lots).toHaveBeenCalledWith(id(2), undefined);
    // Land's history may start after its purchase, so no purchase date is claimed.
    expect(second).not.toHaveTextContent('Bought');
    expect(second).toHaveTextContent('Estimate ofOct 12, 2026');
  });
});
