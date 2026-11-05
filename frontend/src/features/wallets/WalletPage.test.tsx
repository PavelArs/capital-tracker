import { accountingApi, type WalletKind } from '@api/accounting.api';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import ToastViewport from '@components/Toast';
import { ToastProvider } from '@contexts/ToastContext';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ReactElement } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WalletPage, { accountOperations } from './WalletPage';
import WalletsPage from './WalletsPage';

// Synthetic ids, names, addresses and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const cold = id(11);
const btc = { instrumentId: id(1), symbol: 'BTC', name: 'Bitcoin' };

const wallet = (n: number, changes: Partial<WalletAddress> = {}): WalletAddress => ({
  id: id(20 + n),
  network: 'bitcoin',
  address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  accountId: trust,
  label: 'Savings',
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01000000',
  balances: null,
  sync: {
    state: 'complete',
    completedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    status: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    errorMessage: null,
  },
  ...changes,
});

const asset = (changes: Partial<AssetValuation>): AssetValuation => ({
  instrumentId: id(1),
  name: 'Bitcoin',
  symbol: 'BTC',
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
  quantity: '0.01',
  price: { value: '80000', observedAt: null, source: 'kraken', status: 'fresh' },
  priceChange24hPercent: null,
  missingPrice: null,
  value: '800',
  allocationPercent: null,
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostQuantity: '0',
  missingRateQuantity: '0',
  averageBuyPrice: null,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownCostQuantity: '0',
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  holdings: [],
  ...changes,
});

function portfolio(trustName = 'Trust Wallet'): PortfolioValuation {
  return {
    at: '2026-10-05T12:00:00.000Z',
    currency: 'USD',
    mainCurrency: 'USD',
    rates: [],
    completeness: 'complete',
    totalValue: '1800',
    pricedSubtotal: '1800',
    missingPriceCount: 0,
    stalePriceCount: 0,
    unavailableAccountCount: 0,
    depositsValue: '0',
    unratedDepositCount: 0,
    costBasis: null,
    knownCostSubtotal: '0',
    unknownCostCount: 0,
    missingRateCount: 0,
    unrealizedPnl: null,
    unrealizedReturnPercent: null,
    knownUnrealizedPnl: null,
    knownUnrealizedReturnPercent: null,
    realizedPnl: null,
    knownRealizedSubtotal: '0',
    unknownRealizedCount: 0,
    assets: [
      asset({
        holdings: [{ accountId: trust, accountName: trustName, quantity: '0.01', value: '800' }],
      }),
      asset({
        instrumentId: id(2),
        name: 'Tether',
        symbol: 'USDT',
        price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
        quantity: '1000',
        value: '1000',
        holdings: [
          { accountId: cold, accountName: 'Cold storage', quantity: '1000', value: '1000' },
        ],
      }),
    ],
    allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
    accounts: [
      {
        accountId: trust,
        name: trustName,
        coverage: 'covered',
        pricedValue: '800',
        missingPriceCount: 0,
      },
      {
        accountId: cold,
        name: 'Cold storage',
        coverage: 'covered',
        pricedValue: '1000',
        missingPriceCount: 0,
      },
    ],
  };
}

const operation = (n: number, changes: Partial<Operation>): Operation => ({
  id: `trade:${id(40 + n)}`,
  kind: 'trade',
  type: 'buy',
  direction: 'in',
  occurredAt: '2025-06-13T00:00:00.000Z',
  orderWithinTimestamp: 0,
  asset: btc,
  quantity: '0.01',
  counterAsset: null,
  counterQuantity: null,
  valueUsd: '800',
  estimatedValueUsd: null,
  costBasisUsd: null,
  feeUsd: null,
  value: '800',
  estimatedValue: null,
  costBasis: null,
  feeValue: null,
  fee: null,
  paid: null,
  settlement: null,
  comment: null,
  classification: null,
  account: { id: trust, name: 'Trust Wallet' },
  counterAccount: null,
  wallet: null,
  counterWallet: null,
  chain: null,
  status: 'recorded',
  source: 'manual',
  version: 1,
  ...changes,
});
const operations = (items: Operation[]): OperationList => ({
  at: '2026-10-05T12:00:00.000Z',
  quoteCurrency: 'USD',
  needsClassificationCount: 0,
  dustThresholdUsd: null,
  operations: items,
});

