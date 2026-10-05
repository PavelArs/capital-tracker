import { accountingApi } from '@api/accounting.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { type SyncResult, type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WalletsPage from './WalletsPage';

// Synthetic ids, names, addresses and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const cold = id(11);
const addresses = {
  trust: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  loose: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  fresh: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
};
const seedPhrase = Array(11).fill('abandon').concat('about').join(' ');

const wallet = (n: number, changes: Partial<WalletAddress>): WalletAddress => ({
  id: id(20 + n),
  network: 'bitcoin',
  address: addresses.trust,
  accountId: trust,
  label: 'Trust Wallet BTC',
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01000000',
  sync: { state: 'complete', completedAt: new Date(Date.now() - 8 * 60_000).toISOString() },
  ...changes,
});

const asset = (changes: Partial<AssetValuation>): AssetValuation => ({
  instrumentId: id(1),
  name: 'Bitcoin',
  symbol: 'BTC',
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
  quantity: '0.0098',
  price: { value: '80000', observedAt: null, source: 'kraken', status: 'fresh' },
  missingPrice: null,
  value: '784',
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

function portfolio(btcInTrust = '0.0098'): PortfolioValuation {
  return {
    at: '2026-10-05T12:00:00.000Z',
    currency: 'USD',
    mainCurrency: 'USD',
    rates: [],
    completeness: 'complete',
    totalValue: '1784',
    pricedSubtotal: '1784',
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
        holdings: [
          { accountId: trust, accountName: 'Trust Wallet', quantity: btcInTrust, value: '784' },
        ],
      }),
      asset({
        instrumentId: id(2),
        name: 'Tether',
        symbol: 'USDT',
        price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
        quantity: '1000',
        value: '1000',
        holdings: [
          { accountId: trust, accountName: 'Trust Wallet', quantity: '1000', value: '1000' },
        ],
      }),
    ],
    allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
    accounts: [
      {
        accountId: trust,
        name: 'Trust Wallet',
        coverage: 'covered',
        pricedValue: '1784',
        missingPriceCount: 0,
      },
      {
        accountId: cold,
        name: 'Cold storage',
        coverage: 'not-started',
        pricedValue: '0',
        missingPriceCount: 0,
      },
    ],
  };
}

const synced = (address: WalletAddress, outcome: SyncResult['outcome'] = 'complete') =>
  ({ outcome, reason: null, imported: 3, address }) satisfies SyncResult;

