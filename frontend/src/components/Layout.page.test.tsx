import { accountingApi } from '@api/accounting.api';
import { operationsApi } from '@api/operations.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { syncStatusApi } from '@api/sync-status.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import ru from '../i18n/locales/ru.json';
import Layout from './Layout';

const { logout, showError } = vi.hoisted(() => ({ logout: vi.fn(), showError: vi.fn() }));
vi.mock('@contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, logout }),
}));
vi.mock('@contexts/ErrorContext', () => ({ useError: () => ({ showError }) }));
vi.mock('@features/portfolio/AddTransactionDialog', () => ({ default: () => null }));

// A browser that prefers Russian: the shell must still speak English (owner decision D6).
async function renderShell(path: string) {
  const i18n = createInstance();
  await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<p>Page</p>} />
          </Route>
          <Route path="/login" element={<p>Sign in</p>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
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

describe('shell-05 the current section on the phone strip', () => {
  const strip = () => document.getElementById('application-menu') as HTMLElement;
  // jsdom lays nothing out: each link is 100 px wide, one after another, in a 300 px strip.
  beforeEach(() => {
    const scroll = new WeakMap<Element, number>();
    const at = (element: HTMLElement) => {
      const item = element.closest('li');
      return item?.parentElement ? [...item.parentElement.children].indexOf(item) * 100 : 0;
    };
    const define = (name: string, get: (this: HTMLElement) => number) =>
      vi.spyOn(HTMLElement.prototype, name as 'offsetLeft', 'get').mockImplementation(get);
    define('offsetLeft', function () {
      return at(this);
    });
    define('offsetWidth', () => 100);
    define('clientWidth', () => 300);
    define('scrollWidth', () => 900);
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get(this: HTMLElement) {
        return scroll.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        scroll.set(this, value);
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollLeft');
  });

  it('shell-05 keeps Goals centred when Real estate arrives before it', async () => {
    phone(true);
    let answer: (value: { items: (typeof property)[]; nextCursor: null }) => void = () => undefined;
    vi.mocked(accountingApi.listAccounts).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await renderShell('/goals');
    // Goals is the sixth link: 500 px in, centred in a 300 px strip.
    expect(strip().scrollLeft).toBe(400);
    answer({ items: [property], nextCursor: null });
    await screen.findByRole('link', { name: 'Real estate' });
    await waitFor(() => expect(strip().scrollLeft).toBe(500));
  });
});

describe('shell-18 the logout error', () => {
  it('shell-18 says in English that the logout failed, whatever the browser language', async () => {
    const user = userEvent.setup();
    logout.mockRejectedValue(new Error('offline'));
    await renderShell('/dashboard');
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('Unable to log out. Please try again.'),
    );
  });
});
