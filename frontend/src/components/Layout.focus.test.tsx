import { accountingApi } from '@api/accounting.api';
import { operationsApi } from '@api/operations.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { syncStatusApi } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout';

vi.mock('@contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, logout: vi.fn() }),
}));
vi.mock('@contexts/ErrorContext', () => ({ useError: () => ({ showError: vi.fn() }) }));
vi.mock('@features/portfolio/AddTransactionDialog', () => ({ default: () => null }));

// A page that loads like a lazy one: a stand-in without a title first, then the page.
function SlowPage({ title }: { title: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 20);
    return () => clearTimeout(timer);
  }, []);
  if (!ready) return <p>Loading…</p>;
  return (
    <section>
      <h1 tabIndex={-1}>{title}</h1>
      <input type="search" aria-label="Search assets" />
      <input aria-label="Note" />
    </section>
  );
}

function renderShell(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<h1 tabIndex={-1}>Dashboard</h1>} />
          <Route path="/portfolio" element={<SlowPage title="Portfolio" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
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
  vi.restoreAllMocks();
  forgetReads();
});

describe('SHELL-FOCUS after choosing a section', () => {
  it('SHELL-FOCUS puts the keyboard on the new page title once the page has drawn it', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getAllByRole('link', { name: 'Portfolio' })[0]);
    const title = await screen.findByRole('heading', { level: 1, name: 'Portfolio' });
    expect(title).toHaveFocus();
  });

  it('SHELL-FOCUS leaves the keyboard alone when the owner has moved it on', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getAllByRole('link', { name: 'Portfolio' })[0]);
    // The owner tabs back to the menu before the page arrives.
    const dashboard = screen.getAllByRole('link', { name: 'Dashboard' })[0];
    act(() => dashboard.focus());
    await screen.findByRole('heading', { level: 1, name: 'Portfolio' });
    expect(dashboard).toHaveFocus();
  });
});

describe('SHELL-SEARCH-KEY the search shortcut', () => {
  // WCAG 2.1.4: no single-character shortcut. "/" is an ordinary key (a speech user may dictate
  // it, a key press on a button may carry it); Ctrl+K or Cmd+K is the shortcut.
  it('SHELL-SEARCH-KEY a bare "/" moves nothing, wherever the keyboard is', async () => {
    const user = userEvent.setup();
    renderShell('/portfolio');
    const search = await screen.findByRole('searchbox', { name: 'Search assets' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('/');
    expect(search).not.toHaveFocus();
    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.click(note);
    await user.keyboard('/');
    expect(note).toHaveFocus();
    expect(note).toHaveValue('/');
  });

  it('SHELL-SEARCH-KEY Ctrl+K or Cmd+K puts the keyboard in the page search, not while typing elsewhere', async () => {
    const user = userEvent.setup();
    renderShell('/portfolio');
    const search = await screen.findByRole('searchbox', { name: 'Search assets' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('{Control>}k{/Control}');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
    act(() => search.blur());
    await user.keyboard('{Meta>}k{/Meta}');
    expect(search).toHaveFocus();

    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.click(note);
    await user.keyboard('{Control>}k{/Control}');
    expect(note).toHaveFocus();
  });

  it('SHELL-SEARCH-KEY does nothing while a dialog is open', async () => {
    const user = userEvent.setup();
    renderShell('/portfolio');
    const search = await screen.findByRole('searchbox', { name: 'Search assets' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    document.body.classList.add('has-dialog');
    try {
      await user.keyboard('{Control>}k{/Control}');
      expect(search).not.toHaveFocus();
    } finally {
      document.body.classList.remove('has-dialog');
    }
  });
});
