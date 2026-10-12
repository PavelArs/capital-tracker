import { type AccountSummary, accountingApi } from '@api/accounting.api';
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

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      account(studio, 'Studio', 'property'),
      account(plot, 'Land', 'property'),
      account(wallet, 'Home safe', null),
    ],
    nextCursor: null,
  });
});
afterEach(cleanup);

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
    expect(cards[0]).toHaveTextContent(
      'Studio50% yours$46,000.00Whole property$92,000.00Estimate of1 Aug 2026Paid$42,500.00Gain+$3,500.00 (+8.24%)',
    );
    expect(cards[1]).toHaveTextContent(
      'LandFully yours$15,000.00Estimate of12 Oct 2026Paid$16,000.00Gain-$1,000.00 (-6.25%)',
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

  it('offers to add the first property', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([properties[2]]));
    renderPage();
    expect(await screen.findByText('No property yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument();
  });
});