const buy = operation(1, {});
const chainReceipt = operation(2, {
  id: `chain:${id(21)}:${'a'.repeat(64)}`,
  kind: 'chain',
  type: null,
  occurredAt: '2025-06-20T00:00:00.000Z',
  asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
  value: null,
  valueUsd: null,
  wallet: { id: id(21), network: 'bitcoin', address: wallet(1).address, label: 'Savings' },
  chain: { txid: 'a'.repeat(64), blockHeight: 800000, priceObservedAt: null, direction: 'in' },
  status: 'needs-classification',
  source: 'chain',
  version: null,
});
const transferIn = operation(3, {
  kind: 'transfer',
  type: 'transfer',
  direction: 'internal',
  occurredAt: '2025-06-15T00:00:00.000Z',
  account: { id: cold, name: 'Cold storage' },
  counterAccount: { id: trust, name: 'Trust Wallet' },
});
const elsewhere = operation(4, {
  occurredAt: '2025-06-25T00:00:00.000Z',
  account: { id: cold, name: 'Cold storage' },
});

function setup({
  account = trust,
  list = [wallet(1)],
  items = [buy, chainReceipt, transferIn, elsewhere],
  kind = null,
  coldClass = null,
  valuation = portfolio(),
  listPage = <p>Wallets list</p>,
  quoteCurrency = 'USD',
  beside = null,
}: {
  account?: string;
  list?: WalletAddress[];
  items?: Operation[];
  kind?: WalletKind | null;
  coldClass?: 'property' | null;
  valuation?: PortfolioValuation;
  listPage?: ReactElement;
  quoteCurrency?: OperationList['quoteCurrency'];
  /** Rendered next to the wallet page, for example a link to another wallet. */
  beside?: ReactElement | null;
} = {}) {
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
    items: [
      {
        id: trust,
        name: 'Trust Wallet',
        kind,
        currentRevision: 0,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      ...(coldClass
        ? [
            {
              id: cold,
              name: 'Cold storage',
              kind: null,
              assetClass: coldClass,
              currentRevision: 0,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ]
        : []),
    ],
    nextCursor: null,
  });
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue(list);
  vi.spyOn(walletAddressesApi, 'syncRuns').mockResolvedValue([]);
  vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
  vi.spyOn(operationsApi, 'list').mockResolvedValue({ ...operations(items), quoteCurrency });
  // Success notices are toasts (plan 1.5): the app's toast region is mounted as in App.tsx.
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/wallets/${account}`]}>
        <Routes>
          <Route
            path="/wallets/:accountId"
            element={
              <>
                <WalletPage />
                {beside}
              </>
            }
          />
          <Route path="/wallets" element={listPage} />
        </Routes>
      </MemoryRouter>
      <ToastViewport />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('WAL-PAGE: one wallet with its addresses, assets and transactions', () => {
  it.each(['RUB', 'USD'] as const)(
    'RUB-WHOLE-WALLET keeps only native %s transaction kopecks',
    async (paidCurrency) => {
      setup({
        quoteCurrency: 'RUB',
        valuation: { ...portfolio(), currency: 'RUB', mainCurrency: 'RUB' },
        items: [
          operation(1, {
            value: '83000.75',
            paid:
              paidCurrency === 'RUB'
                ? {
                    currency: 'RUB',
                    gross: '83000.75',
                    fee: '0',
                    rateDate: '2025-06-13',
                    perUsd: '103.7509375',
                    rateSource: 'owner',
                  }
                : null,
          }),
        ],
      });
      const region = await screen.findByRole('region', { name: /^Transactions/ });
      expect(
        await within(region).findByText(paidCurrency === 'RUB' ? '₽83,000.75' : '₽83,000'),
      ).toBeInTheDocument();
    },
  );
  it('shows the summary, its own addresses and assets, and only its transactions', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' })).toBeVisible();
    expect(screen.getByText('Bitcoin · 1 address')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Wallets' })).toHaveAttribute(
      'href',
      '/wallets',
    );

    const summary = screen.getByRole('region', { name: 'Summary' });
    const stat = (label: string) =>
      within(summary).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(stat('Total value')).toBe('$800.00');
    expect(stat('Assets')).toBe('1');
    expect(stat('Tracked networks')).toBe('1');
    expect(stat('Last sync')).toContain('Synced');
    // 0.01 BTC on the chain and 0.01 BTC recorded: nothing to reconcile.
    expect(within(summary).queryByRole('note')).toBeNull();

    const addresses = screen.getByRole('region', { name: 'Addresses' });
    expect(
      within(addresses).getByRole('button', { name: `Savings ${wallet(1).address}` }),
    ).toHaveTextContent('0.01 BTC');

    const assets = screen.getByRole('region', { name: 'Assets' });
    expect(within(assets).getByRole('link', { name: /Bitcoin/ })).toHaveAttribute(
      'href',
      `/portfolio/${id(1)}`,
    );
    expect(within(assets).queryByText(/Tether/)).toBeNull();
    expect(within(assets).queryByRole('button', { name: /^Show/ })).toBeNull();

    const transactions = screen.getByRole('region', { name: /^Transactions/ });
    await waitFor(() => expect(within(transactions).getAllByRole('listitem')).toHaveLength(3));
    const rows = within(transactions).getAllByRole('listitem');
    // Newest first; the other wallet's buy is not here, a transfer into this wallet is.
    expect(rows[0]).toHaveTextContent('Needs classification');
    expect(rows[1]).toHaveTextContent('Cold storage → Trust Wallet');
    expect(rows[2]).toHaveTextContent('Buy');
    expect(within(transactions).queryByRole('navigation')).toBeNull();
    expect(
      within(transactions).getByRole('link', { name: 'Open in Transactions' }),
    ).toHaveAttribute('href', `/transactions?account=${trust}`);
  });

  // `count` coins, the largest first (700, 600, …), each held in Trust Wallet and in Cold storage.
  const coins = (count: number) =>
    Array.from({ length: count }, (_, index) => {
      const value = String(700 - index * 100);
      return asset({
        instrumentId: id(60 + index),
        name: `Coin ${index + 1}`,
        symbol: `C${index + 1}`,
        quantity: '2',
        value,
        holdings: [
          { accountId: trust, accountName: 'Trust Wallet', quantity: '1', value },
          { accountId: cold, accountName: 'Cold storage', quantity: '1', value },
        ],
      });
    });
  const coinNames = (assets: HTMLElement) =>
    within(assets)
      .getAllByRole('link')
      .map((link) => link.textContent?.match(/^Coin \d/)?.[0]);

  it('WALLET-ASSETS-MORE lists five assets and keeps the rest behind Show N more', async () => {
    setup({ valuation: { ...portfolio(), assets: coins(7) } });
    const assets = await screen.findByRole('region', { name: 'Assets' });
    const names = () => coinNames(assets);
    expect(names()).toEqual(['Coin 1', 'Coin 2', 'Coin 3', 'Coin 4', 'Coin 5']);

    const more = within(assets).getByRole('button', { name: 'Show 2 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(names()).toEqual(['Coin 1', 'Coin 2', 'Coin 3', 'Coin 4', 'Coin 5', 'Coin 6', 'Coin 7']);

    const less = within(assets).getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(less);
    expect(names()).toHaveLength(5);
    // The figures above the cards still count every asset.
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Assets').nextElementSibling).toHaveTextContent(/^7$/);
  });

  it('WALLET-ASSETS-MORE offers nothing more when the wallet holds exactly five assets', async () => {
    setup({ valuation: { ...portfolio(), assets: coins(5) } });
    const assets = await screen.findByRole('region', { name: 'Assets' });
    expect(coinNames(assets)).toHaveLength(5);
    expect(within(assets).queryByRole('button', { name: /^Show/ })).toBeNull();
  });

  it('WALLET-ASSETS-MORE opens another wallet with its assets folded again', async () => {
    setup({
      valuation: { ...portfolio(), assets: coins(7) },
      beside: <Link to={`/wallets/${cold}`}>Open Cold storage</Link>,
    });
    let assets = await screen.findByRole('region', { name: 'Assets' });
    await userEvent.click(within(assets).getByRole('button', { name: 'Show 2 more' }));
    expect(coinNames(assets)).toHaveLength(7);

    await userEvent.click(screen.getByRole('link', { name: 'Open Cold storage' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Cold storage' }),
    ).toBeInTheDocument();
    assets = screen.getByRole('region', { name: 'Assets' });
    expect(coinNames(assets)).toHaveLength(5);
    expect(within(assets).getByRole('button', { name: 'Show 2 more' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('WALLET-TX-PAGES shows five transactions a page, newest first, with Previous and Next', async () => {
    // Eight buys on June 11–18, 2025.
    const buys = Array.from({ length: 8 }, (_, index) =>
      operation(10 + index, { occurredAt: `2025-06-${11 + index}T00:00:00.000Z` }),
    );
    setup({ items: buys });
    const transactions = await screen.findByRole('region', { name: /^Transactions/ });
    await waitFor(() => expect(within(transactions).getAllByRole('listitem')).toHaveLength(5));
    const pages = within(transactions).getByRole('navigation', { name: 'Pages of transactions' });
    expect(within(pages).getByRole('status')).toHaveTextContent('1–5 of 8 transactions');
    expect(within(pages).getByRole('button', { name: 'Previous' })).toBeDisabled();
    let rows = within(transactions).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Jun 18, 2025');
    expect(rows[4]).toHaveTextContent('Jun 14, 2025');

    await userEvent.click(within(pages).getByRole('button', { name: 'Next' }));
    rows = within(transactions).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Jun 13, 2025');
    expect(rows[2]).toHaveTextContent('Jun 11, 2025');
    expect(within(pages).getByRole('status')).toHaveTextContent('6–8 of 8 transactions');
    expect(within(pages).getByRole('button', { name: 'Next' })).toBeDisabled();
    // The count in the card's head is every transaction, not the page.
    expect(transactions).toHaveTextContent(/Transactions\s*8/);
  });

  it('WAL-OPEN: each transaction row opens that transaction in Transactions', async () => {
    setup();
    const transactions = await screen.findByRole('region', { name: /^Transactions/ });
    await waitFor(() => expect(within(transactions).getAllByRole('listitem')).toHaveLength(3));
    const rows = within(transactions).getAllByRole('listitem');
    const opens = (row: HTMLElement) => within(row).getByRole('link').getAttribute('href');
    expect(opens(rows[0])).toBe(`/transactions?open=${encodeURIComponent(chainReceipt.id)}`);
    expect(opens(rows[1])).toBe(`/transactions?open=${encodeURIComponent(transferIn.id)}`);
    expect(opens(rows[2])).toBe(`/transactions?open=${encodeURIComponent(buy.id)}`);
    // The row's text is the link's, so the whole row is the target.
    expect(within(rows[2]).getByRole('link')).toHaveTextContent('Buy');
  });

  it('renames the wallet and shows the new name', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    const rename = vi.spyOn(accountingApi, 'updateAccount').mockResolvedValue({
      id: trust,
      name: 'Ledger',
      kind: null,
      currentRevision: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    vi.mocked(portfolioValuationApi.get).mockResolvedValue(portfolio('Ledger'));

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit wallet' });
    const field = within(dialog).getByLabelText('Name');
    expect(field).toHaveValue('Trust Wallet');
    // DIALOG-CHROME: the ✕ in the head and Cancel beside Save at the right, as in every dialog.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(dialog.querySelector('.ui-modal__foot .ui-grow')).toBeNull();
    await user.clear(field);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a name.');
    expect(rename).not.toHaveBeenCalled();

    await user.type(field, '  Ledger ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(rename).toHaveBeenCalledWith(trust, { name: 'Ledger' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Ledger' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Edit wallet' })).toBeNull();
  });

  it('W1 shows how the wallet is held under its name, once the owner said', async () => {
    setup({ kind: 'hardware' });
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    // As in the prototype: the kind alone; the addresses are listed below.
    expect(await screen.findByText('Hardware wallet')).toBeVisible();
    expect(screen.queryByText(/Bitcoin · 1 address/)).toBeNull();
  });

  it('W1 changes how the wallet is held without touching its name, and can take it back', async () => {
    const user = userEvent.setup();
    setup({ kind: 'software' });
    await screen.findByText('Software wallet');
    const update = vi.spyOn(accountingApi, 'updateAccount').mockResolvedValue({
      id: trust,
      name: 'Trust Wallet',
      kind: 'hardware',
      currentRevision: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    vi.mocked(accountingApi.listAccounts).mockResolvedValue({
      items: [
        {
          id: trust,
          name: 'Trust Wallet',
          kind: 'hardware',
          currentRevision: 1,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit wallet' });
    const field = within(dialog).getByLabelText('How you hold it');
    expect(field).toHaveValue('software');
    // Nothing changed: nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Edit wallet' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    dialog = screen.getByRole('dialog', { name: 'Edit wallet' });
    await user.selectOptions(within(dialog).getByLabelText('How you hold it'), 'hardware');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(trust, { kind: 'hardware' });
    expect(await screen.findByText('Hardware wallet')).toBeVisible();

    vi.mocked(accountingApi.listAccounts).mockResolvedValue({
      items: [
        {
          id: trust,
          name: 'Trust Wallet',
          kind: null,
          currentRevision: 2,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    dialog = screen.getByRole('dialog', { name: 'Edit wallet' });
    await user.selectOptions(within(dialog).getByLabelText('How you hold it'), 'Not chosen');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenLastCalledWith(trust, { kind: null });
    expect(await screen.findByText('Bitcoin · 1 address')).toBeVisible();
  });

  it('WALLET-STATS counts the networks a wallet tracks, each network once', async () => {
    setup({ list: [wallet(1), wallet(2, { address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' })] });
    const summary = await screen.findByRole('region', { name: 'Summary' });
    const labels = [...summary.querySelectorAll('dt')].map((label) => label.textContent);
    expect(labels).toEqual(['Total value', 'Assets', 'Tracked networks', 'Last sync']);
    // Two Bitcoin addresses are one network.
    expect(within(summary).getByText('Tracked networks').nextElementSibling).toHaveTextContent(
      /^1$/,
    );
  });

  it('TOKEN-HIDE counts only the assets the wallet shows, not a hidden token', async () => {
    const base = portfolio();
    const ether = wallet(2, {
      network: 'ethereum',
      address: `0x${'5e'.repeat(20)}`,
      label: 'Main ETH',
      chainBalance: '0',
      balances: [{ symbol: 'ETH', quantity: '0' }],
      hiddenTokens: [{ symbol: 'USDT1A2B', name: 'Tether', quantity: '-40', reason: 'lookalike' }],
    });
    setup({
      list: [wallet(1), ether],
      valuation: {
        ...base,
        assets: [
          ...base.assets,
          asset({
            instrumentId: id(5),
            name: 'Tether',
            symbol: 'USDT1A2B',
            price: null,
            quantity: '40',
            value: null,
            holdings: [
              { accountId: trust, accountName: 'Trust Wallet', quantity: '40', value: null },
            ],
          }),
        ],
      },
    });
    const summary = await screen.findByRole('region', { name: 'Summary' });
    // Bitcoin only: the lookalike token the address leaves out is not one of its assets.
    expect(within(summary).getByText('Assets').nextElementSibling).toHaveTextContent(/^1$/);
    expect(screen.getByRole('region', { name: 'Assets' })).not.toHaveTextContent('USDT1A2B');
    expect(within(summary).getByText('Tracked networks').nextElementSibling).toHaveTextContent(
      /^2$/,
    );
  });

  it('WALLET-STATS names the connection of an exchange account: its read-only API', async () => {
    setup({
      kind: 'exchange',
      list: [
        wallet(1, {
          network: 'bybit',
          address: '123456789',
          label: 'Bybit',
          balances: [{ symbol: 'BTC', quantity: '0.01' }],
          exchange: {
            keyHint: '0001',
            ipBound: false,
            keyExpiresAt: '2027-01-01T00:00:00.000Z',
            reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
            untracked: [],
            historyFrom: '2024-10-10T00:00:00.000Z',
          },
        }),
      ],
    });
    const summary = await screen.findByRole('region', { name: 'Summary' });
    // "Connection", not "Connected": the key may have expired; Last sync says how it went.
    expect(within(summary).getByText('Connection').nextElementSibling).toHaveTextContent(
      'API, read-only',
    );
    expect(within(summary).queryByText('Tracked networks')).toBeNull();
  });

  it('keeps the dialog open with the reason when the rename is refused', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    const refused = new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      statusText: 'Bad Request',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    vi.spyOn(accountingApi, 'updateAccount').mockRejectedValue(refused);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit wallet' });
    await user.type(within(dialog).getByLabelText('Name'), ' 2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Use a name of 1 to 120 characters on one line.',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Edit wallet' })).toBeNull();
  });

  it('WALLET-REMOVE asks first, then removes the wallet and goes back to the list', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    const remove = vi.spyOn(accountingApi, 'removeAccount').mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Trust Wallet?' });
    expect(dialog).toHaveTextContent('its address stops syncing');
    expect(dialog).toHaveTextContent('A wallet that holds recorded transactions cannot be removed');
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove wallet' }));
    expect(remove).toHaveBeenCalledWith(trust);
    expect(await screen.findByText('Wallets list')).toBeVisible();
  });

  it('WALLET-REMOVE keeps the wallet and says why when it holds recorded transactions', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    const refused = new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 409,
      statusText: 'Conflict',
      data: { message: 'This wallet has recorded transactions, so it stays in your history.' },
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    vi.spyOn(accountingApi, 'removeAccount').mockRejectedValue(refused);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Trust Wallet?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This wallet has recorded transactions, so it stays in your history.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog', { name: 'Remove Trust Wallet?' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Trust Wallet' })).toBeVisible();
  });

  it('WALLET-REMOVE stops tracking one address from its drawer after saying what stays', async () => {
    const user = userEvent.setup();
    setup();
    const addresses = await screen.findByRole('region', { name: 'Addresses' });
    await user.click(
      within(addresses).getByRole('button', { name: `Savings ${wallet(1).address}` }),
    );
    const drawer = await screen.findByRole('dialog');
    const remove = vi.spyOn(walletAddressesApi, 'remove').mockResolvedValue(undefined);

    await user.click(within(drawer).getByRole('button', { name: 'Remove address…' }));
    const confirm = within(drawer).getByRole('alertdialog', { name: 'Remove this address?' });
    expect(confirm).toHaveTextContent('stay in your history');
    expect(confirm).toHaveTextContent('Adding it again brings them back');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(within(drawer).queryByRole('alertdialog', { name: 'Remove this address?' })).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(drawer).getByRole('button', { name: 'Remove address…' }));
    vi.mocked(walletAddressesApi.list).mockResolvedValue([]);
    await user.click(
      within(within(drawer).getByRole('alertdialog', { name: 'Remove this address?' })).getByRole(
        'button',
        { name: 'Remove address' },
      ),
    );
    expect(remove).toHaveBeenCalledWith(wallet(1).id);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Addresses' })).toBeNull());
  });

  it.each([
    [
      'no answer',
      new Error('offline'),
      'Could not reach the server. It may have been removed; reload the page to check.',
    ],
    [
      'a server error',
      new AxiosError('Unavailable', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 503,
        statusText: 'Unavailable',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
      'Could not remove it. It may have been removed; reload the page to check.',
    ],
  ])(
    'WALLET-REMOVE tells a failed address removal after %s without claiming nothing changed',
    async (_, error, text) => {
      const user = userEvent.setup();
      setup();
      const addresses = await screen.findByRole('region', { name: 'Addresses' });
      await user.click(
        within(addresses).getByRole('button', { name: `Savings ${wallet(1).address}` }),
      );
      const drawer = await screen.findByRole('dialog');
      vi.spyOn(walletAddressesApi, 'remove').mockRejectedValue(error);

      await user.click(within(drawer).getByRole('button', { name: 'Remove address…' }));
      await user.click(
        within(within(drawer).getByRole('alertdialog', { name: 'Remove this address?' })).getByRole(
          'button',
          { name: 'Remove address' },
        ),
      );
      const failure = await within(drawer).findByText(text);
      expect(failure).toBeVisible();
      expect(failure).not.toHaveTextContent('Nothing was changed');
      expect(screen.getByRole('dialog')).toBeVisible();
    },
  );

  it('WALLET-REMOVE does not claim nothing changed when a wallet removal gets a server error', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    vi.spyOn(accountingApi, 'removeAccount').mockRejectedValue(
      new AxiosError('Bad gateway', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 502,
        statusText: 'Bad gateway',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Trust Wallet?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove wallet' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not remove the wallet. It may have been removed; reload the page to check.',
    );
    expect(alert).not.toHaveTextContent('Nothing was changed');
  });

  it('syncs every address of the wallet', async () => {
    const user = userEvent.setup();
    const second = wallet(2, { address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', label: null });
    setup({ list: [wallet(1), second] });
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    const sync = vi.spyOn(walletAddressesApi, 'sync').mockImplementation(async (addressId) => ({
      outcome: 'complete',
      reason: null,
      imported: 0,
      address: addressId === second.id ? second : wallet(1),
    }));
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    expect(sync.mock.calls.map(([addressId]) => addressId)).toEqual([wallet(1).id, second.id]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled());
  });

  it('offers to add an address to this wallet, preset to its name', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    await user.click(screen.getByRole('button', { name: 'Add address' }));
    // From a wallet's page the dialog names the wallet the address joins.
    const dialog = screen.getByRole('dialog', { name: 'Add an address to Trust Wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Bitcoin/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(
      within(dialog).getByLabelText('Bitcoin wallet address'),
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByLabelText(/^Wallet/)).toHaveValue('Trust Wallet');
  });

  it('never offers a property account as a wallet for a new address (v8)', async () => {
    // Codex P2: an address put into a property would sync coins into Real estate.
    const user = userEvent.setup();
    setup({ coldClass: 'property' });
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    await user.click(screen.getByRole('button', { name: 'Add address' }));
    // From a wallet's page the dialog names the wallet the address joins.
    const dialog = screen.getByRole('dialog', { name: 'Add an address to Trust Wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Bitcoin/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(
      within(dialog).getByLabelText('Bitcoin wallet address'),
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const choices = within(dialog).getByRole('group', { name: 'Your wallets' });
    expect(
      within(choices)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Trust Wallet']);
  });

  it('shows the stored background failure as the last sync (SYNC-STATUS)', async () => {
    const failing = wallet(2, {
      address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
      label: null,
      sync: {
        ...wallet(2).sync,
        status: 'failed',
        errorMessage: 'Bitcoin data is temporarily unavailable.',
      },
    });
    setup({ list: [wallet(1), failing] });
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(
      within(summary).getByText('Last sync', { exact: true }).nextElementSibling,
    ).toHaveTextContent('Sync failed');
    expect(
      within(screen.getByRole('region', { name: 'Addresses' })).getByText(
        /^Bitcoin data is temporarily unavailable\. Balances shown are from/,
      ),
    ).toBeInTheDocument();
  });

  it('shows a wallet tracked by hand without address controls', async () => {
    setup({ account: cold, list: [wallet(1)] });
    expect(await screen.findByRole('heading', { level: 2, name: 'Cold storage' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Addresses' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('None')).toBeInTheDocument();
    expect(within(summary).getByText('Tracked by hand')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a wallet address' }));
    // The dialog says the address joins this wallet, not a new one.
    expect(
      screen.getByRole('dialog', { name: 'Add an address to Cold storage' }),
    ).toBeInTheDocument();
  });

  it('says when the wallet does not exist', async () => {
    setup({ account: id(99) });
    expect(await screen.findByRole('heading', { name: 'Wallet not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Wallets' })).toHaveAttribute('href', '/wallets');
  });
});

describe('UI audit: one wallet', () => {
  it('wallets-02 keeps the keyboard on Sync now while it runs', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    vi.spyOn(walletAddressesApi, 'sync').mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    const button = screen.getByRole('button', { name: 'Syncing…' });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('wallets-11 lists the assets by what this wallet holds of each, largest first', async () => {
    const valuation = portfolio();
    // Tether comes after Bitcoin in the whole portfolio, but this wallet holds more of it.
    valuation.assets[1].holdings.push({
      accountId: trust,
      accountName: 'Trust Wallet',
      quantity: '1500',
      value: '1500',
    });
    setup({ valuation });
    const assets = await screen.findByRole('region', { name: 'Assets' });
    const names = within(assets)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names[0]).toMatch(/^Tether/);
    expect(names[1]).toMatch(/^Bitcoin/);
  });

  it('wallets-21 confirms a rename', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    vi.spyOn(accountingApi, 'updateAccount').mockResolvedValue({
      id: trust,
      name: 'Ledger',
      kind: null,
      currentRevision: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    vi.mocked(portfolioValuationApi.get).mockResolvedValue(portfolio('Ledger'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit wallet' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Ledger');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await screen.findByText('Wallet renamed')).closest('[role]')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('wallets-21 lands on Wallets, says what was removed and puts the keyboard on its heading', async () => {
    const user = userEvent.setup();
    setup({ listPage: <WalletsPage /> });
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    vi.spyOn(accountingApi, 'removeAccount').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Trust Wallet?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove wallet' }));
    const said = await screen.findByText('Trust Wallet was removed');
    expect(said.closest('[role]')).toHaveAttribute('role', 'status');
    // The row it was on is gone: the keyboard lands on the Wallets heading (plan 1.5).
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Wallets' })).toHaveFocus(),
    );
  });

  it('wallets-08 offers to connect the Bybit API on a Bybit wallet tracked by hand', async () => {
    const user = userEvent.setup();
    const valuation = portfolio();
    valuation.accounts[1].name = 'Bybit';
    setup({ account: cold, valuation });
    await screen.findByRole('heading', { level: 2, name: 'Bybit' });
    await user.click(screen.getByRole('button', { name: 'Connect Bybit API' }));
    const dialog = screen.getByRole('dialog', { name: 'Connect Bybit API' });
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('API key')).toBeInTheDocument();
  });
});

describe('accountOperations', () => {
  it('keeps rows of the account and transfers on either side, newest first', () => {
    expect(
      accountOperations([buy, elsewhere, transferIn, chainReceipt], trust).map((item) => item.id),
    ).toEqual([chainReceipt.id, transferIn.id, buy.id]);
  });
});
