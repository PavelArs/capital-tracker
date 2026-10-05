import { accountingApi } from '@api/accounting.api';
import { type AssetHistory, assetHistoryApi } from '@api/asset-history.api';
import { manualPricesApi, type PriceReceipt } from '@api/manual-prices.api';
import { type Operation, operationsApi } from '@api/operations.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
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
  priceChange24hPercent: null,
  value: '0',
  allocationPercent: null,
  costBasis: '0',
  knownCostSubtotal: '0',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  averageBuyPrice: null,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  realizedPnl: '0',
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings: [],
  ...changes,
});
const crypto = { assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market' } as const;
// PV-BR11: 1.2 BTC bought for 66000 USD, priced 80000.
const bitcoin = valued(1, 'Bitcoin', 'BTC', crypto, {
  quantity: '1.2',
  price: { value: '80000', observedAt: minutesAgo(30), source: 'kraken', status: 'fresh' },
  missingPrice: null,
  priceChange24hPercent: '-1.40',
  value: '96000',
  allocationPercent: '96.00',
  costBasis: '66000',
  knownCostSubtotal: '66000',
  averageBuyPrice: '55000',
  unrealizedPnl: '30000',
  unrealizedReturnPercent: '45.45',
  holdings: [
    { accountId: id(101), accountName: 'Trust Wallet', quantity: '1', value: '80000' },
    { accountId: id(102), accountName: 'Bybit', quantity: '0.2', value: '16000' },
  ],
});
const cash = valued(
  3,
  'US dollar',
  'USD',
  { assetType: 'fiat', valuationCurrency: 'USD', priceSource: 'fixed' },
  {
    quantity: '4000',
    price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
    missingPrice: null,
    priceChange24hPercent: '0.00',
    value: '4000',
    allocationPercent: '4.00',
    costBasis: '4000',
    averageBuyPrice: '1',
    unrealizedPnl: '0',
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
  { quantity: '100000', missingPrice: 'no-rate', value: null, costBasis: '1200' },
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
    currency: 'USD',
    mainCurrency: 'USD',
    rates: [],
    completeness: 'complete',
    totalValue: '100000',
    pricedSubtotal: '100000',
    missingPriceCount: 0,
    stalePriceCount: 0,
    unavailableAccountCount: 0,
    costBasis: '70000',
    knownCostSubtotal: '70000',
    unknownCostCount: 0,
    missingRateCount: 0,
    unrealizedPnl: '30000',
    unrealizedReturnPercent: '42.86',
    realizedPnl: '-250.5',
    knownRealizedSubtotal: '-250.5',
    unknownRealizedCount: 0,
    assets,
    allocation: {
      complete: true,
      byAsset: [
        { key: bitcoin.instrumentId, label: 'Bitcoin', value: '96000', percent: '96.00' },
        { key: cash.instrumentId, label: 'US dollar', value: '4000', percent: '4.00' },
      ],
      byType: [
        { key: 'crypto', label: 'Crypto', value: '96000', percent: '96.00' },
        { key: 'fiat', label: 'Cash', value: '4000', percent: '4.00' },
      ],
      byAccount: [
        { key: id(101), label: 'Trust Wallet', value: '80000', percent: '80.00' },
        { key: id(102), label: 'Bybit', value: '20000', percent: '20.00' },
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

// One manual account without a journal yet: its first trade starts one (OPS-ADD-BUY).
const createTrade = vi.fn();
const setPrice = vi.fn();
const receiptFor = (quantity: string, grossUsd: string): TradeReceipt =>
  ({
    accountId: id(101),
    journalRevision: 1,
    trade: { quantity, grossUsd, feeUsd: '0', occurredAt: '2026-10-05T10:15:00.000Z' },
  }) as TradeReceipt;
const emptyHistory = (instrumentId: string): AssetHistory => ({
  instrumentId,
  period: '1M',
  currency: 'USD',
  mainCurrency: 'USD',
  from: '2026-09-05T00:00:00.000Z',
  at: '2026-10-05T12:00:00.000Z',
  points: [],
});

beforeEach(() => {
  vi.restoreAllMocks();
  createTrade.mockReset();
  setPrice.mockReset();
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      { id: id(101), name: 'Trust Wallet', currentRevision: 0, createdAt: '2025-01-01T00:00:00Z' },
    ],
    nextCursor: null,
  });
  vi.spyOn(tradesApi, 'state').mockResolvedValue({
    accountId: id(101),
    eligible: true,
    ineligibilityReason: null,
    journal: null,
  } as JournalState);
  createTrade.mockImplementation(async (_account, command) =>
    receiptFor(command.quantity, command.grossUsd ?? '1500'),
  );
  vi.spyOn(tradesApi, 'create').mockImplementation(createTrade);
  setPrice.mockResolvedValue({} as PriceReceipt);
  vi.spyOn(manualPricesApi, 'set').mockImplementation(setPrice);
  vi.spyOn(operationsApi, 'list').mockResolvedValue({
    at: '2026-10-05T12:00:00.000Z',
    quoteCurrency: 'USD',
    needsClassificationCount: 0,
    operations: [],
  });
  vi.spyOn(assetHistoryApi, 'get').mockImplementation(async (instrumentId) =>
    emptyHistory(instrumentId),
  );
});
afterEach(cleanup);

describe('PV-UI Portfolio values every asset', () => {
  it('shows the summary, allocation groupings and valued rows', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([bitcoin, cash, rubles, toncoin], {
        completeness: 'incomplete',
        totalValue: null,
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
      '-1.40%',
    ]);
    expect(cells(rowOf('US dollar'))).toEqual([
      'US dollarUSD · Cash · USD',
      '4,000',
      '$1.00Fixed',
      '$4,000.00',
      '4.00%',
      '$1.00',
      '$0.000.00%',
      '0.00%',
    ]);
    expect(cells(rowOf('Rubles'))).toEqual([
      'RublesRUB · Cash · RUB',
      '100,000',
      'No rateFixed',
      '—',
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
      costBasis: null,
      unknownCostQuantity: '0.2',
      knownCostSubtotal: '50000',
      averageBuyPrice: '50000',
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
    };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([stale], {
        stalePriceCount: 1,
        costBasis: null,
        knownCostSubtotal: '50000',
        unknownCostCount: 1,
        unrealizedPnl: null,
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

  it('names a later-starting account as the gap and shows a dust amount as non-zero', async () => {
    const dust = { ...bitcoin, quantity: '0.000000001', holdings: [] };
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      portfolio([dust], {
        completeness: 'incomplete',
        totalValue: null,
        unavailableAccountCount: 1,
        costBasis: null,
        knownCostSubtotal: '70000',
        unrealizedPnl: null,
        unrealizedReturnPercent: null,
        allocation: { ...portfolio([]).allocation, complete: false },
      }),
    );
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent(
      'Cost basis—$70,000.00 known, an account history starts later',
    );
    expect(summary).not.toHaveTextContent('no purchase price');
    const allocation = screen.getByRole('region', { name: 'Allocation' });
    expect(allocation).toHaveTextContent('Accounts whose history starts later are not included.');
    expect(cells(rowOf('Bitcoin'))[1]).toBe('<0.00000001');
  });

  it('keeps the loaded portfolio when a later refresh fails and ignores a stale reply', async () => {
    let resolveSlow: (value: PortfolioValuation) => void = () => {};
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockResolvedValueOnce(portfolio([bitcoin]))
      .mockImplementationOnce(
        () =>
          new Promise<PortfolioValuation>((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValueOnce(portfolio([bitcoin, cash]))
      .mockRejectedValueOnce(new AxiosError('offline'));
    vi.spyOn(portfolioAssetsApi, 'create').mockResolvedValue(depositAsset);
    const user = userEvent.setup();
    const add = async () => {
      await user.click(screen.getByRole('button', { name: 'Add asset' }));
      const dialog = screen.getByRole('dialog', { name: 'Add asset' });
      await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
      await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
      await user.type(within(dialog).getByLabelText('Ticker'), 'TON');
      await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    // The first refresh hangs; the second answers first, then the late reply arrives.
    await add();
    await add();
    await screen.findByRole('row', { name: /^US dollar/ });
    resolveSlow(portfolio([toncoin]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('row', { name: /^Toncoin/ })).toBeNull();
    expect(rowOf('US dollar')).toBeInTheDocument();

    await add();
    expect(await screen.findByText(/could not refresh/i)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(4);
    expect(rowOf('Bitcoin')).toBeInTheDocument();
    expect(screen.queryByText(/could not load your portfolio/i)).toBeNull();
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
    expect(screen.getByText('No Bank of Russia rate stored to show it in USD')).toBeInTheDocument();
    expect(screen.getByText('Nothing held right now.')).toBeInTheDocument();
    cleanup();
    renderAt(`/portfolio/${id(999)}`);
    expect(await screen.findByRole('heading', { name: 'Asset not found' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe('AST-UI Portfolio lists assets with their classification', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Add asset' }));
    const dialog = screen.getByRole('dialog', { name: 'Add asset' });
    // The wallet list is loaded before a balance can be added.
    await within(dialog).findByLabelText('Wallet or account');
    return dialog;
  };

  it('ADD-ASSET-BALANCE adds a ruble deposit with its value as a deposit and filters by type', async () => {
    let assets = [bitcoin, toncoin];
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async () => portfolio(assets));
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, { ...deposit, quantity: '150000' }];
      return depositAsset;
    });
    createTrade.mockResolvedValue(receiptFor('150000', '1500'));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(cells(rowOf('Toncoin'))[0]).toBe('ToncoinTON · Crypto · USD');
    expect(cells(rowOf('Toncoin'))[2]).toBe('No priceManual');

    const dialog = await openDialog(user);
    expect(within(dialog).getByRole('radiogroup', { name: 'Type' }).textContent).toBe(
      'CashDepositCryptocurrencyOther',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), '  Deposit ');
    await user.type(within(dialog).getByLabelText('Amount'), '150000');
    expect(within(dialog).getByLabelText('Current value')).toHaveAttribute(
      'placeholder',
      'Same as amount',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    expect(within(dialog).getByLabelText('Wallet or account')).toHaveDisplayValue('Trust Wallet');
    await user.type(within(dialog).getByLabelText('Notes (optional)'), 'Savings account');
    expect(within(dialog).getByRole('note')).toHaveTextContent(
      'Adding it counts as a deposit. Later price changes count as market movement.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Deposit',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
    // The balance is a buy of the amount for its value, paid in rubles.
    expect(createTrade).toHaveBeenCalledWith(id(101), {
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedJournalRevision: 0,
      instrumentId: deposit.instrumentId,
      side: 'buy',
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/),
      quantity: '150000',
      comment: 'Savings account',
      paid: { currency: 'RUB', gross: '150000', fee: '0' },
    });
    // A hand-valued asset starts at the USD price its value implies at that moment.
    expect(setPrice).toHaveBeenCalledWith(deposit.instrumentId, {
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedRevision: 0,
      observedAt: '2026-10-05T10:15:00.000Z',
      priceUsd: '0.01',
      assertReviewed: true,
    });
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(cells(rowOf('Deposit')).slice(0, 2)).toEqual(['DepositManual · RUB', '150,000']);

    await user.click(screen.getByRole('button', { name: /^Manual/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(rowOf('Deposit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
  });

  it('adds cash at its amount and a coin at its cost, with no price for either', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const create = vi
      .spyOn(portfolioAssetsApi, 'create')
      .mockResolvedValueOnce({
        ...depositAsset,
        id: cash.instrumentId,
        name: 'Cash at home',
        symbol: 'USD',
        assetType: 'fiat',
        valuationCurrency: 'USD',
        priceSource: 'fixed',
      })
      .mockResolvedValueOnce({
        ...depositAsset,
        id: id(7),
        name: 'Ether',
        symbol: 'ETH',
        assetType: 'crypto',
        valuationCurrency: 'USD',
        priceSource: 'market',
      });
    const user = userEvent.setup();
    renderAt('/portfolio');
    let dialog = await openDialog(user);
    // Cash is worth its amount: no separate value field and no ticker.
    expect(within(dialog).queryByLabelText('Current value')).toBeNull();
    expect(within(dialog).queryByLabelText(/Ticker/)).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Cash at home');
    await user.type(within(dialog).getByLabelText('Amount'), '1 000,50');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Cash at home',
      assetType: 'fiat',
      symbol: 'USD',
    });
    expect(createTrade.mock.calls[0][1]).toMatchObject({
      instrumentId: cash.instrumentId,
      quantity: '1000.50',
      grossUsd: '1000.50',
      feeUsd: '0',
    });

    dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
    expect(within(dialog).getByLabelText('Amount (optional)')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), 'Ether');
    await user.type(within(dialog).getByLabelText('Ticker'), 'eth');
    await user.type(within(dialog).getByLabelText('Amount (optional)'), '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(within(dialog).getByText('Enter what it cost')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'EUR' }));
    await user.type(within(dialog).getByLabelText('Total cost'), '1200');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[1][0]).toMatchObject({ assetType: 'crypto', symbol: 'ETH' });
    expect(createTrade.mock.calls[1][1]).toMatchObject({
      instrumentId: id(7),
      quantity: '0.5',
      paid: { currency: 'EUR', gross: '1200', fee: '0' },
    });
    expect(setPrice).not.toHaveBeenCalled();
  });

  it('asks for the amount and keeps a saved asset when its balance is refused', async () => {
    let assets = [bitcoin];
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async () => portfolio(assets));
    const create = vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, deposit];
      return depositAsset;
    });
    createTrade
      .mockRejectedValueOnce(new AxiosError('offline'))
      .mockRejectedValueOnce(httpError(409))
      .mockResolvedValueOnce(receiptFor('100', '1'));
    setPrice.mockRejectedValueOnce(new AxiosError('offline'));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(within(dialog).getByText('Enter an amount greater than 0')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The asset was added, but its balance was not saved. Could not reach the server; try again.',
    );
    // The saved asset is not asked for again and cannot change.
    expect(within(dialog).getByLabelText('Name')).toBeDisabled();
    // The lost answer may have saved the balance: the retry must repeat the same request.
    for (const label of ['Amount', 'Current value', 'Wallet or account', 'Notes (optional)'])
      expect(within(dialog).getByLabelText(label)).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The account was changed elsewhere; try again.',
    );
    // A refusal saved nothing, so the balance may be corrected again.
    expect(within(dialog).getByLabelText('Amount')).toBeEnabled();
    expect(createTrade.mock.calls[1][1].requestId).toBe(createTrade.mock.calls[0][1].requestId);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The asset and its balance were saved, but its price was not. Try again.',
    );
    // A refused request saved nothing, so the next one has its own id.
    expect(createTrade.mock.calls[2][1].requestId).not.toBe(createTrade.mock.calls[1][1].requestId);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(createTrade).toHaveBeenCalledTimes(3);
    expect(setPrice).toHaveBeenCalledTimes(2);
    expect(setPrice.mock.calls[1][1].requestId).toBe(setPrice.mock.calls[0][1].requestId);
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('closing after a saved asset still shows it, and no account means no balance', async () => {
    let assets = [bitcoin];
    vi.spyOn(portfolioValuationApi, 'get').mockImplementation(async () => portfolio(assets));
    vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(async () => {
      assets = [...assets, deposit];
      return depositAsset;
    });
    createTrade.mockRejectedValue(httpError(500));
    const user = userEvent.setup();
    renderAt('/portfolio');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();

    vi.mocked(accountingApi.listAccounts).mockResolvedValue({ items: [], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Add asset' }));
    const empty = screen.getByRole('dialog', { name: 'Add asset' });
    expect(
      await within(empty).findByText(/To give it a balance, add a wallet or account first/),
    ).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: 'manual accounts' })).toHaveAttribute(
      'href',
      '/manual-accounts',
    );
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
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
    await user.type(within(dialog).getByLabelText('Ticker'), 'TON');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not reach/i);
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/check the fields/i);
    expect(create.mock.calls[1][0].requestId).toBe(create.mock.calls[0][0].requestId);
    await user.type(within(dialog).getByLabelText('Ticker'), 'C');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create.mock.calls[2][0].requestId).not.toBe(create.mock.calls[0][0].requestId);
    expect(createTrade).not.toHaveBeenCalled();
  });

  it('shows a new asset even when a filter or search would hide it', async () => {
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
    await user.type(screen.getByRole('searchbox', { name: 'Search assets' }), 'bit');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Deposit' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Deposit');
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('row', { name: /^Deposit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search assets' })).toHaveValue('');
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
    let dialog = await openDialog(user);
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

    dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Cryptocurrency' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Toncoin');
    await user.type(within(dialog).getByLabelText('Ticker'), 'TON');
    await user.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Add asset' })).toBeInTheDocument();
    finish(depositAsset);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('SEARCH finds assets by name or ticker next to the type filter', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin, cash, toncoin]));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    const search = screen.getByRole('searchbox', { name: 'Search assets' });
    expect(search).toHaveAttribute('placeholder', 'Search assets');
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent?.split(' ')[0]);
    await user.type(search, 'BIT');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(rowOf('Bitcoin')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'usd');
    expect(names()).toHaveLength(1);
    expect(rowOf('US dollar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Crypto/ }));
    expect(screen.getByText('No assets match "usd".')).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
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

describe('ASSET-UI the asset page shows its chart, transactions and daily change', () => {
  const operation = (n: number, changes: Partial<Operation> = {}): Operation => ({
    id: `trade:${id(500 + n)}`,
    kind: 'trade',
    type: 'buy',
    direction: 'in',
    occurredAt: `2026-09-${String(n).padStart(2, '0')}T10:00:00.000Z`,
    asset: { instrumentId: bitcoin.instrumentId, symbol: 'BTC', name: 'Bitcoin' },
    quantity: '0.01',
    counterAsset: null,
    counterQuantity: null,
    valueUsd: '800',
    estimatedValueUsd: null,
    costBasisUsd: null,
    feeUsd: '0',
    fee: null,
    account: { id: id(101), name: 'Trust Wallet' },
    counterAccount: null,
    wallet: null,
    chain: null,
    status: 'recorded',
    source: 'manual',
    version: 1,
    paid: null,
    comment: null,
    orderWithinTimestamp: 0,
    ...changes,
  });
  const point = (at: string, value: string | null, cost: string, quantity = '1') => ({
    at,
    quantity,
    value,
    complete: value !== null,
    cost,
    costComplete: true,
  });

  it('shows the price change today, the value against cost chart and its periods', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      operations: [operation(20, { quantity: '0.2', occurredAt: '2026-09-20T09:00:00.000Z' })],
    });
    const history = vi
      .mocked(assetHistoryApi.get)
      .mockImplementation(async (instrumentId, period) => ({
        ...emptyHistory(instrumentId),
        period,
        points: [
          point('2026-09-19T00:00:00.000Z', '50000', '50000'),
          point('2026-09-20T00:00:00.000Z', '52000', '50000'),
          point('2026-09-21T00:00:00.000Z', '62400', '66000', '1.2'),
          point('2026-10-05T12:00:00.000Z', '96000', '66000', '1.2'),
        ],
      }));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    expect(await screen.findByText('today')).toHaveTextContent('-1.40% today');
    const chart = await screen.findByRole('region', { name: 'Position value over time' });
    expect(within(chart).getByLabelText('Chart legend')).toHaveTextContent(
      'Position valueCost basisPurchase',
    );
    expect(
      within(chart).getByRole('img', {
        name: 'Bitcoin position value and cost basis, past month, in USD',
      }),
    ).toBeInTheDocument();
    expect(history).toHaveBeenLastCalledWith(bitcoin.instrumentId, '1M', undefined);
    // The buy on 20 September 09:00 is drawn on the first point after it.
    expect(chart.querySelectorAll('.dashboard-chart__deposit')).toHaveLength(1);
    await user.click(within(chart).getByRole('tab', { name: '7D' }));
    expect(within(chart).getByRole('tab', { name: '7D' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(history).toHaveBeenLastCalledWith(bitcoin.instrumentId, '7D', undefined),
    );
    expect(
      await within(chart).findByRole('img', {
        name: 'Bitcoin position value and cost basis, past 7 days, in USD',
      }),
    ).toBeInTheDocument();
  });

  it('keeps the chosen period when an earlier period answers later', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    let answerMonth: (history: AssetHistory) => void = () => undefined;
    vi.mocked(assetHistoryApi.get)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerMonth = resolve;
          }),
      )
      .mockImplementationOnce(async (instrumentId, period) => ({
        ...emptyHistory(instrumentId),
        period,
        points: [point('2026-10-05T12:00:00.000Z', '96000', '66000', '1.2')],
      }));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const chart = await screen.findByRole('region', { name: 'Position value over time' });
    await user.click(within(chart).getByRole('tab', { name: '7D' }));
    const week = await within(chart).findByRole('img', {
      name: 'Bitcoin position value and cost basis, past 7 days, in USD',
    });
    answerMonth({
      ...emptyHistory(bitcoin.instrumentId),
      period: '1M',
      points: [point('2026-10-05T12:00:00.000Z', null, '66000', '1.2')],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(week).toBeInTheDocument();
    expect(within(chart).queryByText(/No value can be shown/)).toBeNull();
  });

  it('lists the latest ten operations of the asset and links to all of them', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    const buys = Array.from({ length: 11 }, (_, index) => operation(index + 1));
    const unclassified = operation(28, {
      id: 'chain:abc',
      kind: 'chain',
      type: null,
      asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
      quantity: '0.0087',
      valueUsd: null,
      account: null,
      wallet: { id: id(301), network: 'bitcoin', address: 'bc1qsyntheticaddress000000000000' },
      status: 'needs-classification',
      source: 'chain',
    });
    const ether = operation(29, {
      asset: { instrumentId: id(9), symbol: 'ETH', name: 'Ethereum' },
    });
    vi.mocked(operationsApi.list).mockResolvedValue({
      at: '2026-10-05T12:00:00.000Z',
      quoteCurrency: 'USD',
      needsClassificationCount: 1,
      operations: [...buys, unclassified, ether],
    });
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const card = await screen.findByRole('region', { name: 'Transactions' });
    const rows = await within(card).findAllByRole('listitem');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent(
      'Needs classificationSep 28, 2026 · Bitcoin wallet bc1qsy…0000+0.0087 BTC',
    );
    expect(rows[1]).toHaveTextContent('BuySep 11, 2026 · Trust Wallet+0.01 BTC$800.00');
    expect(card).toHaveTextContent('12');
    expect(within(card).getByRole('link', { name: 'Show all 12' })).toHaveAttribute(
      'href',
      '/transactions?asset=BTC',
    );
  });

  it('reports a chart or transactions failure and recovers on retry', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio([bitcoin]));
    vi.mocked(operationsApi.list)
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue({
        at: '2026-10-05T12:00:00.000Z',
        quoteCurrency: 'USD',
        needsClassificationCount: 0,
        operations: [operation(3)],
      });
    vi.mocked(assetHistoryApi.get).mockRejectedValueOnce(httpError(500));
    const user = userEvent.setup();
    renderAt(`/portfolio/${bitcoin.instrumentId}`);
    const card = await screen.findByRole('region', { name: 'Transactions' });
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      "Could not load this asset's transactions.",
    );
    await user.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(
      await within(card).findByRole('link', { name: 'Open in Transactions' }),
    ).toBeInTheDocument();
    const chart = screen.getByRole('region', { name: 'Position value over time' });
    expect(await within(chart).findByRole('alert')).toHaveTextContent('Could not load the chart.');
    await user.click(within(chart).getByRole('button', { name: 'Try again' }));
    expect(
      await within(chart).findByText('No value can be shown for this period in USD.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Holdings' })).not.toHaveTextContent('not built');
  });
});

