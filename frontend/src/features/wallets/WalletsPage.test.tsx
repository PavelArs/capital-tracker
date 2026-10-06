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
  quantity: '0.0098',
  price: { value: '80000', observedAt: null, source: 'kraken', status: 'fresh' },
  priceChange24hPercent: null,
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
    // WAL-PAGE: the wallet's name opens its own page.
    expect(within(trustCard).getByRole('link', { name: 'Trust Wallet' })).toHaveAttribute(
      'href',
      `/wallets/${trust}`,
    );
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
    // Each coin is its own piece of a wrapping cell, so a long list never runs into the value.
    expect(within(trustCard).getByText('1,000 USDT').parentElement).toHaveClass('wallets-amounts');
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
    setup([
      wallet(1, {
        chainBalance: null,
        sync: {
          state: 'partial',
          completedAt: null,
          status: null,
          lastAttemptAt: null,
          lastSuccessAt: null,
          nextRunAt: null,
          errorMessage: null,
        },
      }),
    ]);
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
      sync: {
        state: 'never',
        completedAt: null,
        status: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextRunAt: null,
        errorMessage: null,
      },
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
      sync: {
        state: 'complete',
        completedAt: new Date().toISOString(),
        status: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextRunAt: null,
        errorMessage: null,
      },
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

