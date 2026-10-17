import { connection } from '@api/connection';
import { announceSyncChange, type SyncSource, syncStatusApi } from '@api/sync-status.api';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionState } from './attention-context';
import SyncIndicator from './SyncIndicator';

const attentionState = vi.hoisted(() => ({ current: null as AttentionState | null }));
vi.mock('./attention-context', () => ({ useAttention: () => attentionState.current }));

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

beforeEach(() => {
  vi.restoreAllMocks();
  attentionState.current = null;
});
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

  it('N4: counts what the bell counts, even when every source is synced', async () => {
    vi.spyOn(syncStatusApi, 'get').mockResolvedValue([prices]);
    const item = (key: string) => ({
      key,
      tone: 'warn' as const,
      icon: 'alert' as const,
      title: `Problem ${key}`,
      detail: '',
    });
    attentionState.current = {
      loaded: true,
      attention: { items: [item('a'), item('b'), item('c')], checked: true, pricesUpdatedAt: null },
      wallets: [],
      now: new Date(),
      refresh: () => undefined,
    };
    show();
    const link = await screen.findByRole('link', { name: /3 need attention/ });
    expect(link).toHaveAttribute('title', 'Problem a\nProblem b\nProblem c');
  });

  it('STALE-STATE keeps the last status after a failed refresh but says it could not refresh, and from when', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-17T11:05:00Z'));
    try {
      vi.spyOn(syncStatusApi, 'get')
        .mockResolvedValueOnce([prices])
        .mockRejectedValue(new Error('offline'));
      show();
      await screen.findByText('All synced');
      vi.setSystemTime(new Date('2026-10-17T11:20:00Z'));
      announceSyncChange();
      await waitFor(() =>
        expect(screen.getByRole('link')).toHaveTextContent("Couldn't refreshStatus from 16:05"),
      );
      expect(screen.getByRole('link')).toHaveClass('shell-sync--warn');
    } finally {
      vi.useRealTimers();
    }
  });

  it('STALE-STATE says the browser is offline instead of claiming all is synced', async () => {
    vi.spyOn(syncStatusApi, 'get').mockResolvedValue([prices]);
    show();
    await screen.findByText('All synced');
    act(() => connection.setOffline(true));
    try {
      expect(screen.getByRole('link')).toHaveTextContent(/^OfflineStatus from \d\d:\d\d$/);
    } finally {
      act(() => connection.reset());
    }
  });

  it('says so when the status cannot be read', async () => {
    vi.spyOn(syncStatusApi, 'get').mockRejectedValue(new Error('offline'));
    show();
    await waitFor(() =>
      expect(screen.getByRole('link')).toHaveTextContent('Sync status unavailable'),
    );
  });
});
