import { type OperationList, operationsApi } from '@api/operations.api';
import { forgetReads } from '@api/read-cache';
import {
  type AddressTransaction,
  type TransactionPage,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayText } from '@/utils/dates';
import { DASH } from '../portfolio/format';
import AddressDrawer from './AddressDrawer';
import type { SyncRun } from './SyncStatus';
import { addressValue } from './WalletParts';
import { shortAddress } from './wallets';

// Synthetic ids, names, addresses, keys and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = id(10);
const btc = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const loose = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const accounts = [
  { accountId: trust, name: 'Trust Wallet' },
  { accountId: id(11), name: 'Cold storage' },
];

const tracked = (changes: Partial<WalletAddress> = {}): WalletAddress => ({
  id: id(20),
  network: 'bitcoin',
  address: btc,
  accountId: trust,
  label: 'Trust Wallet BTC',
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01',
  balances: [{ symbol: 'BTC', quantity: '0.01' }],
  sync: {
    state: 'complete',
    completedAt: '2026-10-05T12:00:00.000Z',
    status: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    errorMessage: null,
  },
  ...changes,
});

const exchange = (changes: Partial<NonNullable<WalletAddress['exchange']>> = {}) =>
  tracked({
    network: 'bybit',
    address: '123456789',
    accountId: null,
    label: 'Bybit',
    balances: [{ symbol: 'BTC', quantity: '0.5' }],
    exchange: {
      keyHint: '0001',
      ipBound: false,
      keyExpiresAt: null,
      reportedAt: null,
      untracked: [],
      historyFrom: '2024-10-10T00:00:00.000Z',
      ...changes,
    },
  });

const row = (
  txid: string,
  direction: AddressTransaction['direction'],
  net: string,
  symbol = 'BTC',
): AddressTransaction => ({
  txid,
  blockHeight: 1000,
  blockTime: '2026-10-03T10:00:00.000Z',
  direction,
  symbol,
  received: net.startsWith('-') ? '0' : net,
  sent: net.startsWith('-') ? net.slice(1) : '0',
  net,
  fee: '0',
  receivedBtc: '0',
  sentBtc: '0',
  netBtc: '0',
  feeBtc: '0',
  usdValue: null,
  usdValueStatus: 'missing',
});

const page = (items: AddressTransaction[], nextOffset: number | null = null): TransactionPage => ({
  total: items.length,
  offset: 0,
  limit: 50,
  nextOffset,
  missingUsdValueCount: items.length,
  items,
});

const noOperations: OperationList = {
  at: '2026-10-05T12:00:00.000Z',
  quoteCurrency: 'USD',
  needsClassificationCount: 0,
  dustThresholdUsd: null,
  operations: [],
};

const failure = (status?: number) =>
  Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data: {} },
  });

function open(
  address: WalletAddress,
  { run, prices = new Map<string, string>() }: { run?: SyncRun; prices?: Map<string, string> } = {},
) {
  const handlers = {
    onSync: vi.fn(),
    onSyncEnabled: vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined),
    onSaved: vi.fn(),
    onRemoved: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <MemoryRouter>
      <AddressDrawer
        address={address}
        accounts={accounts}
        currency="USD"
        prices={prices}
        run={run}
        {...handlers}
      />
    </MemoryRouter>,
  );
  return { ...handlers, drawer: screen.getByRole('dialog'), user: userEvent.setup() };
}

const hero = (drawer: HTMLElement) => drawer.querySelector('.wallets-hero') as HTMLElement;
const history = (drawer: HTMLElement, name = 'Blockchain transactions') =>
  within(drawer).getByRole('region', { name });

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.spyOn(operationsApi, 'list').mockResolvedValue(noOperations);
  vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue(page([]));
});
afterEach(() => {
  cleanup();
});