describe('M11: wallets sync in the background', () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  it('SYNC-STATUS shows a wallet whose background sync failed, with the reason and Retry', async () => {
    const failed = wallet(1, {
      sync: {
        state: 'complete',
        completedAt: minutesAgo(130),
        status: 'failed',
        lastAttemptAt: minutesAgo(3),
        lastSuccessAt: minutesAgo(130),
        nextRunAt: minutesAgo(-12),
        errorMessage: 'Bitcoin data is temporarily unavailable.',
      },
    });
    setup([failed]);
    const recovered: WalletAddress = {
      ...failed,
      sync: { ...failed.sync, status: 'synced', lastSuccessAt: minutesAgo(0), errorMessage: null },
    };
    const sync = vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(recovered));
    const row = await screen.findByRole('button', { name: `Trust Wallet BTC ${addresses.trust}` });
    expect(row).toHaveTextContent('Sync failed');
    expect(row).not.toHaveTextContent('ago');
    const trustCard = card('Trust Wallet');
    expect(
      within(trustCard).getByText(
        'Bitcoin data is temporarily unavailable. Balances shown are from 2 h ago.',
      ),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    vi.mocked(walletAddressesApi.list).mockResolvedValue([recovered]);
    await user.click(within(trustCard).getByRole('button', { name: 'Retry now' }));
    expect(sync).toHaveBeenCalledWith(failed.id);
    await waitFor(() => expect(row).toHaveTextContent('Synced'));
    expect(within(trustCard).queryByText(/temporarily unavailable/)).toBeNull();
  });

  it('shows a delayed source in the drawer with its reason', async () => {
    const delayed = wallet(1, {
      sync: {
        state: 'complete',
        completedAt: minutesAgo(70),
        status: 'delayed',
        lastAttemptAt: minutesAgo(1),
        lastSuccessAt: minutesAgo(70),
        nextRunAt: minutesAgo(-14),
        errorMessage: 'The Bitcoin data source is busy. The app tries again in a few minutes.',
      },
    });
    setup([delayed]);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: `Trust Wallet BTC ${addresses.trust}` }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Bitcoin' });
    expect(within(drawer).getByText('Delayed')).toBeInTheDocument();
    expect(within(drawer).getByRole('alert')).toHaveTextContent(
      'The Bitcoin data source is busy. The app tries again in a few minutes. Balances shown are from 1 h ago.',
    );
    expect(drawer).toHaveTextContent('Every hour in the background');
  });

  it('follows a history the background job is loading without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const loading = wallet(1, {
        chainBalance: null,
        sync: {
          state: 'partial',
          completedAt: null,
          status: 'syncing',
          lastAttemptAt: minutesAgo(0),
          lastSuccessAt: null,
          nextRunAt: minutesAgo(0),
          errorMessage: null,
        },
      });
      const done = wallet(1, {
        sync: {
          ...loading.sync,
          state: 'complete',
          completedAt: minutesAgo(0),
          status: 'synced',
          lastSuccessAt: minutesAgo(0),
        },
      });
      setup([loading]);
      const sync = vi.spyOn(walletAddressesApi, 'sync');
      const row = await screen.findByRole('button', {
        name: `Trust Wallet BTC ${addresses.trust}`,
      });
      // The background job finishes before the page looks again.
      vi.mocked(walletAddressesApi.list).mockResolvedValue([done]);
      expect(row).toHaveTextContent('Syncing');
      expect(screen.getByText(/keeps loading in the background/)).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(row).toHaveTextContent('Synced'));
      expect(row).toHaveTextContent('0.01 BTC');
      expect(sync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('M14: Ethereum wallets', () => {
  const ethAddress = `0x${'5e'.repeat(20)}`;
  const ethWallet = (changes: Partial<WalletAddress>) =>
    wallet(5, {
      network: 'ethereum',
      address: ethAddress,
      label: 'Main ETH',
      chainBalance: '1.500000000000000000',
      balances: [
        { symbol: 'ETH', quantity: '1.500000000000000000' },
        { symbol: 'USDT', quantity: '0.000000' },
        { symbol: 'USDC', quantity: '250.000000' },
      ],
      ...changes,
    });
  const withEther = (): PortfolioValuation => {
    const valuation = portfolio();
    return {
      ...valuation,
      assets: [
        ...valuation.assets,
        asset({
          instrumentId: id(3),
          name: 'Ethereum',
          symbol: 'ETH',
          price: { value: '2000', observedAt: null, source: 'kraken', status: 'fresh' },
          quantity: '1.5',
          value: '3000',
          holdings: [
            { accountId: trust, accountName: 'Trust Wallet', quantity: '1.5', value: '3000' },
          ],
        }),
        asset({
          instrumentId: id(4),
          name: 'USD Coin',
          symbol: 'USDC',
          price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
          quantity: '250',
          value: '250',
          holdings: [
            { accountId: trust, accountName: 'Trust Wallet', quantity: '250', value: '250' },
          ],
        }),
      ],
    };
  };

  it('WAL-ADD tracks an Ethereum address with ETH, USDT and USDC', async () => {
    setup([]);
    const added = ethWallet({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const ethereum = within(dialog).getByRole('button', { name: /^Ethereum/ });
    expect(ethereum).toBeEnabled();
    expect(ethereum).toHaveTextContent('One address. ETH, USDT and USDC');
    await user.click(ethereum);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Ethereum wallet address');
    expect(field).toHaveAttribute('placeholder', '0x…');
    expect(dialog).toHaveTextContent('tracks ETH, USDT and USDC on Ethereum mainnet');
    await user.type(field, ethAddress.toUpperCase().replace('0X', '0x'));
    expect(within(dialog).getByText('Ethereum address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    expect(within(dialog).getByText(ethAddress)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({
      network: 'ethereum',
      address: ethAddress,
      accountId: trust,
    });
  });

  it('WAL-INVALID refuses a Bitcoin address picked as Ethereum and saves nothing', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Ethereum/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText('Ethereum wallet address'), addresses.trust);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(
      within(dialog).getByText(/This is not an Ethereum address: it looks like a Bitcoin address/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('WAL-NO-SECRETS drops a private key pasted as an Ethereum address', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Ethereum/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Ethereum wallet address');
    await user.click(field);
    await user.paste(`0x${'4c'.repeat(32)}`);
    expect(field).toHaveValue('');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('It was not saved.');
    expect(add).not.toHaveBeenCalled();
  });

  it('shows the coin and the held tokens, values them and checks each against the records', async () => {
    setup([wallet(1, {}), ethWallet({})], withEther());
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    expect(within(trustCard).getByText('Bitcoin, Ethereum · 2 addresses')).toBeInTheDocument();
    const row = within(trustCard).getByRole('button', { name: `Main ETH ${ethAddress}` });
    expect(row).toHaveTextContent('1.5 ETH · 250 USDC');
    expect(row).not.toHaveTextContent('USDT');
    // 1.5 ETH at $2,000 plus 250 USDC at $1.
    expect(row).toHaveTextContent('$3,250.00');
    // The tracked tokens are no longer listed as kept by hand.
    expect(trustCard).not.toHaveTextContent('USDT tracked by hand');
    expect(within(trustCard).getByRole('note')).toHaveTextContent(
      'The blockchain shows 0 USDT; your transactions in this wallet give 1,000 USDT.',
    );

    const user = userEvent.setup();
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    expect(drawer).toHaveTextContent('1.5 ETH · 250 USDC');
    expect(drawer).toHaveTextContent('Tracked assetsETH, USDT, USDC');
    expect(drawer).toHaveTextContent('Etherscan');
  });

  it('stacks the assets of an Ethereum row on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    setup([ethWallet({})], withEther());
    const row = await screen.findByRole('button', { name: `Main ETH ${ethAddress}` });
    const amounts = within(row).getByText('1.5 ETH').parentElement;
    expect(amounts).toHaveClass('wallets-stack');
    expect([...(amounts?.children ?? [])].map((piece) => piece.textContent)).toEqual([
      '1.5 ETH',
      '250 USDC',
    ]);
  });

  it('SYNC-STATUS names the missing Etherscan key', async () => {
    const stale = ethWallet({});
    setup([stale], withEther());
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue({
      ...synced(stale, 'provider_error'),
      reason: 'not_configured',
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    await user.click(within(drawer).getByRole('button', { name: 'Sync now' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Etherscan');
  });
});

describe('M15: Solana wallets', () => {
  // Base58 of the SHA-256 of a fixed label: a synthetic key, never an owner's wallet.
  const solAddress = '74jkuZyPNbBxRF7N6TgmYPi4jTtnk93yH9kpFyNQHypf';
  const solWallet = (changes: Partial<WalletAddress>) =>
    wallet(6, {
      network: 'solana',
      address: solAddress,
      label: 'Main SOL',
      chainBalance: '12.500000000',
      balances: [
        { symbol: 'SOL', quantity: '12.500000000' },
        { symbol: 'USDT', quantity: '40.000000' },
        { symbol: 'USDC', quantity: '0.000000' },
      ],
      ...changes,
    });
  const withSol = (): PortfolioValuation => {
    const valuation = portfolio();
    return {
      ...valuation,
      assets: [
        ...valuation.assets,
        asset({
          instrumentId: id(5),
          name: 'Solana',
          symbol: 'SOL',
          price: { value: '150', observedAt: null, source: 'kraken', status: 'fresh' },
          quantity: '12.5',
          value: '1875',
          holdings: [
            { accountId: trust, accountName: 'Trust Wallet', quantity: '12.5', value: '1875' },
          ],
        }),
      ],
    };
  };

  it('WAL-ADD tracks a Solana address with SOL, USDT and USDC, case kept', async () => {
    setup([]);
    const added = solWallet({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const solana = within(dialog).getByRole('button', { name: /^Solana/ });
    expect(solana).toBeEnabled();
    expect(solana).toHaveTextContent('One address. SOL, USDT and USDC');
    await user.click(solana);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Solana wallet address');
    expect(dialog).toHaveTextContent('tracks SOL, USDT and USDC on Solana mainnet');
    await user.type(field, solAddress);
    expect(within(dialog).getByText('Solana address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    expect(within(dialog).getByText(solAddress)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({ network: 'solana', address: solAddress, accountId: trust });
  });

  it('WAL-INVALID refuses an Ethereum address picked as Solana and saves nothing', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Solana/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText('Solana wallet address'), `0x${'5e'.repeat(20)}`);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(
      within(dialog).getByText(/This is not a Solana address: it looks like an Ethereum address/),
    ).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('WAL-NO-SECRETS drops a Solana keypair pasted as an address', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Solana/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Solana wallet address');
    await user.click(field);
    await user.paste(`[${Array(64).fill('7').join(',')}]`);
    expect(field).toHaveValue('');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('It was not saved.');
    expect(add).not.toHaveBeenCalled();
  });

  it('shows SOL and the held tokens, values them and checks each against the records', async () => {
    setup([wallet(1, {}), solWallet({})], withSol());
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    expect(within(trustCard).getByText('Bitcoin, Solana · 2 addresses')).toBeInTheDocument();
    const row = within(trustCard).getByRole('button', { name: `Main SOL ${solAddress}` });
    expect(row).toHaveTextContent('12.5 SOL · 40 USDT');
    expect(row).not.toHaveTextContent('USDC');
    // 12.5 SOL at $150 plus 40 USDT at $1.
    expect(row).toHaveTextContent('$1,915.00');
    expect(within(trustCard).getByRole('note')).toHaveTextContent(
      'The blockchain shows 40 USDT; your transactions in this wallet give 1,000 USDT.',
    );

    const user = userEvent.setup();
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Solana' });
    expect(drawer).toHaveTextContent('12.5 SOL · 40 USDT');
    expect(drawer).toHaveTextContent('Tracked assetsSOL, USDT, USDC');
    expect(drawer).toHaveTextContent('Solana public RPC');
  });
});
