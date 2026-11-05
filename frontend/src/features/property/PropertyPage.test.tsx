import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { type AssetHistory, assetHistoryApi } from '@api/asset-history.api';
import { manualPricesApi, type PriceBook, type PriceReceipt } from '@api/manual-prices.api';
import { operationsApi } from '@api/operations.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type PropertyDetails, propertyDetailsApi } from '@api/property-details.api';
import { forgetReads } from '@api/read-cache';
import { ToastProvider } from '@contexts/ToastContext';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToastViewport from '../../components/Toast';
import PropertyPage from './PropertyPage';

// Synthetic names, ids and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const studio = id(11);
const safe = id(13);
const account = (accountId: string, name: string, assetClass: AccountSummary['assetClass']) => ({
  id: accountId,
  name,
  kind: null,
  assetClass,
  currentRevision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
});
const flat = {
  instrumentId: id(1),
  name: 'Studio',
  symbol: null,
  assetType: 'manual',
  valuationCurrency: 'USD',
  priceSource: 'manual',
  quantity: '0.5',
  price: {
    value: '92000',
    observedAt: '2026-08-01T00:00:00.000Z',
    source: 'manual',
    status: 'manual',
  },
  missingPrice: null,
  priceChange24hPercent: null,
  value: '46000',
  allocationPercent: null,
  costBasis: '42500',
  knownCostSubtotal: '42500',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  knownCostQuantity: '0.5',
  averageBuyPrice: null,
  unrealizedPnl: '3500',
  unrealizedReturnPercent: '8.24',
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings: [{ accountId: studio, accountName: 'Studio', quantity: '0.5', value: '46000' }],
} as unknown as AssetValuation;
const coins = {
  ...flat,
  instrumentId: id(3),
  name: 'Gold coins',
  holdings: [{ accountId: safe, accountName: 'Home safe', quantity: '1', value: '900' }],
} as AssetValuation;
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

const receipt = (
  revision: number,
  observedAt: string,
  price: string,
  quoteCurrency: PriceReceipt['quoteCurrency'] = 'USD',
) =>
  ({
    instrumentId: id(1),
    revision,
    requestId: id(100 + revision),
    kind: 'set',
    observedAt,
    price,
    priceUsd: quoteCurrency === 'USD' ? price : null,
    createdAt: observedAt,
    source: 'manual',
    quoteCurrency,
  }) as PriceReceipt;
const book = (items: PriceReceipt[], currentRevision = items.length): PriceBook => ({
  instrument: { id: id(1), name: 'Studio', symbol: null, namespace: 'manual' },
  currentRevision,
  source: 'manual',
  quoteCurrency: 'USD',
  items,
  nextOffset: null,
});
const details = (changes: Partial<PropertyDetails> = {}): PropertyDetails => ({
  instrumentId: id(1),
  monthlyRent: '450.00',
  currency: 'USD',
  note: 'Mortgage to 2031',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...changes,
});
const history = (instrumentId: string): AssetHistory => ({
  instrumentId,
  period: '1M',
  currency: 'USD',
  mainCurrency: 'USD',
  from: '2026-09-05T00:00:00.000Z',
  at: '2026-10-12T12:00:00.000Z',
  points: [],
});