describe('WAL-ACCOUNT: the address drawer', () => {
  it('is titled by its wallet, or as an address or an account without one', () => {
    open(tracked());
    expect(screen.getByRole('dialog', { name: 'Trust Wallet · Bitcoin' })).toBeInTheDocument();
    cleanup();
    open(tracked({ accountId: null }));
    expect(screen.getByRole('dialog', { name: 'Bitcoin address' })).toBeInTheDocument();
    cleanup();
    open(exchange());
    expect(screen.getByRole('dialog', { name: 'Bybit account' })).toBeInTheDocument();
  });

  it('shows a dash until the whole history is loaded', () => {
    const { drawer } = open(tracked({ chainBalance: null, balances: null }));
    expect(hero(drawer)).toHaveTextContent(
      `${DASH} BTCThe balance appears once the whole history is loaded.`,
    );
    cleanup();
    const unread = open({ ...exchange(), chainBalance: null, balances: null });
    expect(hero(unread.drawer).textContent).toBe(
      `${DASH}The balance appears once the whole history is loaded.`,
    );
  });

  it('shows the balance with its value, or that no price is known yet', async () => {
    const coins = tracked({
      network: 'ethereum',
      address: `0x${'7a'.repeat(20)}`,
      balances: [
        { symbol: 'ETH', quantity: '1.5' },
        { symbol: 'USDT', quantity: '10' },
        { symbol: 'USDC', quantity: '20' },
        { symbol: 'DAI', quantity: '30' },
      ],
    });
    const { drawer, user } = open(coins);
    expect(hero(drawer).textContent).toBe('1.5 ETH · 10 USDTNo price yetShow 2 more');
    await user.click(within(hero(drawer)).getByRole('button', { name: 'Show 2 more' }));
    expect(hero(drawer).textContent).toBe(
      '1.5 ETH · 10 USDT · 20 USDC · 30 DAINo price yetShow less',
    );
    cleanup();
    const prices = new Map([['BTC', '80000']]);
    const priced = open(tracked(), { prices });
    const value = addressValue(tracked(), prices, 'USD');
    expect(value).not.toBe(DASH);
    expect(hero(priced.drawer).textContent).toBe(`0.01 BTC${value}`);
  });

  it('lists the details of an address', () => {
    const { drawer } = open(tracked());
    expect(drawer).toHaveTextContent('NetworkBitcoin');
    expect(drawer).not.toHaveTextContent('Tracked assets');
    expect(within(drawer).getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
    expect(drawer).not.toHaveTextContent('Addresses');
    expect(drawer).toHaveTextContent('Transactions3');
    expect(drawer).toHaveTextContent('Data sourceBlockstream Esplora');
    expect(drawer).toHaveTextContent('UpdatesEvery hour in the background');
    cleanup();
    const off = open(
      tracked({
        sync: { ...tracked().sync, off: { reason: 'manual', at: '2026-10-05T12:00:00.000Z' } },
      }),
    );
    expect(off.drawer).toHaveTextContent('UpdatesNot updated: sync is off');
  });

  it('lists the tokens an Ethereum address tracks', () => {
    const { drawer } = open(tracked({ network: 'ethereum', address: `0x${'7a'.repeat(20)}` }));
    expect(drawer).toHaveTextContent('Tracked assetsETH, USDT, USDC and every other token');
  });

  it('XPUB-OVERLAP shows a key with its used addresses and warns about addresses tracked twice', () => {
    const key = (alsoTracked: { id: string; address: string; label: string | null }[]) =>
      tracked({
        address: zpub,
        accountKey: { prefix: 'zpub', derivedAddresses: 25, usedAddresses: 5, alsoTracked },
      });
    const { drawer } = open(key([]));
    expect(within(drawer).getByRole('button', { name: 'Copy public key' })).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Public key');
    expect(drawer).toHaveTextContent('Addresses5 used · new ones are found automatically');
    expect(drawer).not.toHaveTextContent('count twice');
    cleanup();
    const one = open(key([{ id: id(30), address: btc, label: 'Spare BTC' }]));
    expect(one.drawer).toHaveTextContent(
      'One address of this key is also tracked as its own wallet (Spare BTC), so their coins count twice.',
    );
    cleanup();
    const two = open(
      key([
        { id: id(30), address: btc, label: 'Spare BTC' },
        { id: id(31), address: loose, label: null },
      ]),
    );
    expect(two.drawer).toHaveTextContent(
      `2 addresses of this key are also tracked as their own wallets (Spare BTC, ${shortAddress(loose)}), so their coins count twice.`,
    );
  });

  it('BYBIT-KEY lists the key, its expiry, the history and the untracked coins of an account', () => {
    const { drawer } = open(exchange());
    expect(drawer).toHaveTextContent(
      'Tracked assetsEvery coin the account holds; Bybit prices the ones Kraken does not list',
    );
    expect(drawer).toHaveTextContent('Bybit UID');
    expect(within(drawer).getByRole('button', { name: 'Copy UID' })).toBeInTheDocument();
    expect(drawer).toHaveTextContent('API key…0001 · read-only, stored encrypted');
    expect(drawer).toHaveTextContent('Key expiresUnknown');
    expect(drawer).toHaveTextContent(`History from${dayText('2024-10-10T00:00:00.000Z')}`);
    expect(drawer).not.toHaveTextContent('As Bybit reported them');
    expect(drawer).not.toHaveTextContent('Not tracked');
    cleanup();
    const bound = open(exchange({ ipBound: true, keyExpiresAt: '2027-01-01T00:00:00.000Z' }));
    expect(bound.drawer).toHaveTextContent('Key expiresNever: bound to an IP address');
    cleanup();
    const expiring = open(
      exchange({
        keyExpiresAt: '2027-01-01T00:00:00.000Z',
        reportedAt: '2026-10-05T12:00:00.000Z',
        untracked: [
          { symbol: 'S', quantity: '5' },
          { symbol: 'ZZ', quantity: '1.25' },
        ],
      }),
    );
    expect(expiring.drawer).toHaveTextContent(
      `Key expires${dayText('2027-01-01T00:00:00.000Z')}. Bind it to the server's IP address in Bybit to keep it.`,
    );
    expect(expiring.drawer).toHaveTextContent(/BalancesAs Bybit reported them \S/);
    expect(expiring.drawer).toHaveTextContent('Not tracked5 S · 1.25 ZZ · not counted');
  });

  it('SYNC-STATUS says a sync the owner ran failed aloud and a stored failure as a note', async () => {
    const { drawer } = open(tracked(), {
      run: { state: 'failed', message: 'Bitcoin data is temporarily unavailable.' },
    });
    expect(within(drawer).getByRole('alert')).toHaveTextContent(
      'Bitcoin data is temporarily unavailable.',
    );
    cleanup();
    const stored = open(
      tracked({
        sync: { ...tracked().sync, status: 'failed', errorMessage: 'Synthetic failure.' },
      }),
    );
    expect(within(stored.drawer).getByRole('note')).toHaveTextContent('Synthetic failure.');
  });
});

describe('WAL-ACCOUNT: the wallet and name of an address', () => {
  it('asks for a name before a new wallet is made', async () => {
    const update = vi.spyOn(walletAddressesApi, 'update');
    const { drawer, user } = open(tracked());
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'New wallet…');
    expect(within(drawer).getByLabelText('How you hold it (optional)')).toHaveValue('');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(drawer).toHaveTextContent('Enter a name for the new wallet.');
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'no answer',
      failure(),
      'Could not reach the server. The change may have been saved; saving it again is safe.',
    ],
    [
      'a missing address',
      failure(404),
      'This wallet or address no longer exists. Reload the page.',
    ],
    ['any other status', failure(500), 'Could not save. Check the name and try again.'],
  ])('says why a save failed: %s', async (_case, error, message) => {
    vi.spyOn(walletAddressesApi, 'update').mockRejectedValue(error);
    const { drawer, user, onSaved } = open(tracked());
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByText(message)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('moves an address, renames it and says it was saved', async () => {
    const saved = tracked({ accountId: id(11), label: 'Vault BTC' });
    let answer: (address: WalletAddress) => void = () => undefined;
    const update = vi
      .spyOn(walletAddressesApi, 'update')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { drawer, user, onSaved } = open(tracked());
    expect(within(drawer).getByLabelText('Address name (optional)')).toHaveValue(
      'Trust Wallet BTC',
    );
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'Cold storage');
    await user.clear(within(drawer).getByLabelText('Address name (optional)'));
    await user.type(within(drawer).getByLabelText('Address name (optional)'), ' Vault BTC ');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(within(drawer).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(update).toHaveBeenCalledWith(tracked().id, { accountId: id(11), label: 'Vault BTC' });
    answer(saved);
    expect(await within(drawer).findByText('Saved.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(saved, false);
    expect(within(drawer).getByLabelText('Wallet')).toHaveValue(id(11));
  });

  it('takes an address out of its wallet and clears an empty name', async () => {
    const saved = tracked({ accountId: null, label: null });
    const update = vi.spyOn(walletAddressesApi, 'update').mockResolvedValue(saved);
    const { drawer, user } = open(tracked());
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'Not chosen');
    await user.clear(within(drawer).getByLabelText('Address name (optional)'));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(tracked().id, { accountId: null, label: null });
    expect(await within(drawer).findByText('Saved.')).toBeInTheDocument();
    expect(within(drawer).getByLabelText('Wallet')).toHaveValue('');
  });

  it('W1 makes a new wallet with the move, keeping the request id for a retry', async () => {
    const saved = tracked({ accountId: id(12) });
    const update = vi
      .spyOn(walletAddressesApi, 'update')
      .mockRejectedValueOnce(failure(500))
      .mockResolvedValueOnce(saved);
    const { drawer, user, onSaved } = open(tracked());
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'New wallet…');
    await user.type(within(drawer).getByLabelText('New wallet name'), ' Vault ');
    await user.selectOptions(
      within(drawer).getByLabelText('How you hold it (optional)'),
      'hardware',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(
      await within(drawer).findByText('Could not save. Check the name and try again.'),
    ).toBeVisible();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByText('Saved.')).toBeInTheDocument();
    const [first, second] = update.mock.calls;
    expect(first).toEqual([
      tracked().id,
      {
        newAccount: { requestId: expect.any(String), name: 'Vault', kind: 'hardware' },
        label: 'Trust Wallet BTC',
      },
    ]);
    expect(second).toEqual(first);
    expect(onSaved).toHaveBeenCalledWith(saved, true);
    expect(within(drawer).queryByLabelText('New wallet name')).toBeNull();
  });

  it('W1 starts a new wallet of a Bybit account as an exchange and names the account', async () => {
    const update = vi.spyOn(walletAddressesApi, 'update').mockResolvedValue(exchange());
    const { drawer, user } = open(exchange());
    expect(within(drawer).getByLabelText('Account name (optional)')).toHaveValue('Bybit');
    await user.selectOptions(within(drawer).getByLabelText('Wallet'), 'New wallet…');
    await user.type(within(drawer).getByLabelText('New wallet name'), 'Exchanges');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(exchange().id, {
      newAccount: { requestId: expect.any(String), name: 'Exchanges', kind: 'exchange' },
      label: 'Bybit',
    });
  });
});

describe('DRAWER-HISTORY: the newest transactions of an address', () => {
  it('waits for the history, then lists each transaction with its direction and amount', async () => {
    let answer: (value: TransactionPage) => void = () => undefined;
    vi.spyOn(walletAddressesApi, 'transactions').mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    const { drawer } = open(tracked());
    expect(history(drawer)).toHaveTextContent('Loading…');
    answer(
      page([row('a1', 'in', '0.02'), row('a2', 'out', '-0.01'), row('a3', 'self', '-0.0001')]),
    );
    const items = await within(history(drawer)).findAllByRole('listitem');
    const day = dayText('2026-10-03T10:00:00.000Z');
    expect(items.map((item) => item.textContent)).toEqual([
      `Received ${day}+0.02 BTC`,
      `Sent ${day}-0.01 BTC`,
      `To itself ${day}-0.0001 BTC`,
    ]);
    expect(
      within(history(drawer)).getByRole('link', { name: 'All in Transactions' }),
    ).toHaveAttribute(
      'href',
      `/transactions?account=${encodeURIComponent(`wallet:${tracked().id}`)}`,
    );
  });

  it('says when the history could not be read', async () => {
    vi.spyOn(walletAddressesApi, 'transactions').mockRejectedValue(new Error('offline'));
    const { drawer } = open(tracked());
    expect(
      await within(history(drawer)).findByText('Could not load them; they are in Transactions.'),
    ).toBeInTheDocument();
  });

  it('says that nothing is loaded before a sync, without reading or linking', async () => {
    const transactions = vi.spyOn(walletAddressesApi, 'transactions');
    const { drawer } = open(tracked({ transactionCount: 0 }));
    expect(
      await within(history(drawer)).findByText('None loaded yet. They appear here after a sync.'),
    ).toBeInTheDocument();
    expect(transactions).not.toHaveBeenCalled();
    expect(within(history(drawer)).queryByRole('link')).toBeNull();
  });

  it('DRAWER-DUST says when the newest transactions are only dust, and that older pages may hold more', async () => {
    const speck = row('d1', 'in', '0.00000001', 'SCAM');
    const dust = {
      ...noOperations,
      operations: [
        {
          id: `chain:${tracked().id}:d1`,
          status: 'dust',
          wallet: { id: tracked().id },
          chain: { txid: 'd1', blockHeight: 1000, direction: 'in' },
        },
      ],
    } as unknown as OperationList;
    vi.spyOn(operationsApi, 'list').mockResolvedValue(dust);
    const transactions = vi
      .spyOn(walletAddressesApi, 'transactions')
      .mockResolvedValueOnce(page([speck]))
      .mockReturnValueOnce(new Promise(() => undefined));
    const { drawer } = open(tracked());
    expect(
      await within(history(drawer)).findByText('Only dust in the latest transactions.'),
    ).toBeInTheDocument();
    expect(
      within(history(drawer)).getByRole('button', { name: 'Show 1 dust transaction' }),
    ).toBeVisible();
    cleanup();
    transactions.mockReset();
    transactions
      .mockResolvedValueOnce(page([speck], 1))
      .mockReturnValueOnce(new Promise(() => undefined));
    const more = open(tracked());
    expect(
      await within(history(more.drawer)).findByRole('button', {
        name: 'Show 1+ dust transactions',
      }),
    ).toBeVisible();
    await waitFor(() => expect(transactions).toHaveBeenCalledWith(tracked().id, 1));
  });

  it('BYBIT-RECORDS names each Bybit record by what it is', async () => {
    vi.spyOn(walletAddressesApi, 'transactions').mockResolvedValue(
      page([
        row('bybit-trade-convert-1', 'in', '1', 'USDT'),
        row('bybit-trade-2', 'out', '-0.1'),
        row('bybit-earn-3', 'in', '0.001'),
        row('bybit-withdrawal-4', 'out', '-0.2'),
        row('bybit-deposit-5', 'in', '0.3'),
      ]),
    );
    const { drawer } = open(exchange());
    const items = await within(history(drawer, 'Bybit records')).findAllByRole('listitem');
    expect(items.map((item) => item.textContent?.split(' ')[0])).toEqual([
      'Convert',
      'Trade',
      'Earn',
      'Withdrawal',
      'Deposit',
    ]);
    expect(items[2]).toHaveTextContent(/^Earn yield /);
  });
});

describe('WALLET-SYNC-OFF: the drawer actions', () => {
  it('syncs now and switches the background sync off', async () => {
    let done: () => void = () => undefined;
    const view = open(tracked());
    view.onSyncEnabled.mockReturnValue(new Promise((resolve) => (done = resolve)));
    await view.user.click(within(view.drawer).getByRole('button', { name: 'Sync now' }));
    expect(view.onSync).toHaveBeenCalledOnce();
    await view.user.click(within(view.drawer).getByRole('button', { name: 'Turn sync off' }));
    expect(view.onSyncEnabled).toHaveBeenCalledWith(false);
    expect(within(view.drawer).getByRole('button', { name: 'Turning off…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    done();
    expect(await within(view.drawer).findByRole('button', { name: 'Turn sync off' })).toBeEnabled();
  });

  it('keeps both actions still while a sync runs', () => {
    const { drawer } = open(tracked(), { run: { state: 'running' } });
    expect(within(drawer).getByRole('button', { name: 'Syncing…' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: 'Turn sync off' })).toBeDisabled();
  });

  it('switches a sync that is off back on and offers no Sync now', async () => {
    let done: () => void = () => undefined;
    const view = open(
      tracked({
        sync: { ...tracked().sync, off: { reason: 'manual', at: '2026-10-05T12:00:00.000Z' } },
      }),
    );
    view.onSyncEnabled.mockReturnValue(new Promise((resolve) => (done = resolve)));
    expect(within(view.drawer).queryByRole('button', { name: 'Sync now' })).toBeNull();
    await view.user.click(within(view.drawer).getByRole('button', { name: 'Turn sync on' }));
    expect(view.onSyncEnabled).toHaveBeenCalledWith(true);
    expect(within(view.drawer).getByRole('button', { name: 'Turning on…' })).toBeDisabled();
    done();
    expect(await within(view.drawer).findByRole('button', { name: 'Turn sync on' })).toBeEnabled();
  });
});
