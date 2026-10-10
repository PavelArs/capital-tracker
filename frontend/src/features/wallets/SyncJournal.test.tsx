import {
  type SyncRunEntry,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SyncJournal, { explain } from './SyncJournal';

const wallet = (lastAttemptAt: string | null = '2026-10-10T10:00:00.000Z') =>
  ({ id: 'wallet-1', network: 'ethereum', sync: { lastAttemptAt } }) as unknown as WalletAddress;

const entry = (changes: Partial<SyncRunEntry> = {}): SyncRunEntry => ({
  at: '2026-10-10T10:00:00.000Z',
  state: 'synced',
  errorCode: null,
  message: null,
  imported: 0,
  ...changes,
});

afterEach(() => vi.restoreAllMocks());

describe('W3 sync journal', () => {
  it('says in a sentence what each kind of pass did', () => {
    const address = wallet();
    expect(explain(entry(), address)).toBe('Up to date. Nothing new.');
    expect(explain(entry({ imported: 1 }), address)).toBe('Stored 1 new transaction.');
    expect(explain(entry({ imported: 12 }), address)).toBe('Stored 12 new transactions.');
    expect(explain(entry({ state: 'partial', imported: 40 }), address)).toBe(
      'Stored 40 new transactions. More history loads on the next pass.',
    );
    expect(
      explain(
        entry({ state: 'delayed', errorCode: 'rate_limited', message: 'The data source is busy.' }),
        address,
      ),
    ).toBe('The data source is busy.');
    expect(explain(entry({ state: 'failed', imported: 2, message: 'It stopped.' }), address)).toBe(
      'It stopped. Stored 2 new transactions before it stopped.',
    );
    expect(explain(entry({ state: 'failed' }), address)).toBe(
      'Ethereum data is temporarily unavailable.',
    );
  });

  it('lists the newest passes with their time, result and reason', async () => {
    vi.spyOn(walletAddressesApi, 'syncRuns').mockResolvedValue([
      entry({ at: '2026-10-10T10:00:00.000Z', state: 'failed', message: 'Ethereum data is gone.' }),
      entry({ at: '2026-10-10T09:00:00.000Z', imported: 3 }),
    ]);
    render(<SyncJournal address={wallet()} run={undefined} />);
    const rows = within(await screen.findByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe('Failed10 Oct, 10:00 UTCEthereum data is gone.');
    expect(rows[1].textContent).toBe('Synced10 Oct, 09:00 UTCStored 3 new transactions.');
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });

  it('shows the latest five and the rest on request', async () => {
    const user = userEvent.setup();
    vi.spyOn(walletAddressesApi, 'syncRuns').mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => entry({ at: `2026-10-10T0${8 - index}:00:00.000Z` })),
    );
    render(<SyncJournal address={wallet()} run={undefined} />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('says so when nothing is recorded yet or the read fails', async () => {
    const read = vi.spyOn(walletAddressesApi, 'syncRuns').mockResolvedValueOnce([]);
    const { rerender } = render(<SyncJournal address={wallet(null)} run={undefined} />);
    expect(await screen.findByText(/No syncs recorded yet/)).toBeTruthy();
    read.mockRejectedValueOnce(new Error('offline'));
    rerender(<SyncJournal address={wallet('2026-10-10T11:00:00.000Z')} run={undefined} />);
    expect(await screen.findByText('Could not load the history.')).toBeTruthy();
  });

  it('reads again when a pass ends, and not while this page is syncing', async () => {
    const read = vi.spyOn(walletAddressesApi, 'syncRuns').mockResolvedValue([entry()]);
    const { rerender } = render(<SyncJournal address={wallet()} run={undefined} />);
    await screen.findByRole('list');
    expect(read).toHaveBeenCalledTimes(1);
    rerender(<SyncJournal address={wallet()} run={{ state: 'running' }} />);
    expect(read).toHaveBeenCalledTimes(1);
    rerender(<SyncJournal address={wallet('2026-10-10T11:00:00.000Z')} run={undefined} />);
    await screen.findByRole('list');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
