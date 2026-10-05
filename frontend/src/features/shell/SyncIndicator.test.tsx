import { announceSyncChange, type SyncSource, syncStatusApi } from '@api/sync-status.api';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SyncIndicator from './SyncIndicator';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const prices: SyncSource = {
  key: 'prices',
  kind: 'prices',
  name: 'Prices',
  state: 'synced',
  lastAttemptAt: minutesAgo(12),
  lastSuccessAt: minutesAgo(12),
  errorMessage: null,
};
const failedWallet: SyncSource = {
  key: 'wallet:1',
  kind: 'wallet',
  name: 'Savings',
  state: 'failed',
  lastAttemptAt: minutesAgo(2),
  lastSuccessAt: null,
  errorMessage: 'Bitcoin data is temporarily unavailable.',
};

const show = () =>
  render(
    <MemoryRouter>
      <SyncIndicator />
    </MemoryRouter>,
  );

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('SYNC-STATUS sidebar indicator', () => {
  it('shows the last successful sync and the failing wallet, and opens Wallets', async () => {
    vi.spyOn(syncStatusApi, 'get').mockResolvedValue([prices, failedWallet]);
    show();
    const link = await screen.findByRole('link', { name: /1 source needs attention/ });
    expect(link).toHaveTextContent('Others synced 12 min ago');
    expect(link).toHaveAttribute('href', '/wallets');
    expect(link).toHaveAttribute('title', 'Savings: Bitcoin data is temporarily unavailable.');
  });

  it('reads the status again when a page changes a source', async () => {
    const get = vi
      .spyOn(syncStatusApi, 'get')
      .mockResolvedValueOnce([prices, failedWallet])
      .mockResolvedValue([
        prices,
        { ...failedWallet, state: 'synced', lastSuccessAt: minutesAgo(0), errorMessage: null },
      ]);
    show();
    await screen.findByText('1 source needs attention');
    announceSyncChange();
    expect(await screen.findByText('All synced')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveTextContent('Prices and wallets just now');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says so when the status cannot be read', async () => {
    vi.spyOn(syncStatusApi, 'get').mockRejectedValue(new Error('offline'));
    show();
    await waitFor(() =>
      expect(screen.getByRole('link')).toHaveTextContent('Sync status unavailable'),
    );
  });
});