function setup(list: WalletAddress[], valuation = portfolio()) {
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue(list);
  vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue({
    total: 0,
    offset: 0,
    limit: 50,
    nextOffset: null,
    missingUsdValueCount: 0,
    items: [],
  });
  render(
    <MemoryRouter initialEntries={['/wallets']}>
      <WalletsPage />
    </MemoryRouter>,
  );
}
const card = (name: string) => screen.getByRole('region', { name });
const openAddWallet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
  const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
  await user.click(within(dialog).getByRole('button', { name: /^Bitcoin/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
  return dialog;
};

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WAL-LIST: wallets grouped by account', () => {
  it('shows each account with its addresses, coins kept by hand and the chain check', async () => {
    setup([wallet(1, {}), wallet(2, { accountId: null, label: null, address: addresses.loose })]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    expect(screen.getByRole('heading', { level: 1, name: 'Wallets' })).toBeInTheDocument();
    expect(within(trustCard).getByText('Bitcoin · 1 address')).toBeInTheDocument();
    expect(within(trustCard).getByText('$1,784.00')).toBeInTheDocument();
    const row = within(trustCard).getByRole('button', {
      name: `Trust Wallet BTC ${addresses.trust}`,
    });
    expect(row).toHaveTextContent('bc1qar0s…wf5mdq');
    expect(row).toHaveTextContent('0.01 BTC');
    expect(row).toHaveTextContent('$800.00');
    expect(row).toHaveTextContent('Synced');
    expect(row).toHaveTextContent('8 min ago');
    expect(trustCard).toHaveTextContent('USDT tracked by hand');
    expect(trustCard).toHaveTextContent('1,000 USDT');
    // SYNC-RECONCILE: 0.01 BTC on the chain against 0.0098 BTC recorded.
    expect(within(trustCard).getByRole('note')).toHaveTextContent(
      'Balance differs by 0.0002 BTC. The blockchain shows 0.01 BTC; your transactions in this wallet give 0.0098 BTC.',
    );

    const loose = card('Not in a wallet yet');
    expect(
      within(loose).getByRole('button', { name: `Bitcoin ${addresses.loose}` }),
    ).toBeInTheDocument();
    expect(
      within(card('Cold storage')).getByText('Nothing in this wallet yet.'),
    ).toBeInTheDocument();
    expect(within(card('Cold storage')).getByText('Tracked by hand')).toBeInTheDocument();
  });

  it('says nothing when the chain agrees and waits for a partly loaded history', async () => {
    setup([wallet(1, {})], portfolio('0.01'));
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    expect(within(trustCard).queryByRole('note')).toBeNull();
    cleanup();
    setup([wallet(1, { chainBalance: null, sync: { state: 'partial', completedAt: null } })]);
    const partial = await screen.findByRole('region', { name: 'Trust Wallet' });
    expect(within(partial).queryByRole('note')).toBeNull();
    expect(partial).toHaveTextContent('Partly loaded');
    expect(within(partial).getByRole('button', { name: 'Continue loading' })).toBeInTheDocument();
  });

  it('offers to add the first wallet when there is nothing yet', async () => {
    setup([], { ...portfolio(), assets: [], accounts: [] });
    expect(await screen.findByRole('heading', { name: 'No wallets connected' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeInTheDocument();
  });

  it('turns rows into two-line items on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    setup([wallet(1, {})]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const row = within(trustCard).getByRole('button', {
      name: `Trust Wallet BTC ${addresses.trust}`,
    });
    expect(row).toHaveClass('transactions-item');
    expect(row).toHaveTextContent('bc1qar0s…wf5mdq · Synced');
    expect(row).toHaveTextContent('0.01 BTC$800.00');
  });
});

describe('WAL-ADD: add a Bitcoin address to a wallet', () => {
  it('joins an existing wallet with a name and loads its history', async () => {
    setup([]);
    const added = wallet(3, {
      address: addresses.fresh,
      label: 'Savings BTC',
      transactionCount: 0,
      chainBalance: null,
      sync: { state: 'never', completedAt: null },
    });
    const create = vi.spyOn(accountingApi, 'createAccount');
    const add = vi.spyOn(walletAddressesApi, 'add').mockImplementation(async () => {
      vi.mocked(walletAddressesApi.list).mockResolvedValue([added]);
      return { created: true, address: added };
    });
    let finish: (result: SyncResult) => void = () => undefined;
    const sync = vi
      .spyOn(walletAddressesApi, 'sync')
      .mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    expect(within(dialog).getByText('Script address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    expect(within(dialog).getByText(/joins your wallet Trust Wallet/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Address name/), 'Savings BTC');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith({
      network: 'bitcoin',
      address: addresses.fresh,
      accountId: trust,
      label: 'Savings BTC',
    });
    expect(sync).toHaveBeenCalledWith(added.id);
    const row = within(card('Trust Wallet')).getByRole('button', {
      name: `Savings BTC ${addresses.fresh}`,
    });
    expect(row).toHaveTextContent('Syncing');
    expect(card('Trust Wallet')).toHaveTextContent('Loading the transaction history');

    const done = synced({
      ...added,
      transactionCount: 3,
      chainBalance: '0.00500000',
      sync: { state: 'complete', completedAt: new Date().toISOString() },
    });
    vi.mocked(walletAddressesApi.list).mockResolvedValue([done.address]);
    finish(done);
    await waitFor(() => expect(row).toHaveTextContent('Synced'));
    expect(row).toHaveTextContent('0.005 BTC');
  });

  it('creates a new wallet once for the typed name', async () => {
    setup([]);
    const create = vi
      .spyOn(accountingApi, 'createAccount')
      .mockResolvedValue({ id: id(12), name: 'Ledger', currentRevision: 1, createdAt: '' });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ created: false, address: wallet(4, { accountId: id(12) }) });
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText(/^Wallet/), 'Ledger');
    expect(within(dialog).getByText(/A new wallet named Ledger is created/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not reach the server',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add wallet' })).toBeNull());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].requestId).toBe(create.mock.calls[1][0].requestId);
    expect(create.mock.calls[0][0].name).toBe('Ledger');
    expect(add).toHaveBeenLastCalledWith({
      network: 'bitcoin',
      address: addresses.fresh,
      accountId: id(12),
    });
  });

  it('WAL-NO-SECRETS drops a seed phrase from the form and never sends it', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    const field = within(dialog).getByLabelText('Bitcoin wallet address');
    await user.click(field);
    await user.paste(seedPhrase);
    expect(field).toHaveValue('');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'This looks like a seed phrase. Never share it',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
    expect(within(dialog).queryByLabelText(/seed|private key/i)).toBeNull();
  });

  it('WAL-INVALID refuses an address of another network', async () => {
    setup([]);
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(
      within(dialog).getByLabelText('Bitcoin wallet address'),
      '0x3B9e4f8A2c71D05e6aF1b2C9d8E07a4F5c6D8F31',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText(/This looks like an Ethereum address/)).toBeInTheDocument();
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('WAL-DUP shows the wallet that already tracks the address', async () => {
    setup([wallet(1, {})]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(
      within(dialog).getByLabelText('Bitcoin wallet address'),
      addresses.trust.toUpperCase(),
    );
    expect(within(dialog).getByText(/already tracked in Trust Wallet/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Open it' }));
    expect(screen.getByRole('dialog', { name: 'Trust Wallet · Bitcoin' })).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('WAL-ACCOUNT: an address drawer', () => {
  it('puts an address without a wallet into one and names it', async () => {
    const loose = wallet(2, { accountId: null, label: null, address: addresses.loose });
    setup([loose]);
    const update = vi
      .spyOn(walletAddressesApi, 'update')
      .mockResolvedValue({ ...loose, accountId: cold, label: 'Spare' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Bitcoin ${addresses.loose}` }));
    const drawer = screen.getByRole('dialog', { name: 'Bitcoin address' });
    expect(drawer).toHaveTextContent(addresses.loose);
    expect(drawer).toHaveTextContent('Blockstream Esplora');
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'Cold storage');
    await user.type(within(drawer).getByLabelText(/Address name/), 'Spare');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(loose.id, { accountId: cold, label: 'Spare' });
    expect(await within(drawer).findByRole('status')).toHaveTextContent('Saved.');
    expect(screen.queryByRole('region', { name: 'Not in a wallet yet' })).toBeNull();
    expect(
      within(card('Cold storage')).getByRole('button', { name: `Spare ${addresses.loose}` }),
    ).toBeInTheDocument();
  });

  it('reports a failed sync with the reason and retries', async () => {
    const stale = wallet(1, {});
    setup([stale]);
    const sync = vi
      .spyOn(walletAddressesApi, 'sync')
      .mockResolvedValueOnce({ ...synced(stale, 'provider_error'), reason: 'unavailable' })
      .mockResolvedValueOnce(synced(stale));
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: `Trust Wallet BTC ${addresses.trust}` }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Bitcoin' });
    await user.click(within(drawer).getByRole('button', { name: 'Sync now' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'Bitcoin data is temporarily unavailable',
    );
    expect(drawer).toHaveTextContent('Sync failed');
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await user.click(within(card('Trust Wallet')).getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(card('Trust Wallet')).not.toHaveTextContent('Sync failed'));
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
