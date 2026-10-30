import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { operationsApi } from '@api/operations.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { syncStatusApi } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import PageHeader from '@features/shell/PageHeader';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout';

vi.mock('@contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, logout: vi.fn() }),
}));
vi.mock('@contexts/ErrorContext', () => ({ useError: () => ({ showError: vi.fn() }) }));
vi.mock('@features/portfolio/AddTransactionDialog', () => ({ default: () => null }));

const phone = (matches: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<PageHeader title="Dashboard" currency="USD" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(operationsApi, 'needsClassification').mockResolvedValue(2);
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
    assets: [],
    stalePriceCount: 0,
    accounts: [],
  } as never);
  vi.spyOn(syncStatusApi, 'get').mockResolvedValue([]);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ATTN-BELL on a phone', () => {
  it('stands in the title bar with the page title (polish §3), once', async () => {
    phone(true);
    renderShell();
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    expect(screen.getAllByRole('button', { name: /^Notifications/ })).toHaveLength(1);
    const title = screen.getByRole('heading', { level: 1, name: 'Dashboard' });
    expect(title.closest('.shell-page__bar')).toContainElement(bell);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).not.toContainElement(bell);
  });

  it('can be closed with its ✕ and with a tap on the dimmed page', async () => {
    phone(true);
    const user = userEvent.setup();
    const { container } = renderShell();
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    await user.click(bell);
    const sheet = screen.getByRole('dialog', { name: 'Notifications' });
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(bell).toHaveFocus();
    await user.click(bell);
    const scrim = container.querySelector('.shell-bell__scrim');
    expect(scrim).not.toBeNull();
    await user.click(scrim as Element);
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });

  it('shell-03 is a modal sheet: the keyboard goes in, stays in and comes back to the bell', async () => {
    phone(true);
    const user = userEvent.setup();
    renderShell();
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    await user.click(bell);
    const sheet = screen.getByRole('dialog', { name: 'Notifications' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    const close = within(sheet).getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    await user.tab();
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Log out' })).not.toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(bell).toHaveFocus();
  });
});

describe('N4: the sidebar sync plate', () => {
  it('counts what the bell counts', async () => {
    phone(false);
    // Every read the bell makes answers, so the plate has no failed refresh to report instead.
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
    const { container } = renderShell();
    // Two operations wait to be classified: the bell and the plate both say so.
    await screen.findByRole('button', { name: /need(s)? attention/ });
    const plate = container.querySelector('[data-sync-status]');
    await waitFor(() => expect(plate).toHaveTextContent(/need(s)? attention/));
  });
});

describe('ATTN-BELL on a wide screen', () => {
  it('stays in the page header, once', async () => {
    phone(false);
    renderShell();
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    expect(screen.getAllByRole('button', { name: /^Notifications/ })).toHaveLength(1);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: /^Notifications/ })).toBe(
      bell,
    );
  });

  it('shell-03 opens a popover beside the bell, not a modal sheet', async () => {
    phone(false);
    const user = userEvent.setup();
    renderShell();
    await user.click(await screen.findByRole('button', { name: /^Notifications/ }));
    expect(screen.getByRole('region', { name: 'Notifications' })).not.toHaveAttribute('aria-modal');
  });
});