describe('CUR-UI values in the main currency with a switch to the other two', () => {
  // CUR-SWITCH: 1000 USD at 0.92 EUR per USD (92 and 100 RUB per unit).
  const eurBitcoin = {
    ...bitcoin,
    price: { ...bitcoin.price!, value: '920' },
    value: '920',
    allocationPercent: '100.00',
    costBasis: '828',
    knownCostSubtotal: '828',
    averageBuyPrice: '828',
    unrealizedPnl: '92',
    unrealizedReturnPercent: '11.11',
    holdings: [{ accountId: id(101), accountName: 'Trust Wallet', quantity: '1', value: '920' }],
  };
  const inEur = portfolio([{ ...eurBitcoin, quantity: '1' }], {
    currency: 'EUR',
    mainCurrency: 'EUR',
    rates: [
      { currency: 'USD', date: '2026-10-01', rubPerUnit: '92' },
      { currency: 'EUR', date: '2026-10-01', rubPerUnit: '100' },
    ],
    totalValue: '920',
    pricedSubtotal: '920',
    costBasis: '828',
    knownCostSubtotal: '828',
    unrealizedPnl: '92',
    unrealizedReturnPercent: '11.11',
    realizedPnl: '0',
    knownRealizedSubtotal: '0',
    allocation: {
      complete: true,
      byAsset: [{ key: bitcoin.instrumentId, label: 'Bitcoin', value: '920', percent: '100.00' }],
      byType: [{ key: 'crypto', label: 'Crypto', value: '920', percent: '100.00' }],
      byAccount: [{ key: id(101), label: 'Trust Wallet', value: '920', percent: '100.00' }],
    },
  });

  it('CUR-SWITCH: shows the main currency first and switches to RUB on request', async () => {
    const inRub = portfolio([], {
      ...inEur,
      currency: 'RUB',
      totalValue: null,
      completeness: 'incomplete',
      rates: [],
      assets: [
        {
          ...eurBitcoin,
          quantity: '1',
          price: null,
          missingPrice: 'no-rate',
          value: null,
          costBasis: null,
          knownCostSubtotal: '0',
          missingRateQuantity: '1',
          averageBuyPrice: null,
          unrealizedPnl: null,
          unrealizedReturnPercent: null,
          allocationPercent: null,
          holdings: [
            { accountId: id(101), accountName: 'Trust Wallet', quantity: '1', value: null },
          ],
        },
      ],
      pricedSubtotal: '0',
      missingPriceCount: 1,
      costBasis: null,
      knownCostSubtotal: '0',
      missingRateCount: 1,
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
      allocation: { complete: false, byAsset: [], byType: [], byAccount: [] },
    });
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async (currency) => (currency === 'RUB' ? inRub : inEur));
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    expect(get).toHaveBeenLastCalledWith(undefined);
    const switcher = screen.getByRole('radiogroup', { name: 'Currency' });
    expect(within(switcher).getByRole('radio', { name: 'EUR' })).toBeChecked();
    const summary = screen.getByRole('region', { name: 'Portfolio summary' });
    expect(summary).toHaveTextContent('Current value€920.00');
    expect(summary).toHaveTextContent('Cost basis€828.00');
    expect(summary).toHaveTextContent('Unrealized P&L+€92.00+11.11%');
    expect(cells(rowOf('Bitcoin')).slice(2, 7)).toEqual([
      '€920.00Market price · 30 min ago',
      '€920.00',
      '100.00%',
      '€828.00',
      '+€92.00+11.11%',
    ]);
    expect(
      screen.getByText(
        /Bank of Russia rates: 1 USD = 92\.00 RUB \(Oct 1, 2026\), 1 EUR = 100\.00 RUB/,
      ),
    ).toBeInTheDocument();

    await user.click(within(switcher).getByRole('radio', { name: 'RUB' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('RUB'));
    await screen.findByText(/No Bank of Russia rate is stored yet, so values in RUB/);
    expect(cells(rowOf('Bitcoin')).slice(2, 7)).toEqual([
      'No rateMarket price',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(screen.getByRole('region', { name: 'Portfolio summary' })).toHaveTextContent(
      'Cost basis—₽0.00 known, part predates the stored rates',
    );
    expect(
      screen.getByText(/1 asset has operations dated before the stored Bank of Russia rates/),
    ).toBeInTheDocument();
    // The asset page keeps the switched currency.
    expect(within(rowOf('Bitcoin')).getByRole('link', { name: 'Bitcoin' })).toHaveAttribute(
      'href',
      `/portfolio/${bitcoin.instrumentId}?currency=RUB`,
    );
  });

  it('marks the chosen currency at once while its values load', async () => {
    let answer: (value: PortfolioValuation) => void = () => {};
    const get = vi.spyOn(portfolioValuationApi, 'get').mockImplementation((currency) =>
      currency === 'RUB'
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(inEur),
    );
    const user = userEvent.setup();
    renderAt('/portfolio');
    await screen.findByRole('row', { name: /^Bitcoin/ });
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    );
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('RUB'));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    ).toBeChecked();
    answer({ ...inEur, currency: 'RUB' });
    await screen.findByRole('row', { name: /^Bitcoin/ });

    cleanup();
    let assetAnswer: (value: PortfolioValuation) => void = () => {};
    get.mockImplementation((currency) =>
      currency === 'RUB'
        ? new Promise((resolve) => {
            assetAnswer = resolve;
          })
        : Promise.resolve(inEur),
    );
    renderAt(`/portfolio/${bitcoin.instrumentId}?currency=EUR`);
    await screen.findByRole('region', { name: 'Position' });
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    );
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('RUB'));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', {
        name: 'RUB',
      }),
    ).toBeChecked();
    assetAnswer({ ...inEur, currency: 'RUB' });
    await screen.findByRole('region', { name: 'Position' });
  });

  it('shows one asset in the asked currency', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(inEur);
    renderAt(`/portfolio/${bitcoin.instrumentId}?currency=EUR`);
    const position = await screen.findByRole('region', { name: 'Position' });
    expect(get).toHaveBeenCalledWith('EUR');
    expect(position).toHaveTextContent('Current value€920.00');
    expect(position).toHaveTextContent('Cost basis€828.00');
    expect(screen.getByRole('link', { name: '← Portfolio' })).toHaveAttribute(
      'href',
      '/portfolio?currency=EUR',
    );
    expect(screen.getByRole('region', { name: 'Holdings' })).toHaveTextContent('€920.00');
  });
});
