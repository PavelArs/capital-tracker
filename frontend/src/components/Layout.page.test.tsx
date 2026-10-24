import { accountingApi } from '@api/accounting.api';
import { connection } from '@api/connection';
import { operationsApi } from '@api/operations.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { forgetReads, generationNow, remember } from '@api/read-cache';
import { syncStatusApi } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import PageHeader from '@features/shell/PageHeader';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import Layout from './Layout';

const { logout, showError } = vi.hoisted(() => ({ logout: vi.fn(), showError: vi.fn() }));
vi.mock('@contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, logout }),
}));
vi.mock('@contexts/ErrorContext', () => ({ useError: () => ({ showError }) }));
vi.mock('@features/portfolio/AddTransactionDialog', () => ({ default: () => null }));

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<p>Page</p>} />
        </Route>
        <Route path="/login" element={<p>Sign in</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const phone = (matches: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

const property = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio',
  kind: null,
  assetClass: 'property' as const,
  currentRevision: 1,
  createdAt: '2026-10-12T00:00:00Z',
};

beforeEach(() => {
  phone(false);
  vi.spyOn(operationsApi, 'needsClassification').mockResolvedValue(0);
  vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
    assets: [],
    stalePriceCount: 0,
    accounts: [],
  } as never);
  vi.spyOn(syncStatusApi, 'get').mockResolvedValue([]);
  vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
  vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  logout.mockReset();
  showError.mockReset();
  forgetReads();
});

describe('shell-01 the document language', () => {
  it('shell-01 declares English, the language of the interface', () => {
    const html = new DOMParser().parseFromString(indexHtml, 'text/html');
    expect(html.documentElement.getAttribute('lang')).toBe('en');
  });
});

describe('shell-02 the browser tab title', () => {
  it('shell-02 names the section, the detail page, or only the app', async () => {
    for (const [path, title] of [
      ['/dashboard', 'Dashboard · Capital Tracker'],
      ['/real-estate', 'Real estate · Capital Tracker'],
      ['/preferences', 'Settings · Capital Tracker'],
      ['/portfolio/00000000-0000-4000-8000-000000000009', 'Asset · Capital Tracker'],
      ['/wallets/00000000-0000-4000-8000-000000000009', 'Wallet · Capital Tracker'],
      ['/deposits/00000000-0000-4000-8000-000000000009', 'Deposit · Capital Tracker'],
      ['/goals/00000000-0000-4000-8000-000000000009', 'Goal · Capital Tracker'],
      ['/history', 'History · Capital Tracker'],
    ]) {
      const { unmount } = await renderShell(path);
      expect(document.title).toBe(title);
      unmount();
      expect(document.title).toBe('Capital Tracker');
    }
  });
});

describe('shell-05 the phone tab bar and the More sheet', () => {
  const tabs = () =>
    [...(document.getElementById('application-menu')?.querySelectorAll('li') ?? [])]
      .filter((item) => !item.classList.contains('shell-nav__in-more'))
      .map((item) => item.textContent);

  it('shell-05 keeps Dashboard, Portfolio, Transactions, Goals and More in the tab bar, and says when the page is in More', async () => {
    await renderShell('/wallets/some-wallet');
    expect(tabs()).toEqual(['Dashboard', 'Portfolio', 'Transactions', 'Goals', 'More']);
    // Polish §3: More is current when the page lives in the sheet, and its name says which.
    const more = screen.getByRole('button', { name: 'More, now on Wallets' });
    expect(more).toHaveAttribute('aria-current', 'page');
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    cleanup();
    await renderShell('/goals');
    expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current');
  });

  it('shell-05 More opens a sheet with the other sections, History, the sync state and Log out; Escape gives the keyboard back', async () => {
    const user = userEvent.setup();
    vi.mocked(accountingApi.listAccounts).mockResolvedValue({
      items: [property],
      nextCursor: null,
    });
    await renderShell('/preferences');
    await screen.findAllByRole('link', { name: 'Real estate' });
    const more = screen.getByRole('button', { name: 'More, now on Settings' });
    await user.click(more);
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Wallets', '/wallets'],
      ['Banks', '/deposits'],
      ['Real estate', '/real-estate'],
      ['History', '/history'],
      ['Settings', '/preferences'],
      [expect.stringMatching(/./), '/wallets'],
    ]);
    // The keyboard starts on the page that is open.
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toHaveFocus();
    expect(within(sheet).getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    expect(more).toHaveFocus();
  });

  it('shell-05 choosing a section in the sheet opens it and closes the sheet', async () => {
    const user = userEvent.setup();
    await renderShell('/dashboard');
    await user.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    await user.click(within(sheet).getByRole('link', { name: 'History' }));
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More, now on History' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shell-05 logs out from the sheet', async () => {
    const user = userEvent.setup();
    logout.mockResolvedValue(undefined);
    await renderShell('/dashboard');
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Log out' }),
    );
    expect(await screen.findByText('Sign in')).toBeInTheDocument();
  });
});

describe('STALE-STATE Retry', () => {
  it('STALE-STATE Retry above the page draws the page again, so it reads again', async () => {
    const mounted = vi.fn();
    function Page() {
      useEffect(() => mounted(), []);
      return <PageHeader title="Dashboard" currency="USD" />;
    }
    remember('portfolio:[]', {}, generationNow());
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Page />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(mounted).toHaveBeenCalledTimes(1);
    const token = {};
    act(() => {
      connection.started(token);
      connection.settled(token, false);
    });
    try {
      // A plain click: an earlier test's click that unmounted its own target leaves user-event's
      // pointer state behind in this document.
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(mounted).toHaveBeenCalledTimes(2);
    } finally {
      act(() => connection.reset());
    }
  });
});

describe('STALE-STATE leaving a page', () => {
  it('STALE-STATE leaving a page tells the connection, so the failed reads of the page left can be dropped', async () => {
    const changed = vi.spyOn(connection, 'pageChanged');
    await renderShell('/dashboard');
    changed.mockClear();
    fireEvent.click(screen.getAllByRole('link', { name: /Goals/ })[0]);
    expect(await screen.findByText('Page')).toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('shell-18 the logout error', () => {
  it('shell-18 says in English that the logout failed', async () => {
    const user = userEvent.setup();
    logout.mockRejectedValue(new Error('offline'));
    await renderShell('/dashboard');
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('Unable to log out. Please try again.'),
    );
  });
});
