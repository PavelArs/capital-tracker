import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import {
  type AssetLots,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type PropertyDetails, propertyDetailsApi } from '@api/property-details.api';
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
    totalValue: '200000',
    pricedSubtotal: '200000',
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

// What the owner recorded with a property (GET /accounting/property-details).
const details = (instrumentId: string, changes: Partial<PropertyDetails>): PropertyDetails => ({
  instrumentId,
  monthlyRent: null,
  currency: 'USD',
  note: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...changes,
});

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.spyOn(propertyDetailsApi, 'list').mockResolvedValue([
    details(id(1), { monthlyRent: '450.00' }),
  ]);
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
        <Route path="/real-estate/:assetId" element={<p>Property page</p>} />
        <Route path="/portfolio/:instrumentId" element={<p>Asset page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('PROPERTY-LIST Real estate', () => {
  it('RUB-WHOLE-PROPERTY keeps kopecks in the whole-property unit estimate', async () => {
    const property = {
      ...properties[0],
      price: { ...properties[0].price!, value: '92000.75' },
      value: '46000.375',
    };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      ...valuation([property]),
      currency: 'RUB',
      mainCurrency: 'RUB',
    });
    renderPage();
    expect(await screen.findByRole('link', { name: /Studio/ })).toHaveTextContent(
      'Whole property₽92,000.75',
    );
  });
  it('shows each property held in a property account with the owner’s share', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    const user = userEvent.setup();
    renderPage();
    const list = await screen.findByRole('list');
    const cards = within(list).getAllByRole('link');
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      `/real-estate/${id(1)}`,
      `/real-estate/${id(2)}`,
    ]);
    await vi.waitFor(() => expect(cards[0]).toHaveTextContent('Bought'));
    await vi.waitFor(() => expect(cards[0]).toHaveTextContent('Rent $450.00'));
    // PROPERTY-CARD: the header names the property and its share, with the owner's value and
    // what it is; one row under it holds what was paid, the rent, the gain and the estimate.
    expect(cards[0]).toHaveTextContent('StudioReal estate · 50% yours$46,000.00Your estimate');
    expect(cards[0]).toHaveTextContent('Whole property$92,000.00');
    expect(cards[0]).toHaveTextContent('Bought Sep 1, 2025for $42,500.00');
    expect(cards[0]).toHaveTextContent('Rent $450.00 a monthEntered by you');
    expect(cards[0]).toHaveTextContent('Gain+$3,500.00 +8.24%');
    expect(cards[0]).toHaveTextContent('Estimate Aug 1, 2026');
    expect(cards[1]).toHaveTextContent('LandReal estate · Fully yours$15,000.00Your estimate');
    expect(cards[1]).toHaveTextContent('Paid $16,000.00');
    expect(cards[1]).toHaveTextContent('Rent not recorded');
    expect(cards[1]).toHaveTextContent('Gain-$1,000.00 -6.25%');
    expect(cards[1]).not.toHaveTextContent('Bought');
    expect(screen.getByRole('region', { name: 'Total in real estate' })).toHaveTextContent(
      'In real estate$61,000.00',
    );
    expect(screen.queryByText('Gold coins')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add property' }));
    expect(screen.getByRole('dialog', { name: 'Add property' })).toBeInTheDocument();
  });

  it('PROPERTY-SHARE gives the share of net worth held in real estate, estimated while net worth is partly unknown', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    renderPage();
    const summary = await screen.findByRole('region', { name: 'Total in real estate' });
    expect(summary).toHaveTextContent('In real estate$61,000.00');
    expect(summary).toHaveTextContent('Share of net worth30.5%');
    expect(summary).not.toHaveTextContent('≈');
    cleanup();
    forgetReads();
    get.mockResolvedValue({
      ...valuation(properties),
      totalValue: null,
      pricedSubtotal: '122000',
      missingPriceCount: 1,
    });
    renderPage();
    const estimated = await screen.findByRole('region', { name: 'Total in real estate' });
    expect(estimated).toHaveTextContent('Share of net worth≈50%');
    expect(estimated).toHaveTextContent('Estimated against the known net worth');
  });

  it('PROPERTY-RENT shows a rent as entered, with its kopecks, in the currency of the property', async () => {
    const flat = {
      ...properties[0],
      valuationCurrency: 'RUB' as const,
      quantity: '1',
      holdings: [{ accountId: studio, accountName: 'Studio', quantity: '1', value: '9000000' }],
      price: { ...properties[0].price!, value: '9000000' },
      value: '9000000',
    };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      ...valuation([flat]),
      currency: 'RUB',
      mainCurrency: 'RUB',
    });
    vi.spyOn(propertyDetailsApi, 'list').mockResolvedValue([
      details(id(1), { monthlyRent: '45000.50', currency: 'RUB' }),
    ]);
    renderPage();
    expect(await screen.findByRole('link', { name: /Studio/ })).toHaveTextContent(
      'Rent ₽45,000.50 a month',
    );
  });

  it('PROPERTY-RENT does not call a rent missing when it could not be read', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    vi.spyOn(propertyDetailsApi, 'list').mockRejectedValue(new Error('offline'));
    renderPage();
    const [card] = within(await screen.findByRole('list')).getAllByRole('link');
    await vi.waitFor(() => expect(card).toHaveTextContent('Rent unavailable'));
    expect(card).not.toHaveTextContent('Rent not recorded');
    // The figures that do not depend on it are still there.
    expect(card).toHaveTextContent('$46,000.00Your estimate');
  });

  it('PROPERTY-RENT-STALE warns and offers a refresh when the kept rents could not be read again', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    const list = vi.spyOn(propertyDetailsApi, 'list');
    list.mockResolvedValue([details(id(1), { monthlyRent: '450.00' })]);
    renderPage();
    const [first] = within(await screen.findByRole('list')).getAllByRole('link');
    await vi.waitFor(() => expect(first).toHaveTextContent('Rent $450.00 a month'));
    cleanup();
    // Back on the page: the kept rents show at once and asking again fails.
    list.mockRejectedValue(new Error('offline'));
    renderPage();
    const [again] = within(await screen.findByRole('list')).getAllByRole('link');
    expect(again).toHaveTextContent('Rent $450.00 a month');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not refresh the rent; showing the last loaded ones.');
    list.mockResolvedValue([details(id(1), { monthlyRent: '500.00' })]);
    await userEvent.click(within(alert).getByRole('button', { name: 'Refresh' }));
    await vi.waitFor(() => expect(again).toHaveTextContent('Rent $500.00 a month'));
  });

  it('PROPERTY-RENT-RETRY offers a refresh when the first read of the rents failed', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    const list = vi.spyOn(propertyDetailsApi, 'list');
    list.mockRejectedValueOnce(new Error('offline'));
    list.mockResolvedValue([details(id(1), { monthlyRent: '450.00' })]);
    renderPage();
    const [card] = within(await screen.findByRole('list')).getAllByRole('link');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not read the rent.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Refresh' }));
    await vi.waitFor(() => expect(card).toHaveTextContent('Rent $450.00 a month'));
    expect(screen.queryByRole('alert')).toBeNull();
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
    expect(card).toHaveTextContent('GarageReal estate · Fully yours$20,000.00');
    expect(card).toHaveTextContent('Paid —');
    expect(card).toHaveTextContent('Gain—');
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
    expect(card).toHaveTextContent('TowerReal estate · Less than 0.01% yours$20,000.00');
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
    expect(alert).toHaveTextContent("Couldn't load your real estate.");
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
      return within(card).queryByText(/over two months old/);
    };
    // Sep 30, 23:59 in Moscow: 60 days after Aug 1, not yet over 60 days.
    expect(await badge('2026-09-30T20:59:00Z', '2026-07-31T21:30:00.000Z')).toBeNull();
    // Oct 1, 00:00 in Moscow: 61 days. The badge says it in words as well as in its colour.
    const warned = await badge('2026-09-30T21:00:00Z', '2026-07-31T21:30:00.000Z');
    expect(warned?.closest('.ui-badge')).toHaveClass('ui-badge--warn');
    expect(screen.getByRole('link', { name: /Studio/ })).toHaveTextContent(
      'Estimate Aug 1, 2026, over two months old',
    );
    expect(await badge('2026-09-30T21:00:00Z', '2026-08-02T00:00:00.000Z')).toBeNull();
    expect(screen.getByRole('link', { name: /Studio/ })).toHaveTextContent('Estimate Aug 2, 2026');
  });

  it('classes-23 dates the estimate and the first purchase as the rest of the app does', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(properties));
    renderPage();
    const [first, second] = within(await screen.findByRole('list')).getAllByRole('link');
    expect(await within(first).findByText(/Bought Sep 1, 2025/)).toBeInTheDocument();
    expect(first).toHaveTextContent('Estimate Aug 1, 2026');
    expect(portfolioValuationApi.lots).toHaveBeenCalledWith(id(2), undefined);
    // Land's history may start after its purchase, so no purchase date is claimed.
    expect(second).not.toHaveTextContent('Bought');
    expect(second).toHaveTextContent('Estimate Oct 12, 2026');
  });
});
