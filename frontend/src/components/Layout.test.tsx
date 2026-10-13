import { accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import { forgetReads } from '@api/read-cache';
import { AuthProvider } from '@contexts/AuthContext';
import { ErrorProvider } from '@contexts/ErrorContext';
import { createInstance } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ru from '../i18n/locales/ru.json';
import Layout from './Layout';

// Static presentation only: server rendering runs no authentication effects and
// substitutes no API/context responses. Real login and interactions are in SHELL-UI.
async function markup(path = '/dashboard') {
  const i18n = createInstance();
  await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } } });
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <ErrorProvider>
              <Layout />
            </ErrorProvider>
          </AuthProvider>
        </MemoryRouter>
      </I18nextProvider>,
    ),
    'text/html',
  );
  return document;
}

const linksOf = (root: ParentNode | null | undefined) =>
  [...(root?.querySelectorAll('a') ?? [])].map((link) => [
    link.textContent?.trim(),
    link.getAttribute('href'),
  ]);

describe('SHELL-002 navigation presentation', () => {
  it('names navigation and exposes a working keyboard skip destination', async () => {
    const document = await markup();
    const navs = document.querySelectorAll('nav');
    expect(navs.length).toBe(1);
    expect(navs[0].getAttribute('aria-label')).toBe('Main navigation');
    const skip = [...document.querySelectorAll('a')].find(
      (link) => link.textContent === 'Skip to content',
    );
    expect(skip).toBeDefined();
    const target = document.querySelector(skip?.getAttribute('href') ?? '#missing');
    expect(target?.tagName).toBe('MAIN');
    expect(target?.getAttribute('tabindex')).toBe('-1');
  });

  it('always shows the sections (no menu button) and keeps an English logout', async () => {
    const document = await markup();
    const buttons = [...document.querySelectorAll('nav button')];
    expect(buttons.some((button) => button.textContent === 'Menu')).toBe(false);
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(
      document.getElementById('application-menu')?.querySelectorAll('a').length,
    ).toBeGreaterThan(4);
    expect(buttons.some((button) => button.getAttribute('aria-label') === 'Log out')).toBe(true);
  });
});

describe('SHELL-001 the sections, no Legacy group', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    forgetReads();
  });

  it('lists the sections in order', async () => {
    const document = await markup();
    expect(linksOf(document.querySelector('[data-nav-group="sections"]'))).toEqual([
      ['Dashboard', '/dashboard'],
      ['Portfolio', '/portfolio'],
      ['Transactions', '/transactions'],
      ['Wallets', '/wallets'],
      ['Deposits', '/deposits'],
      ['Goals', '/goals'],
      ['Settings', '/preferences'],
    ]);
  });

  it('adds Real estate once a property is held, or while it is open (v8)', async () => {
    const sections = async (path?: string) =>
      linksOf((await markup(path)).querySelector('[data-nav-group="sections"]')).map(
        ([label]) => label,
      );
    expect(await sections('/real-estate')).toEqual([
      'Dashboard',
      'Portfolio',
      'Transactions',
      'Wallets',
      'Deposits',
      'Real estate',
      'Goals',
      'Settings',
    ]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Studio',
          kind: null,
          assetClass: 'property',
          currentRevision: 1,
          createdAt: '2026-10-12T00:00:00Z',
        },
      ],
      nextCursor: null,
    });
    await cachedReads.accounts.load();
    expect(await sections()).toContain('Real estate');
  });

  it('adds Brokers before Real estate once a broker account is held (v8)', async () => {
    const sections = async (path?: string) =>
      linksOf((await markup(path)).querySelector('[data-nav-group="sections"]')).map(
        ([label]) => label,
      );
    expect(await sections('/brokers')).toEqual([
      'Dashboard',
      'Portfolio',
      'Transactions',
      'Wallets',
      'Deposits',
      'Brokers',
      'Goals',
      'Settings',
    ]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'Sample Broker',
          kind: null,
          assetClass: 'broker',
          currentRevision: 1,
          createdAt: '2026-10-12T00:00:00Z',
        },
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Studio',
          kind: null,
          assetClass: 'property',
          currentRevision: 1,
          createdAt: '2026-10-12T00:00:00Z',
        },
      ],
      nextCursor: null,
    });
    await cachedReads.accounts.load();
    const held = await sections();
    expect(held.slice(held.indexOf('Deposits'))).toEqual([
      'Deposits',
      'Brokers',
      'Real estate',
      'Goals',
      'Settings',
    ]);
  });

  it('has no Legacy group and no link to the retired older screens (G1)', async () => {
    const document = await markup();
    expect(
      [...document.querySelectorAll('details')].some(
        (node) => node.querySelector('summary')?.textContent === 'Legacy',
      ),
    ).toBe(false);
    expect(document.body.textContent).not.toMatch(/[А-Яа-я]/);
    for (const older of ['/manual-accounts', '/manual-prices'])
      expect(document.querySelector(`nav a[href^="${older}"]`)).toBeNull();
    for (const retired of [
      '/owned-transfers',
      '/capital-flows',
      '/wallet-addresses',
      '/period-profit',
      '/settings',
      '/legacy-overview',
      '/assets',
      '/crypto',
      '/liabilities',
    ])
      expect(document.querySelector(`nav a[href^="${retired}"]`)).toBeNull();
  });

  it('marks exactly one current destination', async () => {
    for (const [path, current] of [
      ['/dashboard', '/dashboard'],
      ['/preferences', '/preferences'],
    ]) {
      const document = await markup(path);
      const marked = document.querySelectorAll('a[aria-current="page"]');
      expect(marked.length).toBe(1);
      expect(marked[0].getAttribute('href')).toBe(current);
    }
  });
});

describe('SHELL-007 sync indicator', () => {
  it('opens Wallets and claims nothing before the status arrives', async () => {
    const document = await markup();
    const slot = document.querySelector('[data-sync-status]');
    expect(slot?.tagName).toBe('A');
    expect(slot?.getAttribute('href')).toBe('/wallets');
    expect(slot?.getAttribute('aria-current')).toBeNull();
    expect(slot?.textContent).toContain('Checking sync');
    expect(slot?.textContent).not.toMatch(/\bsynced\b/i);
  });
});
