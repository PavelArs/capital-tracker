import { accountingApi, type WalletKind } from '@api/accounting.api';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import {
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import {
  type NewWalletAccount,
  type SyncResult,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortValue } from '../shell/CopyValue';
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
  knownCostQuantity: '0',
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
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

const account = (accountId: string, name: string, kind: WalletKind | null) => ({
  id: accountId,
  name,
  kind,
  currentRevision: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
});

const noOperations: OperationList = {
  at: '2026-10-05T12:00:00.000Z',
  quoteCurrency: 'USD',
  needsClassificationCount: 0,
  dustThresholdUsd: null,
  operations: [],
};

function setup(
  list: WalletAddress[],
  valuation = portfolio(),
  kinds: Record<string, WalletKind | null> = {},
  hidden:
    | { instrumentId: string; name: string; symbol: string | null; hiddenAt: string }[]
    | 'unread' = [],
  entry: string | { pathname: string; state: unknown } = '/wallets',
  more: (ReturnType<typeof account> & { assetClass?: 'broker' | 'property' })[] = [],
  accountsAnswer?: ReturnType<typeof accountingApi.listAccounts>,
) {
  const hiddenList = vi.spyOn(hiddenAssetsApi, 'list');
  if (hidden === 'unread') hiddenList.mockRejectedValue(new Error('unavailable'));
  else hiddenList.mockResolvedValue(hidden);
  const accounts = vi.spyOn(accountingApi, 'listAccounts');
  if (accountsAnswer) accounts.mockReturnValue(accountsAnswer);
  else
    accounts.mockResolvedValue({
      items: [
        account(trust, 'Trust Wallet', kinds[trust] ?? null),
        account(cold, 'Cold storage', kinds[cold] ?? null),
        ...more,
      ],
      nextCursor: null,
    });
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(valuation);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue(list);
  vi.spyOn(walletAddressesApi, 'syncRuns').mockResolvedValue([]);
  vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue({
    total: 0,
    offset: 0,
    limit: 50,
    nextOffset: null,
    missingUsdValueCount: 0,
    items: [],
  });
  vi.spyOn(operationsApi, 'list').mockResolvedValue(noOperations);
  render(
    <MemoryRouter initialEntries={[entry]}>
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
  forgetReads();
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
    expect(row).toHaveTextContent('bc1qar…5mdq');
    expect(row).toHaveTextContent('0.01 BTC');
    expect(row).toHaveTextContent('$800.00');
    expect(row).toHaveTextContent('Synced');
    expect(row).toHaveTextContent('8 min ago');
    expect(trustCard).toHaveTextContent('USDT tracked by hand');
    expect(trustCard).toHaveTextContent('1,000 USDT');
    // Each coin is its own piece of a wrapping cell, so a long list never runs into the value.
    expect(within(trustCard).getByText('1,000 USDT').parentElement).toHaveClass('wallets-amounts');
    // SYNC-RECONCILE: 0.01 BTC on the chain against 0.0098 BTC recorded.
    const note = within(trustCard).getByRole('note');
    expect(note).toHaveTextContent('Balance differs by 0.0002 BTC');
    expect(note).toHaveTextContent(
      'The blockchain shows 0.01 BTC; your transactions in this wallet give 0.0098 BTC.',
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

  it('W4 copies an address from its row without opening the wallet', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup([wallet(1, {})]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    await user.click(
      within(trustCard).getByRole('button', { name: 'Copy address of Trust Wallet BTC' }),
    );
    expect(writeText).toHaveBeenCalledWith(addresses.trust);
    expect(await within(trustCard).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    expect(row).toHaveClass('ui-row');
    expect(row).toHaveTextContent('bc1qar…5mdq · Synced');
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

  it('DIALOG-CLOSE closes Add wallet from the ✕ at the right of the title', async () => {
    setup([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Add wallet' })).toBeNull();
  });

  it('ADD-PICK opens Add wallet once when Portfolio sends Crypto here', async () => {
    setup([wallet(1, {})], portfolio(), {}, [], {
      pathname: '/wallets',
      state: { addWallet: true },
    });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Add wallet' });
    expect(walletAddressesApi.list).toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Add wallet' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeInTheDocument();
  });

  it('leaves a property account to Real estate (v8)', async () => {
    const studio = id(12);
    const valuation = portfolio();
    valuation.accounts.push({
      accountId: studio,
      name: 'Studio',
      coverage: 'covered',
      pricedValue: '90000',
      missingPriceCount: 0,
    });
    setup([wallet(1, {})], valuation, {}, [], '/wallets', [
      { ...account(studio, 'Studio', null), assetClass: 'property' },
    ]);
    expect(await screen.findByRole('region', { name: 'Trust Wallet' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Studio' })).toBeNull());
    expect(screen.getByRole('region', { name: 'Cold storage' })).toBeInTheDocument();
  });

  it('never shows a property account as a wallet, even while the accounts are on their way', async () => {
    // Codex P2: the class decides where an account belongs, so the cards wait for it.
    const studio = id(12);
    const valuation = portfolio();
    valuation.accounts.push({
      accountId: studio,
      name: 'Studio',
      coverage: 'covered',
      pricedValue: '90000',
      missingPriceCount: 0,
    });
    let answer: (page: Awaited<ReturnType<typeof accountingApi.listAccounts>>) => void = () => {};
    setup(
      [wallet(1, {})],
      valuation,
      {},
      [],
      '/wallets',
      [],
      new Promise((resolve) => (answer = resolve)),
    );
    await waitFor(() => expect(walletAddressesApi.list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('region', { name: 'Studio' })).toBeNull();
    answer({
      items: [
        account(trust, 'Trust Wallet', null),
        account(cold, 'Cold storage', null),
        { ...account(studio, 'Studio', null), assetClass: 'property' },
      ],
      nextCursor: null,
    });
    expect(await screen.findByRole('region', { name: 'Trust Wallet' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Studio' })).toBeNull();
  });

  it('W1 shows how each wallet is held in its header', async () => {
    setup([wallet(1, {})], portfolio(), { [trust]: 'hardware' });
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    await waitFor(() =>
      expect(trustCard).toHaveTextContent('Hardware wallet · Bitcoin · 1 address'),
    );
    // A wallet the owner has not described keeps the plain line.
    expect(card('Cold storage')).toHaveTextContent('Tracked by hand');
    expect(card('Cold storage')).not.toHaveTextContent(/wallet · Tracked|Exchange · Tracked/);
  });

  it('W1 sends the chosen kind with a new wallet; a changed kind is a new request', async () => {
    setup([]);
    // wallets-01: the new wallet travels with its address, in the same request.
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ created: false, address: wallet(4, { accountId: id(12) }) });
    const sent = (call: number) => add.mock.calls[call][0].newAccount as NewWalletAccount;
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText(/^Wallet/), 'Ledger');
    await user.selectOptions(within(dialog).getByLabelText(/How you hold it/), 'hardware');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(sent(0)).toEqual(sent(1));
    expect(sent(0)).toMatchObject({ name: 'Ledger', kind: 'hardware' });
    await within(dialog).findByRole('alert');
    // Another kind for the same name cannot reuse the earlier request.
    await user.selectOptions(within(dialog).getByLabelText(/How you hold it/), 'software');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(3));
    expect(sent(2)).toMatchObject({ name: 'Ledger', kind: 'software' });
    expect(sent(2).requestId).not.toBe(sent(0).requestId);
  });

  it('W1 leaves the kind out when none is chosen, and for a wallet that already exists', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add').mockResolvedValue({
      created: false,
      address: wallet(4, { accountId: id(12) }),
    });
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    expect(within(dialog).queryByLabelText(/How you hold it/)).toBeNull();
    await user.clear(within(dialog).getByLabelText(/^Wallet/));
    await user.type(within(dialog).getByLabelText(/^Wallet/), 'Ledger');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0][0].newAccount).toMatchObject({ name: 'Ledger' });
    expect(add.mock.calls[0][0].newAccount).not.toHaveProperty('kind');
  });

  it('creates a new wallet once for the typed name', async () => {
    setup([]);
    const create = vi.spyOn(accountingApi, 'createAccount');
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
    // wallets-01: one request carries the new wallet; a retry repeats its request id.
    expect(create).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0][0]).toEqual(add.mock.calls[1][0]);
    expect(add).toHaveBeenLastCalledWith({
      network: 'bitcoin',
      address: addresses.fresh,
      newAccount: { requestId: expect.any(String), name: 'Ledger' },
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
    expect(drawer).toHaveTextContent(shortValue(addresses.loose));
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
    // A problem the background job stored is read in place, not announced as an interruption.
    expect(within(drawer).queryByRole('alert')).toBeNull();
    expect(within(drawer).getByRole('note')).toHaveTextContent(
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

  it('WAL-ADD tracks an Ethereum address with ETH and every token', async () => {
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
    expect(ethereum).toHaveTextContent('One address. ETH and every token');
    await user.click(ethereum);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Ethereum wallet address');
    expect(field).toHaveAttribute('placeholder', '0x…');
    expect(dialog).toHaveTextContent('tracks ETH and every ERC-20 token on Ethereum mainnet');
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
    expect(drawer).toHaveTextContent('Tracked assetsETH, USDT, USDC and every other token');
    expect(drawer).toHaveTextContent('Etherscan');
  });

  it('ETH-STAKE-BALANCE counts ETH in a staking pool in the balance and names the pool', async () => {
    // A synthetic pool contract.
    const pool = `0x${'7c'.repeat(20)}`;
    const staked = ethWallet({
      staking: {
        symbol: 'ETH',
        quantity: '1.002000000000000000',
        rewards: '0.002000000000000000',
        accounts: [
          {
            account: pool,
            validator: null,
            pool: 'ocsETH',
            state: 'active',
            quantity: '1.002000000000000000',
            rewards: '0.002000000000000000',
          },
        ],
      },
    });
    setup([wallet(1, {}), staked], withEther());
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const row = within(trustCard).getByRole('button', { name: `Main ETH ${ethAddress}` });
    expect(row).toHaveTextContent('1.5 ETH · 250 USDC1.002 ETH staked');

    const user = userEvent.setup();
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    const staking = within(drawer).getByRole('region', { name: 'Staking' });
    expect(staking).toHaveTextContent('Available0.498 ETH');
    expect(staking).toHaveTextContent('Staked1.002 ETH');
    expect(staking).toHaveTextContent('Rewards so far0.002 ETH');
    const list = within(staking).getByRole('list', { name: 'Staking pools' });
    const [item] = within(list).getAllByRole('listitem');
    expect(item).toHaveTextContent('0x7c7…7c7c');
    expect(item).toHaveTextContent('ocsETH staking pool');
    expect(item).toHaveTextContent('Active');
    expect(staking).toHaveTextContent('moving it into a staking pool or back is not a sale');
  });

  it('POOL-DEPOSIT counts coins in liquidity pools in the balance and lists them', async () => {
    const pooled = ethWallet({
      pools: [
        { symbol: 'ETH', quantity: '1' },
        { symbol: 'USDC', quantity: '3000' },
      ],
    });
    setup([wallet(1, {}), pooled], withEther());
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const row = within(trustCard).getByRole('button', { name: `Main ETH ${ethAddress}` });
    expect(row).toHaveTextContent('1.5 ETH · 250 USDC1 ETH · 3,000 USDC in pools');

    const user = userEvent.setup();
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    const pools = within(drawer).getByRole('region', { name: 'Liquidity pools' });
    expect(pools).toHaveTextContent('In pools1 ETH');
    expect(pools).toHaveTextContent('In pools3,000 USDC');
    expect(pools).toHaveTextContent('until a pool withdrawal returns them');
    expect(within(drawer).queryByRole('region', { name: 'Staking' })).not.toBeInTheDocument();
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

  it('WAL-ADD tracks a Solana address with SOL and every token, case kept', async () => {
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
    expect(solana).toHaveTextContent('One address. SOL and every token');
    await user.click(solana);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Solana wallet address');
    expect(dialog).toHaveTextContent('tracks SOL and every SPL token on Solana mainnet');
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
    expect(drawer).toHaveTextContent('Tracked assetsSOL, USDT, USDC and every other token');
    expect(drawer).toHaveTextContent('Solana public RPC');
  });

  it('SOL-STAKE-BALANCE counts staked SOL in the balance and lists each stake account', async () => {
    // Synthetic stake and vote account keys.
    const stakeAccount = 'StakeAccSynthetic8Key8Number8Two11111111111';
    const validator = 'Vote8Synthetic8Validator8Key8Three11111111';
    const staked = solWallet({
      staking: {
        symbol: 'SOL',
        quantity: '10.040000000',
        rewards: '0.040000000',
        accounts: [
          {
            account: stakeAccount,
            validator,
            state: 'active',
            quantity: '10.040000000',
            rewards: '0.040000000',
          },
        ],
      },
    });
    setup([wallet(1, {}), staked], withSol());
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const row = within(trustCard).getByRole('button', { name: `Main SOL ${solAddress}` });
    expect(row).toHaveTextContent('12.5 SOL · 40 USDT10.04 SOL staked');
    // The records hold 12.5 SOL like the chain, stake included: SOL is not reported as differing.
    expect(within(trustCard).getByRole('note')).not.toHaveTextContent('SOL');

    const user = userEvent.setup();
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Solana' });
    // The headline balance is the whole balance; the Staking section breaks it down.
    expect(within(drawer).getByText('12.5 SOL · 40 USDT')).toBeInTheDocument();
    const staking = within(drawer).getByRole('region', { name: 'Staking' });
    expect(staking).toHaveTextContent('Available2.46 SOL');
    expect(staking).toHaveTextContent('Staked10.04 SOL');
    expect(staking).toHaveTextContent('Rewards so far0.04 SOL');
    const [item] = within(staking).getAllByRole('listitem');
    expect(item).toHaveTextContent('StakeA…1111');
    expect(item).toHaveTextContent('Validator Vote8S…1111');
    expect(item).toHaveTextContent('10.04 SOL');
    expect(item).toHaveTextContent('Active');
    expect(staking).toHaveTextContent('moving it into a stake account or back is not a sale');
  });
});

describe('Tron wallets', () => {
  // Base58check of the SHA-256 of a fixed label: a synthetic account, never an owner's wallet.
  const tronAddress = 'TKtDzrC3Hw7WVmzzeQtkvSknuV16HZGafR';
  const tronWallet = (changes: Partial<WalletAddress>) =>
    wallet(7, {
      network: 'tron',
      address: tronAddress,
      label: 'Main TRX',
      chainBalance: '2012.500000',
      balances: [
        { symbol: 'TRX', quantity: '2012.500000' },
        { symbol: 'USDT', quantity: '300.000000' },
        { symbol: 'USDC', quantity: '0.000000' },
      ],
      ...changes,
    });

  it('TRON-ADD tracks a Tron address with TRX, USDT and USDC, case kept', async () => {
    setup([]);
    const added = tronWallet({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const tron = within(dialog).getByRole('button', { name: /^Tron/ });
    expect(tron).toHaveTextContent('One address. TRX, USDT, USDC and staking');
    await user.click(tron);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Tron wallet address');
    expect(dialog).toHaveTextContent('tracks TRX, USDT and USDC on Tron mainnet');
    await user.type(field, tronAddress);
    expect(within(dialog).getByText('Tron address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({ network: 'tron', address: tronAddress, accountId: trust });
  });

  it('WAL-INVALID refuses the hex form and saves nothing', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: /^Tron/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(
      within(dialog).getByLabelText('Tron wallet address'),
      '416cc0027fd992863e7472490919d2769e0aa0e8d9',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText(/the hex form of a Tron address/)).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('TRON-STAKE-BALANCE counts staked TRX and splits it by resource', async () => {
    const staked = tronWallet({
      staking: {
        symbol: 'TRX',
        quantity: '1100.000000',
        rewards: '3.200000',
        reportedQuantity: null,
        unclaimedRewards: '1.250000',
        accounts: [
          {
            account: 'energy',
            kind: 'energy',
            validator: null,
            pool: null,
            state: 'active',
            quantity: '800.000000',
            rewards: '0.000000',
            availableAt: null,
          },
          {
            account: 'bandwidth',
            kind: 'bandwidth',
            validator: null,
            pool: null,
            state: 'active',
            quantity: '250.000000',
            rewards: '0.000000',
            availableAt: null,
          },
          {
            account: 'unstaking-1',
            kind: 'unstaking',
            validator: null,
            pool: null,
            state: 'deactivating',
            quantity: '50.000000',
            rewards: '0.000000',
            availableAt: '2026-10-20T08:00:00.000Z',
          },
        ],
      },
    });
    setup([wallet(1, {}), staked]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const row = within(trustCard).getByRole('button', { name: `Main TRX ${tronAddress}` });
    expect(row).toHaveTextContent('2,012.5 TRX · 300 USDT1,100 TRX staked');

    const user = userEvent.setup();
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Tron' });
    expect(drawer).toHaveTextContent('Tracked assetsTRX, USDT, USDC');
    expect(drawer).toHaveTextContent('TronGrid');
    const staking = within(drawer).getByRole('region', { name: 'Staking' });
    expect(staking).toHaveTextContent('Available912.5 TRX');
    expect(staking).toHaveTextContent('Staked1,100 TRX');
    expect(staking).toHaveTextContent('Rewards claimed3.2 TRX');
    expect(staking).toHaveTextContent('Not claimed yet1.25 TRX');
    const list = within(staking).getByRole('list', { name: 'Staked TRX' });
    const [energy, bandwidth, unstaking] = within(list).getAllByRole('listitem');
    expect(energy).toHaveTextContent('Staked for energy');
    expect(energy).toHaveTextContent('800 TRX');
    expect(energy).toHaveTextContent('Active');
    expect(bandwidth).toHaveTextContent('Staked for bandwidth');
    expect(unstaking).toHaveTextContent('Back to the balance on Oct 20, 2026');
    expect(unstaking).toHaveTextContent('Unstaking');
    expect(staking).toHaveTextContent('Energy and bandwidth are not assets');
    expect(staking).toHaveTextContent('rewards not claimed yet are not counted');
    expect(staking).not.toHaveTextContent('Tron reports');
  });

  it('says when the chain reports a different staked amount', async () => {
    const differs = tronWallet({
      staking: {
        symbol: 'TRX',
        quantity: '1100.000000',
        rewards: '0.000000',
        reportedQuantity: '1105.000000',
        unclaimedRewards: null,
        accounts: [],
      },
    });
    setup([differs]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main TRX ${tronAddress}` }));
    const staking = within(screen.getByRole('dialog')).getByRole('region', { name: 'Staking' });
    expect(staking).toHaveTextContent(
      "Tron reports 1,105 TRX staked; the wallet's transactions explain 1,100 TRX.",
    );
    expect(staking).not.toHaveTextContent('Not claimed yet');
  });

  it('TRON-STAKE-STATE shows TRX the transactions do not explain and keeps a negative minus', async () => {
    // More was staked than the listed receipts explain: TRX also arrived in a way TronGrid
    // does not list.
    const missing = tronWallet({
      chainBalance: '1000.000000',
      balances: [
        { symbol: 'TRX', quantity: '1000.000000' },
        { symbol: 'USDT', quantity: '0.000000' },
        { symbol: 'USDC', quantity: '0.000000' },
      ],
      reportedBalance: '1150.000000',
      staking: {
        symbol: 'TRX',
        quantity: '1100.000000',
        rewards: '0.000000',
        reportedQuantity: null,
        unclaimedRewards: null,
        accounts: [],
      },
    });
    setup([missing]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main TRX ${tronAddress}` }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent(
      'Tron reports 1,150 TRX at this address, staked included; its transactions explain 1,000 TRX. 150 TRX arrived in transfers TronGrid does not list',
    );
    const staking = within(drawer).getByRole('region', { name: 'Staking' });
    expect(staking).toHaveTextContent('Available-100 TRX');
  });

  it('says nothing about the chain total when it matches the transactions', async () => {
    setup([tronWallet({ reportedBalance: null })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main TRX ${tronAddress}` }));
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Tron reports');
  });
});

describe('Stellar wallets (M23)', () => {
  // StrKey of the SHA-256 of a fixed label: a synthetic account, never an owner's wallet.
  const stellarAddress = 'GDVAYF5L5VO3TB4443DGK74NKBY547UED3O3537NINFDO4TBNHIUV3HD';
  const stellarWallet = (changes: Partial<WalletAddress>) =>
    wallet(8, {
      network: 'stellar',
      address: stellarAddress,
      label: 'Main XLM',
      chainBalance: '1250.5000000',
      balances: [{ symbol: 'XLM', quantity: '1250.5000000' }],
      ...changes,
    });

  it('STELLAR-ADD tracks a "G…" account with its XLM', async () => {
    setup([]);
    const added = stellarWallet({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const stellar = within(dialog).getByRole('button', { name: /^Stellar/ });
    expect(stellar).toHaveTextContent('One address. XLM');
    await user.click(stellar);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Stellar wallet address');
    expect(dialog).toHaveTextContent('issued assets such as USDC on Stellar are not read');
    await user.type(field, stellarAddress);
    expect(within(dialog).getByText('Stellar account')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({
      network: 'stellar',
      address: stellarAddress,
      accountId: trust,
    });
  });

  it('shows the XLM balance and source, and says when Stellar reports another one', async () => {
    setup([stellarWallet({ reportedBalance: '1300.0000000' })]);
    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: `Main XLM ${stellarAddress}` });
    expect(row).toHaveTextContent('1,250.5 XLM');
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Stellar' });
    expect(drawer).toHaveTextContent('Stellar Horizon');
    expect(drawer).toHaveTextContent(
      'Stellar reports 1,300 XLM; the transactions read give 1,250.5 XLM.',
    );
  });
});

describe('M21: Bitcoin wallets by account public key', () => {
  // The BIP-84 test vector's account key and its first receiving address, never an owner's wallet.
  const zpub =
    'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
  const first = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
  const keyed = wallet(5, {
    address: zpub,
    label: 'Trezor BTC',
    accountKey: {
      prefix: 'zpub',
      derivedAddresses: 47,
      usedAddresses: 5,
      alsoTracked: [{ id: id(30), address: first, label: 'Old Trezor address' }],
    },
  });

  it('XPUB-LIST shows how many addresses of the key were used', async () => {
    setup([keyed]);
    const row = await within(
      await screen.findByRole('region', { name: 'Trust Wallet' }),
    ).findByRole('button', { name: `Trezor BTC ${zpub}` });
    expect(row).toHaveTextContent('5 addresses');
    expect(row).toHaveTextContent('0.01 BTC');
  });

  it('XPUB-LIST names the used addresses instead of the key on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    setup([keyed]);
    const row = await screen.findByRole('button', { name: `Trezor BTC ${zpub}` });
    expect(row).toHaveClass('ui-row');
    expect(row).toHaveTextContent('5 addresses · Synced');
    expect(row).not.toHaveTextContent('zpub');
  });

  it('XPUB-OVERLAP shows the key in the drawer and warns about addresses tracked twice', async () => {
    setup([keyed]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Trezor BTC ${zpub}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Bitcoin' });
    expect(drawer).toHaveTextContent(`Public key${shortValue(zpub)}`);
    expect(drawer).toHaveTextContent('5 used · new ones are found automatically');
    // A standing warning, not an interruption: read in place as a note.
    expect(within(drawer).queryByRole('alert')).toBeNull();
    expect(within(drawer).getByRole('note')).toHaveTextContent(
      'One address of this key is also tracked as its own wallet (Old Trezor address), so their coins count twice.',
    );
  });

  it('XPUB-ADD tracks a zpub and refuses a private or testnet key', async () => {
    setup([]);
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: { ...keyed, accountKey: null } });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(keyed));
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    const field = within(dialog).getByLabelText('Bitcoin wallet address');
    await user.click(field);
    await user.paste(`tpub${zpub.slice(4)}`);
    // The refusal waits for the owner to leave the field.
    expect(within(dialog).queryByText(/Testnet keys are not tracked/)).not.toBeInTheDocument();
    await user.tab();
    expect(within(dialog).getByText(/Testnet keys are not tracked/)).toBeInTheDocument();
    await user.click(field);
    await user.clear(field);
    await user.paste(`zprv${zpub.slice(4)}`);
    expect(field).toHaveValue('');
    expect(add).not.toHaveBeenCalled();

    await user.paste(zpub);
    expect(
      within(dialog).getByText(/every address of this account will be tracked/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    expect(dialog).toHaveTextContent(`Public key${zpub}`);
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({ network: 'bitcoin', address: zpub, accountId: trust });
  });
});

describe('M22: Bybit accounts', () => {
  // Synthetic key, secret and user ID; never an owner's.
  const apiKey = 'SyntheticKey0001';
  const apiSecret = 'SyntheticSecret000000000000001';
  const bybit = id(12);
  const exchangeAccount = (changes: Partial<WalletAddress>) =>
    wallet(6, {
      network: 'bybit',
      address: '123456789',
      accountId: bybit,
      label: 'Bybit',
      chainBalance: '0.50999',
      balances: [
        { symbol: 'BTC', quantity: '0.50999' },
        { symbol: 'ETH', quantity: '0' },
        { symbol: 'SOL', quantity: '0' },
        { symbol: 'USDT', quantity: '599' },
        { symbol: 'USDC', quantity: '0' },
      ],
      exchange: {
        keyHint: '0001',
        ipBound: false,
        keyExpiresAt: '2027-01-01T00:00:00.000Z',
        reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        untracked: [{ symbol: 'S', quantity: '5' }],
        historyFrom: '2024-10-10T00:00:00.000Z',
      },
      ...changes,
    });
  const withBybit = (): PortfolioValuation => {
    const valuation = portfolio();
    return {
      ...valuation,
      assets: valuation.assets.map((item) => ({
        ...item,
        holdings: [
          ...item.holdings,
          {
            accountId: bybit,
            accountName: 'Bybit',
            quantity: item.symbol === 'BTC' ? '0.50999' : '399',
            value: null,
          },
        ],
      })),
      accounts: [
        ...valuation.accounts,
        { ...valuation.accounts[0], accountId: bybit, name: 'Bybit' },
      ],
    };
  };
  const openBybit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const option = within(dialog).getByRole('button', { name: /^Bybit/ });
    expect(option).toBeEnabled();
    expect(option).toHaveTextContent(
      'Read-only API key. Every coin: trades, deposits and withdrawals',
    );
    await user.click(option);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    return dialog;
  };

  it('BYBIT-KEY adds an account with a read-only key; the secret is a password field', async () => {
    setup([]);
    const added = exchangeAccount({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    const sync = vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const create = vi.spyOn(accountingApi, 'createAccount');
    const user = userEvent.setup();
    const dialog = await openBybit(user);
    expect(dialog).toHaveTextContent(
      'Set permissions to Read-Only and tick Earn and Exchange History under it, so coins in Earn and converts count. Tick nothing that trades or withdraws.',
    );
    expect(dialog).toHaveTextContent('Bind it to this server');
    const secret = within(dialog).getByLabelText('API secret');
    expect(secret).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Paste the API key.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('API key'), ` ${apiKey}`);
    await user.click(secret);
    await user.paste(apiSecret);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByLabelText('Wallet (optional)')).toHaveAttribute(
      'placeholder',
      'Bybit',
    );
    expect(dialog).toHaveTextContent('API key…0001');
    expect(dialog).not.toHaveTextContent(apiSecret);
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // W1: a new Bybit account starts as an exchange; wallets-01: it is made with the key.
    expect(add).toHaveBeenCalledWith({
      network: 'bybit',
      apiKey,
      apiSecret,
      newAccount: { requestId: expect.any(String), name: 'Bybit', kind: 'exchange' },
    });
    expect(create).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith(added.id);
  });

  it('BYBIT-KEY shows why the server refused a key and keeps the form', async () => {
    setup([]);
    const refusal = Object.assign(new Error('Unprocessable'), {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          message:
            'This key can trade or withdraw. Create a read-only API key in Bybit and paste that one.',
        },
      },
    });
    vi.spyOn(walletAddressesApi, 'add').mockRejectedValue(refusal);
    const user = userEvent.setup();
    const dialog = await openBybit(user);
    await user.type(within(dialog).getByLabelText('API key'), apiKey);
    await user.type(within(dialog).getByLabelText('API secret'), apiSecret);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This key can trade or withdraw. Create a read-only API key in Bybit and paste that one.',
    );
  });

  it('WAL-NO-SECRETS drops a seed phrase pasted as the API secret', async () => {
    setup([]);
    const add = vi.spyOn(walletAddressesApi, 'add');
    const user = userEvent.setup();
    const dialog = await openBybit(user);
    const secret = within(dialog).getByLabelText('API secret');
    await user.click(secret);
    await user.paste(seedPhrase);
    expect(secret).toHaveValue('');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'This looks like a seed phrase. Never share it: the app needs only a read-only API key. It was not saved.',
    );
    expect(add).not.toHaveBeenCalled();
  });

  it('BYBIT-GAPS lists the coins Bybit reports and the difference from the records', async () => {
    setup([exchangeAccount({})], withBybit());
    const account = await screen.findByRole('region', { name: 'Bybit' });
    const row = within(account).getByRole('button', { name: 'Bybit 123456789' });
    expect(row).toHaveTextContent('UID 123456789');
    expect(row).toHaveTextContent('0.50999 BTC · 599 USDT');
    expect(row).not.toHaveTextContent('ETH');
    expect(account).toHaveTextContent('Bybit · 1 account');
    const gap = within(account).getByRole('note');
    expect(gap).toHaveTextContent('Balance differs by 200 USDT');
    expect(gap).toHaveTextContent(
      'Bybit reports 599 USDT; your transactions in this wallet give 399 USDT. Add what Bybit does not report, such as P2P purchases or Earn yield older than three months, as transactions by hand.',
    );
  });

  it('ASSET-HIDE: a coin the owner hid is no difference of the exchange', async () => {
    const valuation = withBybit();
    const hiddenUsdt = [
      { instrumentId: id(9), name: 'Tether', symbol: 'USDT', hiddenAt: '2026-10-11T10:00:00.000Z' },
    ];
    setup(
      [exchangeAccount({})],
      { ...valuation, assets: valuation.assets.filter((item) => item.symbol !== 'USDT') },
      {},
      hiddenUsdt,
    );
    const account = await screen.findByRole('region', { name: 'Bybit' });
    await waitFor(() => expect(hiddenAssetsApi.list).toHaveBeenCalled());
    await screen.findByText('Bybit · 1 account');
    expect(within(account).queryByRole('note')).not.toBeInTheDocument();
  });

  it('ASSET-HIDE: no balance is compared while the hidden list cannot be read', async () => {
    setup([exchangeAccount({})], withBybit(), {}, 'unread');
    const account = await screen.findByRole('region', { name: 'Bybit' });
    await waitFor(() => expect(hiddenAssetsApi.list).toHaveBeenCalled());
    await screen.findByText('Bybit · 1 account');
    expect(within(account).queryByRole('note')).not.toBeInTheDocument();
  });

  it('ASSET-HIDE: a later refresh that cannot read the hidden list stops the comparison', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = new Date().toISOString();
      const loading = wallet(1, {
        chainBalance: null,
        sync: {
          state: 'partial',
          completedAt: null,
          status: 'syncing',
          lastAttemptAt: now,
          lastSuccessAt: null,
          nextRunAt: now,
          errorMessage: null,
        },
      });
      setup([exchangeAccount({}), loading], withBybit(), {}, []);
      const account = await screen.findByRole('region', { name: 'Bybit' });
      expect(await within(account).findByRole('note')).toHaveTextContent(
        'Balance differs by 200 USDT',
      );
      // The owner hid USDT elsewhere; the next refresh cannot read the list.
      vi.mocked(hiddenAssetsApi.list).mockRejectedValue(new Error('unavailable'));
      forgetReads();
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(within(account).queryByRole('note')).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('BYBIT-ANY-COIN compares any coin Bybit reports or the records hold', async () => {
    const valuation = withBybit();
    const ton = (accountId: string, quantity: string) =>
      asset({
        instrumentId: id(7),
        name: 'TON',
        symbol: 'TON',
        price: { value: '3', observedAt: null, source: 'bybit', status: 'fresh' },
        quantity,
        value: null,
        holdings: [{ accountId, accountName: 'Bybit', quantity, value: null }],
      });
    const doge = asset({
      instrumentId: id(8),
      name: 'DOGE',
      symbol: 'DOGE',
      quantity: '40',
      value: null,
      holdings: [{ accountId: bybit, accountName: 'Bybit', quantity: '40', value: null }],
    });
    setup(
      [
        exchangeAccount({
          balances: [
            { symbol: 'BTC', quantity: '0.50999' },
            { symbol: 'ETH', quantity: '0' },
            { symbol: 'SOL', quantity: '0' },
            { symbol: 'USDT', quantity: '399' },
            { symbol: 'USDC', quantity: '0' },
            { symbol: 'TON', quantity: '12.5' },
          ],
        }),
      ],
      { ...valuation, assets: [...valuation.assets, ton(bybit, '10'), doge] },
    );
    const account = await screen.findByRole('region', { name: 'Bybit' });
    const row = within(account).getByRole('button', { name: 'Bybit 123456789' });
    // TOKEN-SHOW-MORE: two coins, the third behind the toggle.
    expect(row).toHaveTextContent('0.50999 BTC · 399 USDT');
    expect(row).not.toHaveTextContent('TON');
    await userEvent.setup().click(within(account).getByRole('button', { name: 'Show 1 more' }));
    expect(row).toHaveTextContent('0.50999 BTC · 399 USDT · 12.5 TON');
    const note = within(account).getByRole('note');
    expect(note).toHaveTextContent(
      'Bybit reports 12.5 TON; your transactions in this wallet give 10 TON',
    );
    expect(note).toHaveTextContent(
      'Bybit reports 0 DOGE; your transactions in this wallet give 40 DOGE',
    );
  });

  it('BYBIT-COUNT-GAP counts the difference as records of the account, one request per coin', async () => {
    const valuation = withBybit();
    const doge = asset({
      instrumentId: id(8),
      name: 'DOGE',
      symbol: 'DOGE',
      quantity: '40',
      value: null,
      holdings: [{ accountId: bybit, accountName: 'Bybit', quantity: '40', value: null }],
    });
    setup([exchangeAccount({})], { ...valuation, assets: [...valuation.assets, doge] });
    const count = vi.spyOn(walletAddressesApi, 'countGap').mockResolvedValue(exchangeAccount({}));
    const account = await screen.findByRole('region', { name: 'Bybit' });
    const user = userEvent.setup();
    expect(within(account).getByRole('note')).toHaveTextContent(
      'each coin becomes one record of this account, without a purchase price',
    );
    await user.click(within(account).getByRole('button', { name: 'Count the difference' }));
    const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
    expect(count.mock.calls).toEqual([
      [
        exchangeAccount({}).id,
        { requestId: uuid, coin: 'USDT', direction: 'in', quantity: '200', reported: '599' },
      ],
      [
        exchangeAccount({}).id,
        { requestId: uuid, coin: 'DOGE', direction: 'out', quantity: '40', reported: '0' },
      ],
    ]);
    // The wallets are read again, so the counted records show.
    await waitFor(() => expect(walletAddressesApi.list).toHaveBeenCalledTimes(2));
  });

  it('BYBIT-COUNT-GAP keeps the request id for a retry and says when a coin could not be counted', async () => {
    setup([exchangeAccount({})], withBybit());
    const count = vi
      .spyOn(walletAddressesApi, 'countGap')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(exchangeAccount({}));
    const account = await screen.findByRole('region', { name: 'Bybit' });
    const user = userEvent.setup();
    await user.click(within(account).getByRole('button', { name: 'Count the difference' }));
    expect(await within(account).findByRole('alert')).toHaveTextContent(
      'Could not count every coin',
    );
    await user.click(within(account).getByRole('button', { name: 'Count the difference' }));
    await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
    expect(count.mock.calls[1][1].requestId).toBe(count.mock.calls[0][1].requestId);
  });

  it('BYBIT-COUNT-GAP is not offered for a wallet that is not one Bybit account', async () => {
    setup([wallet(1, { chainBalance: '0.5' })], withBybit());
    expect(await screen.findByRole('note')).toHaveTextContent('Balance differs');
    expect(screen.queryByRole('button', { name: 'Count the difference' })).toBeNull();
  });

  it('shows the key, its expiry and the untracked coins in the drawer, never the secret', async () => {
    setup([exchangeAccount({})], withBybit());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bybit 123456789' }));
    const drawer = screen.getByRole('dialog', { name: 'Bybit · Bybit' });
    expect(drawer).toHaveTextContent('Bybit UID123456789');
    expect(drawer).toHaveTextContent('API key…0001 · read-only, stored encrypted');
    expect(drawer).toHaveTextContent('Key expiresJan 1, 2027');
    expect(drawer).toHaveTextContent('As Bybit reported them 5 min ago');
    expect(drawer).toHaveTextContent('Not tracked5 S · not counted');
    expect(drawer).toHaveTextContent(
      'Tracked assetsEvery coin the account holds; Bybit prices the ones Kraken does not list',
    );
    expect(drawer).toHaveTextContent('Bybit records');
  });

  it('BYBIT-EARN shows the coins in Earn, already in the balance, in the row and the drawer', async () => {
    setup(
      [
        exchangeAccount({
          exchange: {
            keyHint: '0001',
            ipBound: true,
            keyExpiresAt: null,
            reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
            untracked: [],
            historyFrom: '2024-10-10T00:00:00.000Z',
            earnAllowed: true,
            earn: [
              { symbol: 'USDT', quantity: '200', product: 'flexible' },
              { symbol: 'SOL', quantity: '0.5', product: 'onchain' },
              { symbol: 'USDC', quantity: '100', product: 'fixed' },
            ],
          },
        }),
      ],
      withBybit(),
    );
    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: 'Bybit 123456789' });
    expect(row).toHaveTextContent('200 USDT · 0.5 SOL · 100 USDC in Earn');
    await user.click(row);
    const earn = within(screen.getByRole('dialog', { name: 'Bybit · Bybit' })).getByRole('region', {
      name: 'Earn',
    });
    expect(earn).toHaveTextContent('Flexible Savings200 USDT');
    expect(earn).toHaveTextContent('On-chain Earn0.5 SOL');
    expect(earn).toHaveTextContent('Fixed-term savings100 USDC');
    expect(earn).toHaveTextContent(
      'Coins in Bybit Earn stay yours: they count in this balance and in net worth. Yield Bybit paid in the last three months is recorded as staking income by itself; Bybit lists no older yield.',
    );
  });

  it('BYBIT-EARN says how to let a key read Earn', async () => {
    setup(
      [
        exchangeAccount({
          exchange: {
            keyHint: '0001',
            ipBound: true,
            keyExpiresAt: null,
            reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
            untracked: [],
            historyFrom: '2024-10-10T00:00:00.000Z',
            earnAllowed: false,
            earn: null,
          },
        }),
      ],
      withBybit(),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bybit 123456789' }));
    const drawer = screen.getByRole('dialog', { name: 'Bybit · Bybit' });
    expect(within(drawer).queryByRole('region', { name: 'Earn' })).toBeNull();
    expect(drawer).toHaveTextContent(
      'This key cannot read Earn, so coins in Bybit Earn are not counted. In Bybit, edit the key, tick Earn under Read-Only and press Sync now; no need to add the account again.',
    );
  });

  it('BYBIT-CONVERT says how to let a key read convert history', async () => {
    const exchange = {
      keyHint: '0001',
      ipBound: true,
      keyExpiresAt: null,
      reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      untracked: [],
      historyFrom: '2024-10-10T00:00:00.000Z',
      earnAllowed: true,
      earn: [],
    };
    const note =
      'This key cannot read convert history, so coins converted on Bybit are missing from the records. In Bybit, edit the key, tick Exchange History under Read-Only and press Sync now; no need to add the account again.';
    setup([exchangeAccount({ exchange: { ...exchange, convertAllowed: false } })], withBybit());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bybit 123456789' }));
    expect(screen.getByRole('dialog', { name: 'Bybit · Bybit' })).toHaveTextContent(note);
    cleanup();
    setup([exchangeAccount({ exchange: { ...exchange, convertAllowed: true } })], withBybit());
    await user.click(await screen.findByRole('button', { name: 'Bybit 123456789' }));
    expect(screen.getByRole('dialog', { name: 'Bybit · Bybit' })).not.toHaveTextContent(
      'cannot read convert history',
    );
  });

  it('SYNC-STATUS says a key Bybit stopped accepting must be added again', async () => {
    const message =
      'Bybit did not accept the API key: it may have expired or been deleted. Add the account again with a new read-only key.';
    setup(
      [
        exchangeAccount({
          sync: {
            state: 'complete',
            completedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
            status: 'failed',
            lastAttemptAt: null,
            lastSuccessAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
            nextRunAt: null,
            errorMessage: message,
          },
        }),
      ],
      withBybit(),
    );
    const account = await screen.findByRole('region', { name: 'Bybit' });
    expect(account).toHaveTextContent(`${message} Balances shown are from 3 h ago.`);
  });
});

describe('Zcash wallets (M24)', () => {
  // Base58Check of the SHA-256 of a fixed label: a synthetic address, never an owner's wallet.
  const zcashAddress = 't1T2xng63Qs7DtbK4cNwLsjWtMmciMZWTc5';
  const zcashWallet = (changes: Partial<WalletAddress>) =>
    wallet(9, {
      network: 'zcash',
      address: zcashAddress,
      label: 'Main ZEC',
      chainBalance: '12.50000000',
      balances: [{ symbol: 'ZEC', quantity: '12.50000000' }],
      ...changes,
    });

  it('ZCASH-ADD tracks a transparent address and says shielded balances cannot be read', async () => {
    setup([]);
    const added = zcashWallet({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const zcash = within(dialog).getByRole('button', { name: /^Zcash/ });
    expect(zcash).toHaveTextContent('One transparent address. ZEC');
    await user.click(zcash);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Zcash wallet address');
    expect(dialog).toHaveTextContent('Shielded balances are private, so the app cannot read them');
    await user.type(field, `zs1${'q'.repeat(75)}`);
    await user.tab();
    expect(within(dialog).getByText(/This is a shielded address/)).toBeInTheDocument();
    await user.click(field);
    await user.clear(field);
    await user.type(field, zcashAddress);
    expect(within(dialog).getByText('Transparent address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({ network: 'zcash', address: zcashAddress, accountId: trust });
  });

  it('shows the ZEC balance and source, and that it is the transparent balance', async () => {
    setup([zcashWallet({})]);
    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: `Main ZEC ${zcashAddress}` });
    expect(row).toHaveTextContent('12.5 ZEC');
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Zcash' });
    expect(drawer).toHaveTextContent('Trezor Blockbook');
    expect(drawer).toHaveTextContent('This is the balance of the transparent address.');
  });
});

describe('EVM-MULTICHAIN: the same 0x address on another chain', () => {
  const address = `0x${'5e'.repeat(20)}`;
  const baseWallet = (changes: Partial<WalletAddress> = {}) =>
    wallet(8, {
      network: 'base',
      address,
      label: 'Base ETH',
      chainBalance: '0.250000000000000000',
      balances: [
        { symbol: 'ETH', quantity: '0.250000000000000000' },
        { symbol: 'USDC', quantity: '40.000000' },
      ],
      ...changes,
    });

  it('adds the address as a wallet of the chosen chain, checked like an Ethereum address', async () => {
    setup([]);
    const added = baseWallet({ transactionCount: 0, chainBalance: null, balances: null });
    const add = vi
      .spyOn(walletAddressesApi, 'add')
      .mockResolvedValue({ created: true, address: added });
    vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(synced(added));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    const base = within(dialog).getByRole('button', { name: /^Base/ });
    expect(base).toHaveTextContent('The same 0x address. ETH and every token');
    expect(within(dialog).getByRole('button', { name: /^Arbitrum One/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^OP Mainnet/ })).toBeInTheDocument();
    for (const [name, coin] of [
      ['Polygon', 'POL'],
      ['BNB Smart Chain', 'BNB'],
      ['Avalanche C-Chain', 'AVAX'],
    ]) {
      expect(
        within(dialog).getByRole('button', { name: new RegExp(`^${name}`) }),
      ).toHaveTextContent(`The same 0x address. ${coin} and every token`);
    }
    await user.click(base);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const field = within(dialog).getByLabelText('Base wallet address');
    expect(dialog).toHaveTextContent('Paste the same 0x address you use on Ethereum');
    await user.type(field, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    await user.tab();
    expect(within(dialog).getByText(/This is not an Ethereum address/)).toBeInTheDocument();
    await user.click(field);
    await user.clear(field);
    await user.type(field, address);
    expect(within(dialog).getByText('Ethereum address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Trust Wallet' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(add).toHaveBeenCalledWith({ network: 'base', address, accountId: trust });
  });

  it('shows the chain’s balances and that Etherscan is its source', async () => {
    setup([baseWallet()]);
    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: `Base ETH ${address}` });
    expect(row).toHaveTextContent('0.25 ETH · 40 USDC');
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Base' });
    expect(drawer).toHaveTextContent('Etherscan');
  });

  it('shows a chain with its own coin by that coin, not as ETH', async () => {
    setup([
      baseWallet({
        network: 'bnb',
        label: 'Chain BNB',
        chainBalance: '1.500000000000000000',
        balances: [
          { symbol: 'BNB', quantity: '1.500000000000000000' },
          { symbol: 'USDT', quantity: '12.000000000000000000' },
        ],
      }),
    ]);
    const row = await screen.findByRole('button', { name: `Chain BNB ${address}` });
    expect(row).toHaveTextContent('1.5 BNB · 12 USDT');
  });
});

describe('TOKEN-HIDE and TOKEN-SHOW-MORE: spam tokens in an Ethereum wallet', () => {
  const ethAddress = `0x${'5e'.repeat(20)}`;
  const spam = (symbol: string, listed = false) => ({
    symbol,
    quantity: '5.000000',
    name: `${symbol} token`,
    listed,
  });
  const holder = (changes: Partial<WalletAddress> = {}) =>
    wallet(6, {
      network: 'ethereum',
      address: ethAddress,
      label: 'Main ETH',
      chainBalance: '1.500000000000000000',
      balances: [
        { symbol: 'ETH', quantity: '1.500000000000000000' },
        { symbol: 'USDT', quantity: '12.000000' },
        { symbol: 'USDC', quantity: '3.000000' },
        spam('AAA'),
        spam('BBB'),
        spam('WRAP', true),
      ],
      hiddenTokens: [{ symbol: 'USDT1A2B', name: 'Tether', quantity: '-40', reason: 'lookalike' }],
      ...changes,
    });
  const valuation = () => {
    const base = portfolio();
    return {
      ...base,
      assets: [
        ...base.assets,
        asset({
          instrumentId: id(3),
          name: 'Ethereum',
          symbol: 'ETH',
          price: { value: '2000', observedAt: null, source: 'kraken', status: 'fresh' },
        }),
        asset({
          instrumentId: id(4),
          name: 'USD Coin',
          symbol: 'USDC',
          price: { value: '1', observedAt: null, source: 'fixed', status: 'fixed' },
        }),
      ],
    };
  };

  it('lists two coins and the rest behind "Show N more", and counts the hidden tokens', async () => {
    setup([holder()], valuation());
    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: `Main ETH ${ethAddress}` });
    expect(row).toHaveTextContent('1.5 ETH · 12 USDT');
    expect(row).not.toHaveTextContent('USDC');
    expect(screen.getByText('1 hidden token')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Show 4 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(row).toHaveTextContent('1.5 ETH · 12 USDT · 3 USDC · 5 AAA · 5 BBB · 5 WRAP');
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(row).not.toHaveTextContent('USDC');
  });

  it('does not list a hidden token again as a coin tracked by hand, nor count it', async () => {
    const base = valuation();
    const withSpam = {
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
    };
    setup([holder()], withSpam);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    expect(trustCard).toHaveTextContent('BTC tracked by hand');
    expect(trustCard).not.toHaveTextContent('USDT1A2B');
    expect(within(trustCard).getByText('2 assets')).toBeInTheDocument();
  });

  it('shows no toggle for two coins or fewer', async () => {
    setup(
      [holder({ balances: [{ symbol: 'ETH', quantity: '1.5' }, spam('AAA')], hiddenTokens: [] })],
      valuation(),
    );
    await screen.findByRole('button', { name: `Main ETH ${ethAddress}` });
    expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull();
  });

  it('hides one token from the drawer and shows the balances the server returns', async () => {
    const after = holder({
      balances: [
        { symbol: 'ETH', quantity: '1.5' },
        { symbol: 'USDT', quantity: '12.000000' },
        { symbol: 'USDC', quantity: '3.000000' },
        spam('BBB'),
        spam('WRAP', true),
      ],
      hiddenTokens: [
        { symbol: 'AAA', name: 'AAA token', quantity: '5', reason: 'owner' },
        { symbol: 'USDT1A2B', name: 'Tether', quantity: '-40', reason: 'lookalike' },
      ],
    });
    setup([holder()], valuation());
    const hide = vi.spyOn(walletAddressesApi, 'tokens').mockResolvedValue(after);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    expect(drawer).toHaveTextContent('AAA token · no price');
    expect(within(drawer).getByText('WRAP token')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Hide AAA' }));
    expect(hide).toHaveBeenCalledWith(holder().id, ['AAA'], 'hidden');
    await waitFor(() =>
      expect(
        within(drawer).getByRole('heading', { name: 'Hidden tokens (2)' }),
      ).toBeInTheDocument(),
    );
    expect(within(drawer).queryByRole('button', { name: 'Hide AAA' })).toBeNull();
    // The hidden tokens stay folded away until asked for.
    expect(within(drawer).queryByRole('button', { name: 'Restore AAA' })).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Show more' }));
    expect(within(drawer).getByRole('button', { name: 'Restore AAA' })).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Show less' }));
    expect(within(drawer).queryByRole('button', { name: 'Restore AAA' })).toBeNull();
  });

  it('hides every token no price source lists at once, and not the listed one', async () => {
    setup([holder()], valuation());
    const hide = vi.spyOn(walletAddressesApi, 'tokens').mockResolvedValue(holder());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    await user.click(
      within(drawer).getByRole('button', { name: 'Hide 2 tokens no price source lists' }),
    );
    expect(hide).toHaveBeenCalledWith(holder().id, ['AAA', 'BBB'], 'hidden');
  });

  it('says why the app hid a token and brings it back on request', async () => {
    setup(
      [
        holder({
          hiddenTokens: [
            { symbol: 'T', name: 'Spoof', quantity: '-3000', reason: 'negative' },
            { symbol: 'USDT1A2B', name: 'Tether', quantity: '40', reason: 'lookalike' },
            { symbol: 'AAA', name: 'AAA token', quantity: '5', reason: 'owner' },
            { symbol: 'DDD', name: 'DDD token', quantity: '9', reason: 'dust' },
          ],
        }),
      ],
      valuation(),
    );
    const restore = vi.spyOn(walletAddressesApi, 'tokens').mockResolvedValue(holder());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    expect(drawer).not.toHaveTextContent('Hidden by you');
    await user.click(within(drawer).getByRole('button', { name: 'Show more' }));
    expect(drawer).toHaveTextContent('the history sends out more than it received');
    expect(drawer).toHaveTextContent('calls itself like a coin you track');
    expect(drawer).toHaveTextContent('Hidden by you');
    expect(drawer).toHaveTextContent('worth less than your dust threshold');
    expect(drawer).toHaveTextContent('-3,000');
    await user.click(within(drawer).getByRole('button', { name: 'Restore T' }));
    expect(restore).toHaveBeenCalledWith(holder().id, ['T'], 'shown');
  });

  it('keeps the drawer and says nothing changed when the server refuses', async () => {
    setup([holder()], valuation());
    vi.spyOn(walletAddressesApi, 'tokens').mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    await user.click(within(drawer).getByRole('button', { name: 'Hide AAA' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Nothing was changed');
    expect(within(drawer).getByRole('button', { name: 'Hide AAA' })).toBeEnabled();
  });
});

describe('DRAWER-DUST: dust stays out of the blockchain transactions of an address', () => {
  const ethAddress = `0x${'7a'.repeat(20)}`;
  const holder = wallet(7, {
    network: 'ethereum',
    address: ethAddress,
    label: 'Main ETH',
    chainBalance: '1.500000000000000000',
    balances: [{ symbol: 'ETH', quantity: '1.500000000000000000' }],
    transactionCount: 4,
  });
  const row = (n: number, direction: 'in' | 'out', net: string, symbol = 'ETH') => ({
    txid: `0x${String(n).repeat(64).slice(0, 64)}`,
    blockHeight: 1000 - n,
    blockTime: `2026-10-0${n}T10:00:00.000Z`,
    direction,
    symbol,
    received: net,
    sent: '0',
    net,
    fee: '0',
    receivedBtc: net,
    sentBtc: '0',
    netBtc: net,
    feeBtc: '0',
    usdValue: null,
    usdValueStatus: 'missing' as const,
  });
  const page = (items: ReturnType<typeof row>[], nextOffset: number | null = null) => ({
    total: 4,
    offset: 0,
    limit: 50,
    nextOffset,
    missingUsdValueCount: 4,
    items,
  });
  const listed = (item: ReturnType<typeof row>, status: Operation['status']): Operation =>
    ({
      id: `chain:${holder.id}:${item.txid}`,
      kind: 'chain',
      status,
      wallet: { id: holder.id, network: 'ethereum', address: ethAddress, label: 'Main ETH' },
      chain: { txid: item.txid, blockHeight: item.blockHeight, direction: item.direction },
    }) as unknown as Operation;
  const sent = row(4, 'out', '-0.5');
  const received = row(3, 'in', '2');
  const junk = row(2, 'in', '0.000001', 'SPAM');
  const speck = row(1, 'in', '0.000002', 'SCAM');
  const open = async (
    pages: (offset: number) => ReturnType<typeof page>,
    operations: Operation[],
  ) => {
    setup([holder], portfolio());
    vi.spyOn(walletAddressesApi, 'transactions').mockImplementation(async (_id, offset = 0) =>
      pages(offset),
    );
    vi.spyOn(operationsApi, 'list').mockResolvedValue({ ...noOperations, operations });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const drawer = screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' });
    return { user, drawer };
  };

  it('leaves dust out of the list and shows it on request', async () => {
    const { user, drawer } = await open(
      () => page([sent, received, junk, speck]),
      [
        listed(sent, 'recorded'),
        listed(received, 'needs-classification'),
        listed(junk, 'dust'),
        listed(speck, 'dust'),
      ],
    );
    const section = within(drawer).getByRole('region', { name: 'Blockchain transactions' });
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(2));
    expect(section).not.toHaveTextContent('SPAM');
    const show = within(section).getByRole('button', { name: 'Show 2 dust transactions' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await user.click(show);
    expect(within(section).getAllByRole('listitem')).toHaveLength(4);
    expect(section).toHaveTextContent('SPAM');
    expect(section).toHaveTextContent('dust');
    await user.click(within(section).getByRole('button', { name: 'Hide dust' }));
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('reads older pages while dust leaves the list short', async () => {
    const seen: number[] = [];
    const { drawer } = await open(
      (offset) => {
        seen.push(offset);
        return offset === 0 ? page([junk, speck], 2) : page([sent, received]);
      },
      [
        listed(sent, 'recorded'),
        listed(received, 'recorded'),
        listed(junk, 'dust'),
        listed(speck, 'dust'),
      ],
    );
    const section = within(drawer).getByRole('region', { name: 'Blockchain transactions' });
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(2));
    expect(seen).toEqual([0, 2]);
    expect(section).not.toHaveTextContent('SPAM');
  });

  it('INFINITE: lists twenty transactions and twenty more on request, reading the server on demand', async () => {
    const many = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...row(3, 'in', '1'),
        txid: `0x${String(from + index).padStart(64, '0')}`,
      }));
    const seen: number[] = [];
    const { user, drawer } = await open((offset) => {
      seen.push(offset);
      // The server hands out its history in pieces of 30 here: 30, then 15.
      return offset === 0 ? page(many(0, 30), 30) : page(many(30, 15));
    }, []);
    const section = within(drawer).getByRole('region', { name: 'Blockchain transactions' });
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(20));
    expect(within(section).getByRole('status')).toHaveTextContent('Showing 20 transactions');
    await user.click(within(section).getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(40));
    await user.click(within(section).getByRole('button', { name: 'Show more' }));
    expect(within(section).getAllByRole('listitem')).toHaveLength(45);
    expect(within(section).queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(seen).toEqual([0, 30]);
  });

  it('opens a listed transaction in Transactions and shows the rest without a link', async () => {
    const { drawer } = await open(() => page([sent, received]), [listed(sent, 'recorded')]);
    const section = within(drawer).getByRole('region', { name: 'Blockchain transactions' });
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(2));
    const links = within(section).getAllByRole('link', { name: /Sent/ });
    expect(links[0]).toHaveAttribute(
      'href',
      `/transactions?open=${encodeURIComponent(`chain:${holder.id}:${sent.txid}`)}`,
    );
    // A leg the list folds into a swap or a transfer has no row of its own.
    expect(within(section).queryByRole('link', { name: /Received/ })).toBeNull();
  });

  it('shows every transaction when the list cannot be read', async () => {
    setup([holder], portfolio());
    vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue(page([sent, junk]));
    vi.spyOn(operationsApi, 'list').mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Main ETH ${ethAddress}` }));
    const section = within(
      screen.getByRole('dialog', { name: 'Trust Wallet · Ethereum' }),
    ).getByRole('region', { name: 'Blockchain transactions' });
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(2));
    expect(within(section).queryByRole('link', { name: /Sent|Received/ })).toBeNull();
  });
});

describe('UI audit: Wallets', () => {
  // An axios failure as the client sees it: a status when the server answered, none when not.
  const failure = (status?: number) =>
    Object.assign(new Error('failed'), {
      isAxiosError: true,
      response: status === undefined ? undefined : { status, data: {} },
    });
  const failing = () =>
    wallet(1, {
      sync: {
        ...wallet(1, {}).sync,
        status: 'failed',
        errorMessage: 'Bitcoin data is temporarily unavailable.',
      },
    });
  const keyApi = 'SyntheticKey0001';
  const keySecret = 'SyntheticSecret000000000000001';
  const openNetwork = async (user: ReturnType<typeof userEvent.setup>, network: RegExp) => {
    await user.click(await screen.findByRole('button', { name: 'Add wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.click(within(dialog).getByRole('button', { name: network }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    return dialog;
  };

  it('wallets-01 sends a new wallet with its address in one request, so a refused address leaves none', async () => {
    setup([]);
    const create = vi.spyOn(accountingApi, 'createAccount');
    const add = vi.spyOn(walletAddressesApi, 'add').mockRejectedValue(failure(400));
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText(/^Wallet/), 'Ledger');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This is not a valid Bitcoin address',
    );
    expect(create).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith({
      network: 'bitcoin',
      address: addresses.fresh,
      newAccount: { requestId: expect.any(String), name: 'Ledger' },
    });
  });

  it('wallets-01 moves an address into a new wallet in one request, so a refused save leaves none', async () => {
    const loose = wallet(2, { accountId: null, label: null, address: addresses.loose });
    setup([loose]);
    const create = vi.spyOn(accountingApi, 'createAccount');
    const update = vi.spyOn(walletAddressesApi, 'update').mockRejectedValue(failure(404));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Bitcoin ${addresses.loose}` }));
    const drawer = screen.getByRole('dialog', { name: 'Bitcoin address' });
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'New wallet…');
    await user.type(within(drawer).getByLabelText('New wallet name'), 'Ledger');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByText(/no longer exists/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(loose.id, {
      newAccount: { requestId: expect.any(String), name: 'Ledger' },
      label: null,
    });
  });

  it('wallets-02 keeps the keyboard on the row after Retry now and announces the result', async () => {
    setup([failing()]);
    let finish: (result: SyncResult) => void = () => undefined;
    vi.spyOn(walletAddressesApi, 'sync').mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    await user.click(within(trustCard).getByRole('button', { name: 'Retry now' }));
    expect(
      within(trustCard).getByRole('button', { name: `Trust Wallet BTC ${addresses.trust}` }),
    ).toHaveFocus();
    finish(synced(wallet(1, {})));
    expect(await screen.findByText('Trust Wallet BTC is synced.')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('wallets-20 tells a sync the server answered with 500 from one that got no answer', async () => {
    setup([failing()]);
    const sync = vi.spyOn(walletAddressesApi, 'sync').mockRejectedValueOnce(failure(500));
    const user = userEvent.setup();
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    await user.click(within(trustCard).getByRole('button', { name: 'Retry now' }));
    // wallets-02: a failure the owner just caused is announced.
    expect(await within(trustCard).findByRole('alert')).toHaveTextContent(
      /^The server could not finish the sync\. Try again\./,
    );
    sync.mockRejectedValueOnce(failure());
    await user.click(within(trustCard).getByRole('button', { name: 'Retry now' }));
    await waitFor(() =>
      expect(within(trustCard).getByRole('alert')).toHaveTextContent(
        /^Could not reach the server\. Try again\./,
      ),
    );
  });

  it('wallets-13 shows a failed source as an amber note with an alert icon', async () => {
    setup([failing()]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const note = within(trustCard)
      .getByText(/^Bitcoin data is temporarily unavailable\./)
      .closest('.wallets-message');
    expect(note).toHaveClass('ui-banner--warn');
    expect(note).not.toHaveClass('ui-banner--neg');
    expect(note?.querySelector('svg.shell-icon')).not.toBeNull();
  });

  it('wallets-07 confirms a new wallet, never lists its address as not in a wallet, and moves to it', async () => {
    setup([]);
    const ledger = id(12);
    const added = wallet(3, {
      address: addresses.fresh,
      accountId: ledger,
      label: null,
      transactionCount: 0,
      chainBalance: null,
      sync: { ...wallet(3, {}).sync, state: 'never', completedAt: null },
    });
    const valuation = portfolio();
    valuation.accounts.push({
      accountId: ledger,
      name: 'Ledger',
      coverage: 'not-started',
      pricedValue: null,
      missingPriceCount: 0,
    });
    vi.spyOn(walletAddressesApi, 'add').mockImplementation(async () => {
      vi.mocked(walletAddressesApi.list).mockResolvedValue([added]);
      vi.mocked(portfolioValuationApi.get).mockResolvedValue(valuation);
      return { created: true, address: added };
    });
    vi.spyOn(walletAddressesApi, 'sync').mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText(/^Wallet/), 'Ledger');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Not in a wallet yet' })).toBeNull();
    const ledgerCard = await screen.findByRole('region', { name: 'Ledger' });
    expect(screen.queryByRole('region', { name: 'Not in a wallet yet' })).toBeNull();
    await waitFor(() =>
      expect(within(ledgerCard).getByRole('link', { name: 'Ledger' })).toHaveFocus(),
    );
    expect(screen.getByText('Wallet added. Syncing transactions…')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it("wallets-07 still shows a new wallet's address when the page cannot reload after adding it", async () => {
    setup([]);
    const added = wallet(3, {
      address: addresses.fresh,
      accountId: id(12),
      label: null,
      transactionCount: 0,
      chainBalance: null,
      sync: { ...wallet(3, {}).sync, state: 'never', completedAt: null },
    });
    vi.spyOn(walletAddressesApi, 'add').mockImplementation(async () => {
      vi.mocked(walletAddressesApi.list).mockRejectedValue(new Error('offline'));
      return { created: true, address: added };
    });
    vi.spyOn(walletAddressesApi, 'sync').mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    await user.type(within(dialog).getByLabelText('Bitcoin wallet address'), addresses.fresh);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.type(within(dialog).getByLabelText(/^Wallet/), 'Ledger');
    await user.click(within(dialog).getByRole('button', { name: 'Add wallet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The address the server saved stays on the page until a reload can place it in its wallet.
    expect(
      await screen.findByRole('button', { name: new RegExp(addresses.fresh) }),
    ).toBeInTheDocument();
  });

  it('wallets-08 offers to connect the Bybit API from a Bybit wallet tracked by hand', async () => {
    const bybit = id(13);
    const valuation = portfolio();
    valuation.accounts.push({
      accountId: bybit,
      name: 'Bybit',
      coverage: 'covered',
      pricedValue: '50',
      missingPriceCount: 0,
    });
    valuation.assets[1].holdings.push({
      accountId: bybit,
      accountName: 'Bybit',
      quantity: '50',
      value: '50',
    });
    setup([wallet(1, {})], valuation, {}, [], '/wallets', [account(bybit, 'Bybit', 'exchange')]);
    const user = userEvent.setup();
    const bybitCard = await screen.findByRole('region', { name: 'Bybit' });
    // Another wallet tracked by hand is not a Bybit account.
    expect(
      within(card('Trust Wallet')).queryByRole('button', { name: 'Connect Bybit API' }),
    ).toBeNull();
    await user.click(within(bybitCard).getByRole('button', { name: 'Connect Bybit API' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('API key'), keyApi);
    await user.type(within(dialog).getByLabelText('API secret'), keySecret);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByLabelText(/^Wallet/)).toHaveValue('Bybit');
  });

  it('wallets-08 connects the Bybit wallet it was opened from, not another of the same name', async () => {
    const ledger = id(14);
    const bybit = id(13);
    const valuation = portfolio();
    for (const accountId of [ledger, bybit]) {
      valuation.accounts.push({
        accountId,
        name: 'Bybit',
        coverage: 'covered',
        pricedValue: '50',
        missingPriceCount: 0,
      });
      valuation.assets[1].holdings.push({
        accountId,
        accountName: 'Bybit',
        quantity: '25',
        value: '25',
      });
    }
    setup([wallet(1, {})], valuation, {}, [], '/wallets', [
      account(ledger, 'Bybit', 'hardware'),
      account(bybit, 'Bybit', null),
    ]);
    const add = vi.spyOn(walletAddressesApi, 'add').mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Bybit' })).toHaveLength(2));
    const [hardware, unset] = screen.getAllByRole('region', { name: 'Bybit' });
    // A hardware wallet named Bybit is no Bybit account; one without a kind may be.
    await waitFor(() =>
      expect(within(unset).getByRole('button', { name: 'Connect Bybit API' })).toBeVisible(),
    );
    expect(within(hardware).queryByRole('button', { name: 'Connect Bybit API' })).toBeNull();
    await user.click(within(unset).getByRole('button', { name: 'Connect Bybit API' }));
    const dialog = screen.getByRole('dialog', { name: 'Add wallet' });
    await user.type(within(dialog).getByLabelText('API key'), keyApi);
    await user.type(within(dialog).getByLabelText('API secret'), keySecret);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ accountId: bybit }));
  });

  it('wallets-09 describes each row with its balance, value and sync status', async () => {
    setup([wallet(1, {})]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const row = within(trustCard).getByRole('button', {
      name: `Trust Wallet BTC ${addresses.trust}`,
    });
    expect(row).toHaveAccessibleDescription(/0\.01 BTC.*\$800\.00.*Synced.*8 min ago/);
  });

  it('wallets-12 shows the design short form with the full address as its tooltip', async () => {
    setup([wallet(1, {})]);
    const trustCard = await screen.findByRole('region', { name: 'Trust Wallet' });
    const place = within(trustCard).getAllByText('bc1qar…5mdq')[0];
    expect(place).toHaveAttribute('title', addresses.trust);
  });

  it('wallets-04 puts the keyboard on the address a failed Continue refused, and says why aloud', async () => {
    setup([]);
    const user = userEvent.setup();
    const dialog = await openAddWallet(user);
    const field = within(dialog).getByLabelText('Bitcoin wallet address');
    await user.type(field, 'bc1qinvalidsyntheticaddress');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(field).toHaveFocus();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'This is not a valid Bitcoin address',
    );
  });

  it('wallets-04 puts the keyboard on the Bybit key a failed Continue refused', async () => {
    setup([]);
    const user = userEvent.setup();
    const dialog = await openNetwork(user, /^Bybit/);
    await user.type(within(dialog).getByLabelText('API secret'), keySecret);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByLabelText('API key')).toHaveFocus();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Paste the API key.');
  });

  it('wallets-06 offers to switch to the network the address belongs to', async () => {
    setup([]);
    const user = userEvent.setup();
    const dialog = await openNetwork(user, /^Ethereum/);
    await user.type(within(dialog).getByLabelText('Ethereum wallet address'), addresses.trust);
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Switch to Bitcoin' }));
    expect(within(dialog).getByLabelText('Bitcoin wallet address')).toHaveValue(addresses.trust);
    expect(within(dialog).getByText('Native SegWit address')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Step 3 of 3')).toBeInTheDocument();
  });

  it('wallets-14 shows and hides the API secret', async () => {
    setup([]);
    const user = userEvent.setup();
    const dialog = await openNetwork(user, /^Bybit/);
    const secret = within(dialog).getByLabelText('API secret');
    expect(secret).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Show secret' }));
    expect(secret).toHaveAttribute('type', 'text');
    await user.click(within(dialog).getByRole('button', { name: 'Hide secret' }));
    expect(secret).toHaveAttribute('type', 'password');
  });

  it('wallets-21 says which wallet was removed and puts the keyboard on that message', async () => {
    setup([wallet(1, {})], portfolio(), {}, [], {
      pathname: '/wallets',
      state: { removedWallet: 'Old wallet' },
    });
    const said = await screen.findByText('Old wallet was removed.');
    expect(said).toHaveAttribute('role', 'status');
    await waitFor(() => expect(said).toHaveFocus());
  });
});