const savePrice = vi.fn();
const saveDetails = vi.fn();
beforeEach(() => {
  vi.restoreAllMocks();
  savePrice.mockReset().mockResolvedValue({} as PriceReceipt);
  saveDetails.mockReset().mockResolvedValue(details());
  forgetReads();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [account(studio, 'Studio', 'property'), account(safe, 'Home safe', null)],
    nextCursor: null,
  });
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([flat, coins]));
  vi.spyOn(portfolioValuationApi, 'lots').mockImplementation(async (instrumentId) => ({
    instrumentId,
    currency: 'USD',
    complete: true,
    lots: [
      {
        accountId: studio,
        accountName: 'Studio',
        acquiredAt: '2025-09-01T00:00:00.000Z',
        quantity: '0.5',
        paid: null,
        value: null,
        nominalPnl: null,
        real: { official: null, personal: null },
      },
    ],
  }));
  vi.spyOn(propertyDetailsApi, 'list').mockResolvedValue([details()]);
  vi.spyOn(propertyDetailsApi, 'set').mockImplementation(saveDetails);
  vi.spyOn(manualPricesApi, 'list').mockResolvedValue(
    book([
      receipt(2, '2026-08-01T00:00:00.000Z', '92000'),
      receipt(1, '2025-09-01T00:00:00.000Z', '85000'),
    ]),
  );
  vi.spyOn(manualPricesApi, 'set').mockImplementation(savePrice);
  vi.spyOn(operationsApi, 'list').mockResolvedValue({
    at: '2026-10-12T12:00:00.000Z',
    quoteCurrency: 'USD',
    needsClassificationCount: 0,
    dustThresholdUsd: null,
    operations: [],
  });
  vi.spyOn(assetHistoryApi, 'get').mockImplementation(async (instrumentId) =>
    history(instrumentId),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderAt = (path: string) =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/real-estate" element={<p>Real estate list</p>} />
          <Route path="/real-estate/:assetId" element={<PropertyPage />} />
          <Route path="/portfolio/:assetId" element={<p>Asset page</p>} />
        </Routes>
      </MemoryRouter>
      <ToastViewport />
    </ToastProvider>,
  );
const open = async () => {
  renderAt(`/real-estate/${id(1)}`);
  return screen.findByRole('heading', { name: 'Studio', level: 2 });
};
const openDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await open();
  const card = await screen.findByRole('region', { name: 'Rent and notes' });
  await waitFor(() => expect(card).toHaveTextContent('Mortgage to 2031'));
  await user.click(within(card).getByRole('button', { name: 'Edit' }));
  return screen.getByRole('dialog', { name: 'Rent and notes' });
};

