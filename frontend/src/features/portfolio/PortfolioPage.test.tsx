import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PortfolioPage from './PortfolioPage';

const asset = (
  id: number,
  name: string,
  symbol: string | null,
  assetType: PortfolioAsset['assetType'],
  valuationCurrency: PortfolioAsset['valuationCurrency'],
  priceSource: PortfolioAsset['priceSource'],
): PortfolioAsset => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  name,
  symbol,
  namespace: 'manual',
  assetType,
  valuationCurrency,
  priceSource,
  createdAt: '2026-10-04T12:00:00.000Z',
});
const bitcoin = asset(1, 'Bitcoin', 'BTC', 'crypto', 'USD', 'market');
const toncoin = asset(2, 'Toncoin', 'TON', 'crypto', 'USD', 'manual');
const rubles = asset(3, 'Rubles', 'RUB', 'fiat', 'RUB', 'fixed');
const deposit = asset(4, 'Deposit', null, 'manual', 'RUB', 'manual');

function renderPage() {
  return render(
    <MemoryRouter>
      <PortfolioPage />
    </MemoryRouter>,
  );
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

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

describe('AST-UI Portfolio lists assets with their classification', () => {
  it('loads every page, sorts by name and shows type, value currency and price source', async () => {
    const listPage = vi
      .spyOn(portfolioAssetsApi, 'listPage')
      .mockResolvedValueOnce({ items: [toncoin, rubles], nextCursor: rubles.id })
      .mockResolvedValueOnce({ items: [bitcoin], nextCursor: null });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();
    expect(listPage.mock.calls).toEqual([[undefined], [rubles.id]]);
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(names).toEqual(['BitcoinBTC', 'RublesRUB', 'ToncoinTON']);
    expect(cells(rowOf('Bitcoin'))).toEqual(['BitcoinBTC', 'Crypto', 'USD', 'Market price']);
    expect(cells(rowOf('Toncoin'))).toEqual(['ToncoinTON', 'Crypto', 'USD', 'Manual']);
    expect(cells(rowOf('Rubles'))).toEqual(['RublesRUB', 'Cash', 'RUB', 'Fixed']);
    expect(screen.getByText(/quantities, prices and values/i)).toBeInTheDocument();
    expect(screen.queryByText(/not built yet/i)).toBeNull();
  });

  it('adds a manual deposit in rubles and filters by type', async () => {
    vi.spyOn(portfolioAssetsApi, 'listPage').mockResolvedValue({
      items: [bitcoin, toncoin],
      nextCursor: null,
    });
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockResolvedValue(deposit);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('row', { name: /^Bitcoin/ });

    await user.click(screen.getByRole('button', { name: 'Add asset' }));
    const dialog = screen.getByRole('dialog', { name: 'Add asset' });
    await user.click(within(dialog).getByRole('radio', { name: 'Manual' }));
    await user.type(within(dialog).getByLabelText('Name'), '  Deposit ');
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Deposit',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
    expect(cells(rowOf('Deposit'))).toEqual(['Deposit', 'Manual', 'RUB', 'Manual']);

    await user.click(screen.getByRole('button', { name: /^Manual/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(rowOf('Deposit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
  });

  it('sends cash with its currency as ticker and crypto with a required ticker', async () => {
    vi.spyOn(portfolioAssetsApi, 'listPage').mockResolvedValue({ items: [], nextCursor: null });
    const create = vi
      .spyOn(portfolioAssetsApi, 'create')
      .mockResolvedValueOnce(rubles)
      .mockResolvedValueOnce(toncoin);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add asset' }));
    let dialog = screen.getByRole('dialog', { name: 'Add asset' });
    await user.click(within(dialog).getByRole('radio', { name: 'Cash' }));
    expect(within(dialog).queryByLabelText(/ticker/i)).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Rubles');
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Rubles',
      symbol: 'RUB',
      assetType: 'fiat',
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty('valuationCurrency');

    await user.click(screen.getAllByRole('button', { name: 'Add asset' })[0]);
    dialog = screen.getByRole('dialog', { name: 'Add asset' });
    await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(within(dialog).getByText('Enter a ticker')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    await user.type(within(dialog).getByLabelText('Ticker'), ' ton ');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[1][0]).toMatchObject({
      name: 'Toncoin',
      symbol: 'TON',
      assetType: 'crypto',
    });
  });

  it('keeps the dialog and request id on a refusal, then retries the same request', async () => {
    vi.spyOn(portfolioAssetsApi, 'listPage').mockResolvedValue({ items: [], nextCursor: null });
    const create = vi
      .spyOn(portfolioAssetsApi, 'create')
      .mockRejectedValueOnce(new AxiosError('offline'))
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce(deposit);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add asset' }));
    const dialog = screen.getByRole('dialog', { name: 'Add asset' });
    await user.click(within(dialog).getByRole('radio', { name: 'Manual' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not reach/i);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/check the fields/i);
    expect(create.mock.calls[1][0].requestId).toBe(create.mock.calls[0][0].requestId);
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[2][0].requestId).not.toBe(create.mock.calls[0][0].requestId);
  });

  it('shows the empty, loading and error states honestly', async () => {
    let fail = true;
    vi.spyOn(portfolioAssetsApi, 'listPage').mockImplementation(async () => {
      if (fail) throw httpError(500);
      return { items: [], nextCursor: null };
    });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent(/loading assets/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your assets/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No assets yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add asset' }).length).toBeGreaterThan(0);
  });
});
