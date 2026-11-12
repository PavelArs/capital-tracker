import { accountingApi } from '@api/accounting.api';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { type SyncResult, type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import ToastViewport from '@components/Toast';
import { ToastProvider } from '@contexts/ToastContext';
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWallets } from './useWallets';

// Synthetic ids, names, addresses and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const address = (changes: Partial<WalletAddress> = {}): WalletAddress => ({
  id: id(20),
  network: 'bitcoin',
  address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  accountId: id(10),
  label: 'Trust Wallet BTC',
  createdAt: '2026-10-01T00:00:00.000Z',
  transactionCount: 3,
  chainBalance: '0.01',
  balances: null,
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

const portfolio: PortfolioValuation = {
  at: '2026-10-05T12:00:00.000Z',
  currency: 'USD',
  mainCurrency: 'USD',
  rates: [],
  completeness: 'complete',
  totalValue: '0',
  pricedSubtotal: '0',
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
  assets: [],
  allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
  accounts: [],
};

const result = (
  outcome: SyncResult['outcome'],
  changes: Partial<WalletAddress> = {},
  reason: SyncResult['reason'] = null,
): SyncResult => ({ outcome, reason, imported: 1, address: address(changes) });

const partial = { sync: { ...address().sync, state: 'partial' as const } };

const failure = (status?: number, data: unknown = {}) =>
  Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data },
  });

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <MemoryRouter>{children}</MemoryRouter>
      <ToastViewport />
    </ToastProvider>
  );
}

async function setup() {
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([address()]);
  vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({ items: [], nextCursor: null });
  const hook = renderHook(() => useWallets(), { wrapper });
  await waitFor(() => expect(hook.result.current.addresses).not.toBeNull());
  return hook;
}

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
});
afterEach(() => {
  cleanup();
});

describe('M11: Sync now in useWallets', () => {
  it('loads the history in requests until it is complete, then says it is synced', async () => {
    const { result: hook } = await setup();
    const sync = vi
      .spyOn(walletAddressesApi, 'sync')
      .mockResolvedValueOnce(result('partial', partial))
      .mockResolvedValueOnce(result('partial', partial))
      .mockResolvedValueOnce(result('complete', { label: null }));
    await act(() => hook.current.sync(id(20)));
    expect(sync).toHaveBeenCalledTimes(3);
    expect(hook.current.runs).toEqual({});
    expect(await screen.findByText('Bitcoin is synced')).toBeInTheDocument();
  });

  it('stops after forty requests and says nothing of a history still partial', async () => {
    const { result: hook } = await setup();
    const sync = vi.spyOn(walletAddressesApi, 'sync').mockResolvedValue(result('partial', partial));
    await act(() => hook.current.sync(id(20)));
    expect(sync).toHaveBeenCalledTimes(40);
    expect(hook.current.runs).toEqual({});
    expect(screen.queryByText(/is synced/)).toBeNull();
  });

  it('runs one sync of an address at a time', async () => {
    const { result: hook } = await setup();
    let answer: (value: SyncResult) => void = () => undefined;
    const sync = vi
      .spyOn(walletAddressesApi, 'sync')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = hook.current.sync(id(20));
    });
    expect(hook.current.runs[id(20)]).toEqual({ state: 'running' });
    await act(() => hook.current.sync(id(20)));
    expect(sync).toHaveBeenCalledOnce();
    await act(async () => {
      answer(result('complete'));
      await first;
    });
    expect(await screen.findByText('Trust Wallet BTC is synced')).toBeInTheDocument();
  });

  it.each([
    [
      'the stored reason',
      result(
        'provider_error',
        { sync: { ...address().sync, errorMessage: 'Synthetic reason.' } },
        'rate_limited',
      ),
      'Synthetic reason.',
    ],
    [
      'the source being busy',
      result('provider_error', {}, 'rate_limited'),
      'The Bitcoin data source is busy. Try again in a few minutes.',
    ],
    ['no reason', result('provider_error'), 'Bitcoin data is temporarily unavailable.'],
  ])('says the source failed with %s', async (_case, answer, message) => {
    const { result: hook } = await setup();
    const sync = vi
      .spyOn(walletAddressesApi, 'sync')
      .mockResolvedValueOnce(result('partial', partial))
      .mockResolvedValueOnce(answer);
    await act(() => hook.current.sync(id(20)));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(hook.current.runs[id(20)]).toEqual({ state: 'failed', message });
    expect(screen.queryByText(/is synced/)).toBeNull();
  });

  it.each([
    ['no answer', failure(), 'Could not reach the server. Try again.'],
    ['a plain error', new Error('offline'), 'Could not reach the server. Try again.'],
    [
      'a switched-off address',
      failure(409, { message: 'Sync is switched off for this address.' }),
      'Sync is switched off for this address. Turn it on to read it again.',
    ],
    [
      'another sync running',
      failure(409, { message: 'A sync is running.' }),
      'Another sync of this address is running. Try again in a moment.',
    ],
    [
      'a 409 without a message',
      failure(409, null),
      'Another sync of this address is running. Try again in a moment.',
    ],
    ['an ended session', failure(401), 'Your session has ended. Sign in again.'],
    ['a server error', failure(500), 'The server could not finish the sync. Try again.'],
  ])('wallets-20 says why Sync now failed: %s', async (_case, error, message) => {
    const { result: hook } = await setup();
    vi.spyOn(walletAddressesApi, 'sync').mockRejectedValue(error);
    await act(() => hook.current.sync(id(20)));
    expect(hook.current.runs[id(20)]).toEqual({ state: 'failed', message });
  });
});