describe('PROPERTY-PAGE the page of one property', () => {
  it('names the property and its share under a way back to the list', async () => {
    await open();
    expect(screen.getByRole('link', { name: 'Back to Real estate' })).toHaveAttribute(
      'href',
      '/real-estate',
    );
    expect(screen.getByText('Real estate · 50% yours')).toBeInTheDocument();
  });

  it('shows the estimate, the purchase, the gain and the rent', async () => {
    await open();
    const figures = await screen.findByRole('region', { name: 'Property figures' });
    expect(within(figures).getByText('Your estimate').parentElement).toHaveTextContent(
      'Your estimate$46,000.00Set Aug 1, 2026 · whole property $92,000.00',
    );
    await waitFor(() =>
      expect(within(figures).getByText('Purchase price').parentElement).toHaveTextContent(
        'Purchase price$42,500.00Sep 1, 2025',
      ),
    );
    expect(within(figures).getByText('Gain').parentElement).toHaveTextContent(
      'Gain+$3,500.00+8.24%Estimate minus purchase',
    );
    await waitFor(() =>
      expect(within(figures).getByText('Rent').parentElement).toHaveTextContent(
        'Rent$450.00 /moEntered by you, not part of the value',
      ),
    );
  });

  it('PROPERTY-PAGE says what is missing and does not call it zero', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      valuation([
        { ...flat, costBasis: null, unrealizedPnl: null, unrealizedReturnPercent: null },
      ] as AssetValuation[]),
    );
    vi.spyOn(propertyDetailsApi, 'list').mockResolvedValue([]);
    await open();
    const figures = await screen.findByRole('region', { name: 'Property figures' });
    expect(within(figures).getByText('Purchase price').parentElement).toHaveTextContent(
      'Purchase price—',
    );
    expect(within(figures).getByText('Gain').parentElement).toHaveTextContent(
      'Gain—Estimate minus purchase',
    );
    await waitFor(() =>
      expect(within(figures).getByText('Rent').parentElement).toHaveTextContent('RentNot recorded'),
    );
  });

  it('classes-17 reminds the owner of an estimate over two months old and not of a fresh one', async () => {
    await open();
    const banner = await screen.findByText(/The estimate is from Aug 1, 2026, over two months ago/);
    expect(banner).toHaveTextContent('Prices in your area may have moved.');
    expect(
      within(banner.closest('[role]') as HTMLElement).getByRole('button', {
        name: 'Update estimate',
      }),
    ).toBeInTheDocument();
    cleanup();
    forgetReads();
    vi.setSystemTime(new Date('2026-09-30T20:59:00Z'));
    await open();
    expect(screen.queryByText(/over two months ago/)).toBeNull();
  });

  it('lists the estimates, newest first, in the currency they were entered in', async () => {
    vi.spyOn(manualPricesApi, 'list').mockResolvedValue(
      book([
        receipt(2, '2026-08-01T00:00:00.000Z', '9200000.50', 'RUB'),
        receipt(1, '2025-09-01T00:00:00.000Z', '85000', 'USD'),
      ]),
    );
    await open();
    const card = await screen.findByRole('region', { name: 'Estimates' });
    await waitFor(() => expect(within(card).getAllByRole('listitem')).toHaveLength(2));
    const [latest, first] = within(card).getAllByRole('listitem');
    expect(latest).toHaveTextContent('Aug 1, 2026Your estimate₽9,200,000.50');
    expect(first).toHaveTextContent('Sep 1, 2025Your estimate$85,000.00');
  });

  it('says so when the estimates could not be read, and offers to try again', async () => {
    const list = vi
      .spyOn(manualPricesApi, 'list')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(book([receipt(1, '2025-09-01T00:00:00.000Z', '85000')]));
    const user = userEvent.setup();
    await open();
    const card = await screen.findByRole('region', { name: 'Estimates' });
    expect(await within(card).findByText('Could not load the estimates.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(await within(card).findByText('Sep 1, 2025')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('PROPERTY-ESTIMATE Update estimate saves the value of the whole property as a hand price', async () => {
    const user = userEvent.setup();
    await open();
    const [header] = screen.getAllByRole('button', { name: 'Update estimate' });
    await user.click(header);
    const dialog = screen.getByRole('dialog', { name: 'Update estimate' });
    expect(dialog).toHaveTextContent('counts as market movement, not money put in');
    const field = within(dialog).getByLabelText('Estimate of the whole property, USD');
    await user.click(field);
    await user.tab();
    expect(within(dialog).getByText('Enter an estimate greater than 0')).toBeInTheDocument();
    await user.type(field, '95000');
    await user.click(within(dialog).getByRole('button', { name: 'Save estimate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(savePrice).toHaveBeenCalledWith(id(1), {
      requestId: expect.any(String),
      expectedRevision: 2,
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      price: '95000',
      currency: 'USD',
      assertReviewed: true,
    });
    expect(await screen.findByText('Estimate updated')).toBeInTheDocument();
    // The page reads the portfolio again.
    expect(vi.mocked(portfolioValuationApi.get).mock.calls.length).toBeGreaterThan(1);
  });

  it('PROPERTY-STALE warns and offers a refresh when the values could not be read again after a save', async () => {
    const user = userEvent.setup();
    await open();
    vi.mocked(portfolioValuationApi.get).mockRejectedValue(new Error('offline'));
    const [header] = screen.getAllByRole('button', { name: 'Update estimate' });
    await user.click(header);
    const dialog = screen.getByRole('dialog', { name: 'Update estimate' });
    await user.type(within(dialog).getByLabelText('Estimate of the whole property, USD'), '95000');
    await user.click(within(dialog).getByRole('button', { name: 'Save estimate' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not refresh the values; showing the last loaded ones.');
    expect(within(alert).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('PROPERTY-CHART-SCOPE shows no value chart for a property also held outside property accounts', async () => {
    const mixed = {
      ...flat,
      holdings: [
        { accountId: studio, accountName: 'Studio', quantity: '0.25', value: '23000' },
        { accountId: safe, accountName: 'Home safe', quantity: '0.25', value: '23000' },
      ],
    } as AssetValuation;
    vi.mocked(portfolioValuationApi.get).mockResolvedValue(valuation([mixed, coins]));
    await open();
    expect(
      await screen.findByText(/chart covers every account that holds this property/i),
    ).toBeInTheDocument();
    expect(assetHistoryApi.get).not.toHaveBeenCalled();
  });

  it('PROPERTY-DETAILS Edit saves the rent and the note as typed, trimmed', async () => {
    const user = userEvent.setup();
    const dialog = await openDetails(user);
    expect(dialog).toHaveTextContent('A mortgage or other debt is not subtracted from the value.');
    const rent = within(dialog).getByLabelText('Rent a month, USD');
    const note = within(dialog).getByLabelText('Notes');
    expect(rent).toHaveValue('450.00');
    expect(note).toHaveValue('Mortgage to 2031');
    await user.clear(rent);
    await user.type(rent, '500.5');
    await user.clear(note);
    await user.type(note, '  Tenant until June  ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saveDetails).toHaveBeenCalledWith(id(1), {
      monthlyRent: '500.5',
      note: 'Tenant until June',
    });
    expect(await screen.findByText('Details saved')).toBeInTheDocument();
  });

  it('PROPERTY-DETAILS-UNREAD Edit stays off while the stored details could not be read', async () => {
    // Saving sends the whole record: an unread rent or note must not be overwritten as empty.
    vi.spyOn(propertyDetailsApi, 'list').mockRejectedValue(new Error('offline'));
    await open();
    const card = await screen.findByRole('region', { name: 'Rent and notes' });
    await waitFor(() => expect(propertyDetailsApi.list).toHaveBeenCalled());
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(await within(card).findAllByText('Could not be read')).toHaveLength(2);
  });

  it('PROPERTY-DETAILS empty fields clear the record', async () => {
    const user = userEvent.setup();
    const dialog = await openDetails(user);
    await user.clear(within(dialog).getByLabelText('Rent a month, USD'));
    await user.clear(within(dialog).getByLabelText('Notes'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saveDetails).toHaveBeenCalledWith(id(1), { monthlyRent: null, note: null }),
    );
  });

  it('PROPERTY-DETAILS refuses a rent with more than two decimals and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const dialog = await openDetails(user);
    const rent = within(dialog).getByLabelText('Rent a month, USD');
    await user.clear(rent);
    await user.type(rent, '12.345');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      within(dialog).getByText('Enter a rent of at most two decimals, or leave it empty'),
    ).toBeInTheDocument();
    expect(saveDetails).not.toHaveBeenCalled();
  });

  it('PROPERTY-DETAILS says so when the save fails and keeps what was typed', async () => {
    saveDetails.mockRejectedValue(new AxiosError('offline'));
    const user = userEvent.setup();
    const dialog = await openDetails(user);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not reach the server',
    );
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Mortgage to 2031');
  });

  it('opens the property’s transactions', async () => {
    await open();
    expect(await screen.findByRole('link', { name: 'Open in Transactions' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/transactions\?asset=/),
    );
  });

  it('sends an asset that is no property to its asset page', async () => {
    renderAt(`/real-estate/${id(3)}`);
    expect(await screen.findByText('Asset page')).toBeInTheDocument();
  });

  it('says so for an asset that does not exist', async () => {
    renderAt(`/real-estate/${id(99)}`);
    expect(await screen.findByText('Property not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Real estate' })).toBeInTheDocument();
  });

  it('offers to try again when the portfolio could not be loaded', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(valuation([flat]));
    const user = userEvent.setup();
    renderAt(`/real-estate/${id(1)}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this property.");
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Studio', level: 2 })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
