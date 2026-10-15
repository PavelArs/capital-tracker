import { operationsApi } from '@api/operations.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { syncStatusApi } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import PageHeader from '@features/shell/PageHeader';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout';

vi.mock('@contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, logout: vi.fn() }),
}));
vi.mock('@contexts/ErrorContext', () => ({ useError: () => ({ showError: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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
  it('stands in the top bar next to the owner, not in the page header', async () => {
    phone(true);
    renderShell();
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    expect(screen.getAllByRole('button', { name: /^Notifications/ })).toHaveLength(1);
    const bar = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(bar).toContainElement(bell);
    expect(bell.closest('.shell-owner__bell')?.nextElementSibling).toHaveTextContent('O');
    expect(
      within(screen.getByRole('banner')).queryByRole('button', { name: /^Notifications/ }),
    ).toBeNull();
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
