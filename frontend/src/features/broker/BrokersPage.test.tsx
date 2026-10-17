import { type AccountSummary, accountingApi } from '@api/accounting.api';
import { brokersApi } from '@api/brokers.api';
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
const account = (
  accountId: string,
  name: string,
  assetClass: AccountSummary['assetClass'],
  connection: AccountSummary['connection'] = null,
): AccountSummary => ({
  id: accountId,
  name,
  kind: null,
  assetClass,
  connection,
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

const tbankMain = id(21);
const tbankNew = id(22);
const tbankIis = id(23);
const waiting = { provider: 'tbank' as const, imported: false };
const imported = { provider: 'tbank' as const, imported: true };
// Two T-Bank accounts read with a token: one imported with positions, one waits for its import.
const withTBank = () => {
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      account(broker, 'Sample Broker', 'broker'),
      account(iis, 'Sample Broker · IIS', 'broker'),
      account(tbankMain, 'Main broker', 'broker', imported),
      account(tbankNew, 'T-Bank Brokerage', 'broker', waiting),
      account(wallet, 'Home safe', null),
    ],
    nextCursor: null,
  });
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
    valuation([
      ...held,
      asset(
        7,
        'SBER',
        [{ accountId: tbankMain, accountName: 'Main broker', quantity: '100', value: '300' }],
        { price: priced('3', '2026-10-01T09:00:00.000Z') },
      ),
    ]),
  );
};