describe('WALLET-SYNC-OFF: switching sync in useWallets', () => {
  it('says the sync is on and clears an earlier failure', async () => {
    const { result: hook } = await setup();
    vi.spyOn(walletAddressesApi, 'sync').mockRejectedValue(failure(500));
    await act(() => hook.current.sync(id(20)));
    expect(hook.current.runs[id(20)]?.state).toBe('failed');
    vi.spyOn(walletAddressesApi, 'setSyncEnabled').mockResolvedValue(address({ label: null }));
    await act(() => hook.current.setSyncEnabled(id(20), true));
    expect(hook.current.runs).toEqual({});
    expect(await screen.findByText('Sync is on for Bitcoin')).toBeInTheDocument();
  });

  it('says the sync is off and keeps a failure shown', async () => {
    const { result: hook } = await setup();
    vi.spyOn(walletAddressesApi, 'sync').mockRejectedValue(failure(500));
    await act(() => hook.current.sync(id(20)));
    vi.spyOn(walletAddressesApi, 'setSyncEnabled').mockResolvedValue(address());
    await act(() => hook.current.setSyncEnabled(id(20), false));
    expect(hook.current.runs[id(20)]?.state).toBe('failed');
    expect(await screen.findByText('Sync is off for Trust Wallet BTC')).toBeInTheDocument();
  });

  it.each([
    [true, 'Could not turn sync on. Try again.'],
    [false, 'Could not turn sync off. Try again.'],
  ])('says when switching the sync to %s failed', async (enabled, message) => {
    const { result: hook } = await setup();
    vi.spyOn(walletAddressesApi, 'setSyncEnabled').mockRejectedValue(failure(500));
    await act(() => hook.current.setSyncEnabled(id(20), enabled));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe('WAL-LIST: loading in useWallets', () => {
  it('fails a first load with nothing kept, and a quiet refresh keeps what is shown', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockRejectedValue(failure(500));
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([address()]);
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({ items: [], nextCursor: null });
    const { result: hook } = renderHook(() => useWallets(), { wrapper });
    await waitFor(() => expect(hook.current.failed).toBe(true));
    expect(hook.current.portfolio).toBeNull();
    await act(() => hook.current.load(true));
    expect(hook.current.failed).toBe(false);
  });

  it('shows what was kept at once and keeps it when a later load fails', async () => {
    const first = await setup();
    expect(first.result.current.portfolio).toEqual(portfolio);
    first.unmount();
    vi.spyOn(portfolioValuationApi, 'get').mockRejectedValue(failure(500));
    const { result: hook } = renderHook(() => useWallets(), { wrapper });
    expect(hook.current.portfolio).toEqual(portfolio);
    expect(hook.current.addresses).toEqual([address()]);
    await act(() => hook.current.load());
    expect(hook.current.failed).toBe(false);
    expect(hook.current.portfolio).toEqual(portfolio);
  });

  it('shows no kept portfolio without the accounts it goes with', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(portfolio);
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([address()]);
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
    vi.spyOn(accountingApi, 'listAccounts').mockRejectedValue(failure(500));
    const first = renderHook(() => useWallets(), { wrapper });
    await waitFor(() => expect(first.result.current.failed).toBe(true));
    first.unmount();
    // The portfolio and the addresses are kept now, the accounts are not.
    const { result: hook } = renderHook(() => useWallets(), { wrapper });
    await waitFor(() => expect(hook.current.failed).toBe(true));
    expect(hook.current.portfolio).toBeNull();
  });
});
