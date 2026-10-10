import { accountingApi, type WalletKind } from '@api/accounting.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WalletPage, { accountOperations } from './WalletPage';

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
    costBasis: null,
    knownCostSubtotal: '0',
    unknownCostCount: 0,
    missingRateCount: 0,
    unrealizedPnl: null,
    unrealizedReturnPercent: null,
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
}: {
  account?: string;
  list?: WalletAddress[];
  items?: Operation[];
  kind?: WalletKind | null;
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
    ],
    nextCursor: null,
  });
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio());
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue(list);
  vi.spyOn(operationsApi, 'list').mockResolvedValue(operations(items));
  render(
    <MemoryRouter initialEntries={[`/wallets/${account}`]}>
      <Routes>
        <Route path="/wallets/:accountId" element={<WalletPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('WAL-PAGE: one wallet with its addresses, assets and transactions', () => {
  it('shows the summary, its own addresses and assets, and only its transactions', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' })).toBeVisible();
    expect(screen.getByText('Bitcoin · 1 address')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Wallets' })).toHaveAttribute('href', '/wallets');

    const summary = screen.getByRole('region', { name: 'Summary' });
    const stat = (label: string) =>
      within(summary).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(stat('Total value')).toBe('$800.00');
    expect(stat('Assets')).toBe('1');
    expect(stat('Tracked addresses')).toBe('1');
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

    const transactions = screen.getByRole('region', { name: /^Transactions/ });
    await waitFor(() => expect(within(transactions).getAllByRole('listitem')).toHaveLength(3));
    const rows = within(transactions).getAllByRole('listitem');
    // Newest first; the other wallet's buy is not here, a transfer into this wallet is.
    expect(rows[0]).toHaveTextContent('Needs classification');
    expect(rows[1]).toHaveTextContent('Cold storage → Trust Wallet');
    expect(rows[2]).toHaveTextContent('Buy');
    expect(
      within(transactions).getByRole('link', { name: 'Open in Transactions' }),
    ).toHaveAttribute('href', `/transactions?account=${trust}`);
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

  it('W1 shows how the wallet is held next to its addresses, once the owner said', async () => {
    setup({ kind: 'hardware' });
    await screen.findByRole('heading', { level: 2, name: 'Trust Wallet' });
    expect(await screen.findByText('Hardware wallet · Bitcoin · 1 address')).toBeVisible();
  });

  it('W1 changes how the wallet is held without touching its name, and can take it back', async () => {
    const user = userEvent.setup();
    setup({ kind: 'software' });
    await screen.findByText('Software wallet · Bitcoin · 1 address');
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
    expect(await screen.findByText('Hardware wallet · Bitcoin · 1 address')).toBeVisible();

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
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Bitcoin/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(
      within(dialog).getByLabelText('Bitcoin wallet address'),
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByLabelText(/^Wallet/)).toHaveValue('Trust Wallet');
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
    expect(screen.getByRole('button', { name: 'Add a wallet address' })).toBeInTheDocument();
  });

  it('says when the wallet does not exist', async () => {
    setup({ account: id(99) });
    expect(await screen.findByRole('heading', { name: 'Wallet not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Wallets' })).toHaveAttribute('href', '/wallets');
  });
});

describe('accountOperations', () => {
  it('keeps rows of the account and transfers on either side, newest first', () => {
    expect(
      accountOperations([buy, elsewhere, transferIn, chainReceipt], trust).map((item) => item.id),
    ).toEqual([chainReceipt.id, transferIn.id, buy.id]);
  });
});
