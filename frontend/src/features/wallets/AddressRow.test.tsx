import type { WalletAddress } from '@api/wallet-addresses.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SyncRun, syncOffNote } from './SyncStatus';
import { AddressRow } from './WalletParts';

// Synthetic ids, names, addresses and amounts only.
const btc = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const tracked = (sync: Partial<WalletAddress['sync']> = {}): WalletAddress => ({
  id: '00000000-0000-4000-8000-000000000020',
  network: 'bitcoin',
  address: btc,
  accountId: '00000000-0000-4000-8000-000000000010',
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
    ...sync,
  },
});

function row(address: WalletAddress, run?: SyncRun, narrow = false) {
  const handlers = {
    onOpen: vi.fn(),
    onSync: vi.fn(),
    onSyncEnabled: vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined),
  };
  render(
    <ul>
      <AddressRow
        address={address}
        run={run}
        narrow={narrow}
        prices={new Map()}
        currency="USD"
        {...handlers}
      />
    </ul>,
  );
  return {
    ...handlers,
    item: screen.getByRole('listitem'),
    open: screen.getByRole('button', { name: `Trust Wallet BTC ${btc}` }),
    user: userEvent.setup(),
  };
}

const banner = (item: HTMLElement) => item.querySelector('.ui-banner');

afterEach(() => {
  cleanup();
});

describe('SYNC-STATUS: the note under an address row', () => {
  it.each([false, true])('offers to load a history never read (narrow: %s)', async (narrow) => {
    const view = row(tracked({ state: 'never', completedAt: null }), undefined, narrow);
    expect(banner(view.item)).toHaveTextContent('The transaction history is not loaded yet.');
    await view.user.click(within(view.item).getByRole('button', { name: 'Load history' }));
    expect(view.onSync).toHaveBeenCalledOnce();
    expect(view.open).toHaveFocus();
  });

  it('offers to go on loading a history partly read', () => {
    const view = row(tracked({ state: 'partial' }));
    expect(banner(view.item)).toHaveTextContent(
      'Part of the history is loaded; the balance appears when the rest is.',
    );
    expect(within(view.item).getByRole('button', { name: 'Continue loading' })).toBeVisible();
  });

  it.each([
    ['a sync the owner ran', tracked({ state: 'partial' }), { state: 'running' } as SyncRun],
    ['the background job', tracked({ state: 'never', status: 'syncing' }), undefined],
  ])('says the history is loading for %s, with no action', (_case, address, run) => {
    const view = row(address, run);
    expect(banner(view.item)).toHaveTextContent(
      'Loading the transaction history. A long history takes a few minutes; it keeps loading in the background, so you can leave this page.',
    );
    expect(within(banner(view.item) as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('says nothing for a complete history, also while a sync of it runs', () => {
    expect(banner(row(tracked()).item)).toBeNull();
    cleanup();
    expect(banner(row(tracked(), { state: 'running' }).item)).toBeNull();
  });

  it('wallets-02 says a failed sync the owner ran aloud and offers Retry now', async () => {
    const view = row(tracked(), { state: 'failed', message: 'Synthetic failure.' });
    expect(within(view.item).getByRole('alert')).toHaveTextContent('Synthetic failure.');
    await view.user.click(within(view.item).getByRole('button', { name: 'Retry now' }));
    expect(view.onSync).toHaveBeenCalledOnce();
    expect(view.open).toHaveFocus();
  });

  it('wallets-13 shows a failure the background job stored without saying it aloud', () => {
    const view = row(tracked({ status: 'failed', errorMessage: 'Synthetic failure.' }));
    expect(banner(view.item)).toHaveTextContent('Synthetic failure.');
    expect(within(view.item).queryByRole('alert')).toBeNull();
    expect(within(view.item).queryByRole('note')).toBeNull();
    expect(within(view.item).getByRole('button', { name: 'Retry now' })).toBeVisible();
  });

  it('WALLET-SYNC-OFF puts the switched-off note first and turns the sync on', async () => {
    let done: () => void = () => undefined;
    const address = tracked({
      state: 'partial',
      status: 'syncing',
      off: { reason: 'failures', at: '2026-10-05T12:00:00.000Z' },
    });
    const view = row(address);
    view.onSyncEnabled.mockReturnValue(new Promise((resolve) => (done = resolve)));
    expect(banner(view.item)).toHaveTextContent(syncOffNote(address)?.text ?? 'missing note');
    expect(within(view.item).queryByRole('button', { name: 'Continue loading' })).toBeNull();
    await view.user.click(within(view.item).getByRole('button', { name: 'Turn sync on' }));
    expect(view.onSyncEnabled).toHaveBeenCalledWith(true);
    expect(within(view.item).getByRole('button', { name: 'Turning on…' })).toBeDisabled();
    done();
    expect(await within(view.item).findByRole('button', { name: 'Turn sync on' })).toBeEnabled();
  });
});