describe('BROKERS the Brokers page', () => {
  it('BROKERS-GROUP shows one card per broker, with each account, its positions and then its cash', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(screen.getAllByRole('region', { name: /Sample Broker/ })).toHaveLength(1);
    expect(within(sample).getByText('2 accounts · tracked manually')).toBeInTheDocument();
    const regular = within(sample).getByRole('group', { name: 'Sample Broker' });
    const rows = within(regular).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      `/portfolio/${id(1)}`,
      `/portfolio/${id(2)}`,
      `/portfolio/${id(3)}`,
    ]);
    expect(rows[0]).toHaveTextContent('VWRA30 × $142.10$4,263.00Price of Oct 1, 2026');
    expect(rows[1]).toHaveTextContent('Bond fund 20304 × ——No price yet');
    expect(rows[2]).toHaveTextContent('Cash, USD250$250.00');
    const other = within(sample).getByRole('group', { name: 'IIS' });
    // Codex P2: a stored price without an exchange rate is not a missing price.
    expect(within(other).getAllByRole('link')[1]).toHaveTextContent('Euro bond fund3 × ——No rate');
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent(
      'At brokers$5,934.001 broker · 2 accountsShare of net worth14.8%1 position without a price left out. 1 position without an exchange rate left out.',
    );
    expect(screen.queryByText('Gold coins')).toBeNull();
  });

  it('BROKERS-GROUP keeps the broker total and its flags, and each account its subtotal', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(within(sample).getByTestId('broker-total')).toHaveTextContent(
      '$5,934.001 position without a price left out. 1 position without an exchange rate left out.',
    );
    expect(
      within(within(sample).getByRole('group', { name: 'Sample Broker' })).getByTestId(
        'account-total',
      ),
    ).toHaveTextContent('$4,513.001 position without a price left out.');
    expect(
      within(within(sample).getByRole('group', { name: 'IIS' })).getByTestId('account-total'),
    ).toHaveTextContent('$1,421.001 position without an exchange rate left out.');
  });

  it('BROKERS-GROUP joins manual accounts by the broker name typed, ignoring case and spaces', async () => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        account(broker, 'Sample Broker', 'broker'),
        account(iis, 'sample broker · IIS', 'broker'),
        account(id(14), 'Other Broker', 'broker'),
      ],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const sample = await screen.findByRole('region', { name: 'Sample Broker' });
    expect(
      within(sample)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Sample Broker', 'IIS']);
    const other = screen.getByRole('region', { name: 'Other Broker' });
    expect(within(other).getByText('1 account · tracked manually')).toBeInTheDocument();
    expect(within(other).getByText('Holds nothing yet.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent(
      '2 brokers · 3 accounts',
    );
  });

  it('BROKERS-GROUP puts a lone "<broker> · IIS" under <broker> as its IIS', async () => {
    // Codex P1: the dialog names an IIS "<broker> · IIS", and no account type is stored apart from
    // the name, so a lone IIS still belongs to its broker.
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(id(14), 'Other Broker · IIS', 'broker')],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const other = await screen.findByRole('region', { name: 'Other Broker' });
    expect(
      within(other)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['IIS']);
    expect(screen.queryByRole('region', { name: 'Other Broker · IIS' })).toBeNull();
  });

  it('BROKERS-GROUP puts every T-Bank account read with a token under one T-Bank card', async () => {
    withTBank();
    renderPage();
    const tbank = await screen.findByRole('region', { name: 'T-Bank' });
    expect(within(tbank).getByText('2 accounts · synced via token')).toBeInTheDocument();
    const main = within(tbank).getByRole('group', { name: 'Main broker' });
    expect(within(main).getByTestId('account-total')).toHaveTextContent('$300.00');
    expect(within(main).getByRole('link')).toHaveTextContent('SBER100 × $3.00$300.00');
    // An account whose history is not imported yet is worth "—", not zero, and says why.
    const waiting = within(tbank).getByRole('group', { name: 'Brokerage' });
    expect(within(waiting).getByTestId('account-total')).toHaveTextContent(/^—$/);
    expect(waiting).toHaveTextContent(
      'Connected. Positions and cash arrive with the history import.',
    );
    expect(within(tbank).getByTestId('broker-total')).toHaveTextContent(
      '$300.001 account waiting for the history import.',
    );
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent(
      'At brokers$6,234.002 brokers · 4 accounts',
    );
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent(
      '1 account waiting for the history import.',
    );
  });

  it('BROKERS-GROUP does not call an imported account that holds nothing "waiting"', async () => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(tbankIis, 'T-Bank IIS', 'broker', imported)],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const tbank = await screen.findByRole('region', { name: 'T-Bank' });
    const iisGroup = within(tbank).getByRole('group', { name: 'IIS' });
    expect(iisGroup).toHaveTextContent('Holds nothing yet.');
    expect(iisGroup).not.toHaveTextContent('history import');
    expect(within(tbank).getByTestId('broker-total')).toHaveTextContent(/^\$0\.00$/);
  });

  it('BROKERS-GROUP keeps a connected account with hand-entered positions waiting for its history', async () => {
    // Codex P1: what an account already holds does not mean its T-Bank history was imported.
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(tbankMain, 'Main broker', 'broker', waiting)],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(
      valuation([
        asset(
          7,
          'SBER',
          [{ accountId: tbankMain, accountName: 'Main broker', quantity: '100', value: '300' }],
          { price: priced('3', '2026-10-01T09:00:00.000Z') },
        ),
      ]),
    );
    renderPage();
    const tbank = await screen.findByRole('region', { name: 'T-Bank' });
    const main = within(tbank).getByRole('group', { name: 'Main broker' });
    expect(main).toHaveTextContent('Connected. The T-Bank history is not imported yet.');
    expect(within(main).getByRole('link')).toHaveTextContent('SBER100 × $3.00$300.00');
    expect(within(tbank).getByTestId('broker-total')).toHaveTextContent(
      '$300.001 account waiting for the history import.',
    );
    expect(screen.getByRole('region', { name: 'Total at brokers' })).toHaveTextContent(
      '1 account waiting for the history import.',
    );
  });

  it('BROKERS-GROUP shows "—", never zero, while nothing at a broker is valued yet', async () => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        account(tbankNew, 'T-Bank Brokerage', 'broker', waiting),
        account(tbankIis, 'T-Bank IIS', 'broker', waiting),
      ],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation(held));
    renderPage();
    const tbank = await screen.findByRole('region', { name: 'T-Bank' });
    expect(within(tbank).getByTestId('broker-total')).toHaveTextContent(
      /^—Waiting for the history import$/,
    );
    const summary = screen.getByRole('region', { name: 'Total at brokers' });
    expect(summary).toHaveTextContent('At brokers—1 broker · 2 accountsShare of net worth—');
    expect(summary).not.toHaveTextContent('$0.00');
    expect(summary).not.toHaveTextContent('0%');
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

  it('BROKER-ADD-FLOW opens the one Add broker account dialog from the empty page', async () => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [account(wallet, 'Home safe', null)],
      nextCursor: null,
    });
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation([held[3]]));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('No broker account yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect T-Bank/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add broker account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add broker account' });
    expect(within(dialog).getByRole('button', { name: /^T-Bank/ })).toBeInTheDocument();
  });

  it('BROKER-ADD-FLOW opens the same dialog from the page, and focuses a newly connected account', async () => {
    withTBank();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: 'T-Bank' });
    expect(screen.queryByRole('button', { name: /Connect T-Bank/ })).toBeNull();
    vi.spyOn(brokersApi, 'tbankAccounts').mockResolvedValue([
      { id: '2000000009', name: 'IIS', investBox: false, connected: false },
    ]);
    vi.spyOn(brokersApi, 'connectTBank').mockResolvedValue([
      { accountId: tbankIis, name: 'T-Bank IIS', brokerAccountId: '2000000009', created: true },
    ]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        account(broker, 'Sample Broker', 'broker'),
        account(tbankMain, 'Main broker', 'broker', imported),
        account(tbankNew, 'T-Bank Brokerage', 'broker', waiting),
        account(tbankIis, 'T-Bank IIS', 'broker', waiting),
      ],
      nextCursor: null,
    });
    await user.click(screen.getByRole('button', { name: 'Add broker account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add broker account' });
    await user.click(within(dialog).getByRole('button', { name: /^T-Bank/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText('T-Bank token'), 'ts.SYNTHETIC-token_0123456789');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Connect 1 account' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const tbank = await screen.findByRole('region', { name: 'T-Bank' });
    expect(within(tbank).getByText('3 accounts · synced via token')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(within(tbank).getByRole('group', { name: 'IIS' })),
    );
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
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
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
    expect(alert).toHaveTextContent("Couldn't load your broker accounts.");
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
});
