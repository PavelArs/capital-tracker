import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetPage from './AssetPage';
import PortfolioPage from './PortfolioPage';

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
  valueUsd: '0',
  allocationPercent: null,
  costBasisUsd: '0',
  knownCostSubtotalUsd: '0',
  unknownCostQuantity: '0',
  averageBuyPriceUsd: null,
  unrealizedPnlUsd: null,
  unrealizedReturnPercent: null,
  realizedPnlUsd: '0',
  knownRealizedSubtotalUsd: '0',
  unknownRealizedCount: 0,
  holdings: [],
  ...changes,
});
const crypto = { assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market' } as const;
// PV-BR11: 1.2 BTC bought for 66000 USD, priced 80000.
const bitcoin = valued(1, 'Bitcoin', 'BTC', crypto, {
  quantity: '1.2',
  price: { priceUsd: '80000', observedAt: minutesAgo(30), source: 'kraken', status: 'fresh' },
  missingPrice: null,
  valueUsd: '96000',
  allocationPercent: '96.00',
  costBasisUsd: '66000',
  knownCostSubtotalUsd: '66000',
  averageBuyPriceUsd: '55000',
  unrealizedPnlUsd: '30000',
  unrealizedReturnPercent: '45.45',
  holdings: [
    { accountId: id(101), accountName: 'Trust Wallet', quantity: '1', valueUsd: '80000' },
    { accountId: id(102), accountName: 'Bybit', quantity: '0.2', valueUsd: '16000' },
  ],
});
const cash = valued(
  3,
  'US dollar',
  'USD',
  { assetType: 'fiat', valuationCurrency: 'USD', priceSource: 'fixed' },
  {
    quantity: '4000',
    price: { priceUsd: '1', observedAt: null, source: 'fixed', status: 'fixed' },
    missingPrice: null,
    valueUsd: '4000',
    allocationPercent: '4.00',
    costBasisUsd: '4000',
    averageBuyPriceUsd: '1',
    unrealizedPnlUsd: '0',
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
  { quantity: '100000', missingPrice: 'no-rate', valueUsd: null, costBasisUsd: '1200' },
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
    quoteCurrency: 'USD',
    completeness: 'complete',
    totalValueUsd: '100000',
    pricedSubtotalUsd: '100000',
    missingPriceCount: 0,
    stalePriceCount: 0,
    unavailableAccountCount: 0,
    costBasisUsd: '70000',
    knownCostSubtotalUsd: '70000',
    unknownCostCount: 0,
    unrealizedPnlUsd: '30000',
    unrealizedReturnPercent: '42.86',
    realizedPnlUsd: '-250.5',
    knownRealizedSubtotalUsd: '-250.5',
    unknownRealizedCount: 0,
    assets,
    allocation: {
      complete: true,
      byAsset: [
        { key: bitcoin.instrumentId, label: 'Bitcoin', valueUsd: '96000', percent: '96.00' },
        { key: cash.instrumentId, label: 'US dollar', valueUsd: '4000', percent: '4.00' },
      ],
      byType: [
        { key: 'crypto', label: 'Crypto', valueUsd: '96000', percent: '96.00' },
        { key: 'fiat', label: 'Cash', valueUsd: '4000', percent: '4.00' },
      ],
      byAccount: [
        { key: id(101), label: 'Trust Wallet', valueUsd: '80000', percent: '80.00' },
        { key: id(102), label: 'Bybit', valueUsd: '20000', percent: '20.00' },
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

describe('PV-UI Portfolio values every asset', () => {
  it('shows the summary, allocation groupings and valued rows', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin, cash, rubles, toncoin], {
        completeness: 'incomplete',
        totalValueUsd: null,
        missingPriceCount: 1,
        allocation: { ...portfolio([]).allocation, complete: false },
      }),
    );
    const user = userEvent.setup();
    renderAt('/portfolio');
    expect(screen.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading portfolio/i);
    expect(await screen.findByRole('row', { name: /^Bitcoin/ })).toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent(
      'Current valueIncomplete$100,000.00 priced, 1 asset without a price',
    );
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
    ]);
    expect(cells(rowOf('US dollar'))).toEqual([
      'US dollarUSD · Cash · USD',
      '4,000',
      '$1.00Fixed',
      '$4,000.00',
      '4.00%',
      '$1.00',
      '$0.000.00%',
    ]);
    expect(cells(rowOf('Rubles'))).toEqual([
      'RublesRUB · Cash · RUB',
      '100,000',
      'No rateFixed',
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
    ]);
    expect(within(rowOf('Bitcoin')).getByRole('link', { name: 'Bitcoin' })).toHaveAttribute(
      'href',
      `/portfolio/${bitcoin.instrumentId}`,
    );

    const allocation = screen.getByRole('region', { name: 'Allocation' });
    const grouping = within(allocation).getByRole('radiogroup', { name: 'Group allocation by' });
    const slices = () =>
      within(allocation)
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    expect(slices()).toEqual(['Bitcoin$96,000.0096.00%', 'US dollar$4,000.004.00%']);
    await user.click(within(grouping).getByRole('radio', { name: 'Type' }));
    expect(slices()).toEqual(['Crypto$96,000.0096.00%', 'Cash$4,000.004.00%']);
    await user.click(within(grouping).getByRole('radio', { name: 'Account' }));
    expect(slices()).toEqual(['Trust Wallet$80,000.0080.00%', 'Bybit$20,000.0020.00%']);
    expect(allocation).toHaveTextContent('Assets without a price are not included.');
  });

  it('marks stale prices and unknown cost honestly', async () => {
    const stale = {
      ...bitcoin,
      price: { ...bitcoin.price!, observedAt: minutesAgo(180), status: 'stale' as const },
      costBasisUsd: null,
      unknownCostQuantity: '0.2',
      knownCostSubtotalUsd: '50000',
      averageBuyPriceUsd: '50000',
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
    };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([stale], {
        stalePriceCount: 1,
        costBasisUsd: null,
        knownCostSubtotalUsd: '50000',
        unknownCostCount: 1,
        unrealizedPnlUsd: null,
        unrealizedReturnPercent: null,
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(cells(rowOf('Bitcoin'))[2]).toBe('$80,000.00Market price · stale, 3 h ago');
    expect(cells(rowOf('Bitcoin'))[6]).toBe('—');
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent('Cost basis—$50,000.00 known, part has no purchase price');
    expect(summary).toHaveTextContent('Unrealized P&L—');
    expect(within(summary).getByRole('note')).toHaveTextContent(
      '1 price is older than 2 hours; the last stored price is used.',
    );
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
      `/manual-accounts/${id(101)}`,
    );
    await user.click(screen.getByRole('link', { name: '← Portfolio' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Portfolio' })).toBeInTheDocument();
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
    expect(screen.getByText('Rates for EUR and RUB are not collected yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing held right now.')).toBeInTheDocument();
    cleanup();
    renderAt(`/portfolio/${id(999)}`);
    expect(await screen.findByRole('heading', { name: 'Asset not found' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe('AST-UI Portfolio lists assets with their classification', () => {
  it('adds a manual deposit in rubles and filters by type', async () => {
    let assets = [bitcoin, toncoin];
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async () => portfolio(assets));
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, deposit];
      return depositAsset;
    });
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(cells(rowOf('Toncoin'))[0]).toBe('ToncoinTON · Crypto · USD');
    expect(cells(rowOf('Toncoin'))[2]).toBe('No priceManual');

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
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(cells(rowOf('Deposit')).slice(0, 3)).toEqual([
      'DepositManual · RUB',
      '0',
      'No priceManual',
    ]);

    await user.click(screen.getByRole('button', { name: /^Manual/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(rowOf('Deposit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
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

  it('shows a new asset even when a filter would hide it', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Add asset' }));
    const dialog = screen.getByRole('dialog', { name: 'Add asset' });
    await user.click(within(dialog).getByRole('radio', { name: 'Manual' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
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
    const opener = screen.getByRole('button', { name: 'Add asset' });
    await user.click(opener);
    let dialog = screen.getByRole('dialog', { name: 'Add asset' });
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

    await user.click(opener);
    dialog = screen.getByRole('dialog', { name: 'Add asset' });
    await user.click(within(dialog).getByRole('radio', { name: 'Manual' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Add asset' })).toBeInTheDocument();
    finish(depositAsset);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the empty, loading and error states honestly', async () => {
    let fail = true;
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => {
      if (fail) throw httpError(500);
      return portfolio([]);
    });
    const user = userEvent.setup();
    renderAt('/portfolio');
    expect(screen.getByRole('status')).toHaveTextContent(/loading portfolio/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your portfolio/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No assets yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add asset' }).length).toBeGreaterThan(0);
  });
});
