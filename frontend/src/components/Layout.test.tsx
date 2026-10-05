import { AuthProvider } from '@contexts/AuthContext';
import { ErrorProvider } from '@contexts/ErrorContext';
import { createInstance } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
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

  it('keeps the compact menu button contract and an English logout', async () => {
    const document = await markup();
    const buttons = [...document.querySelectorAll('nav button')];
    const toggle = buttons.find((button) => button.textContent === 'Menu');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-controls')).toBe('application-menu');
    expect(document.getElementById('application-menu')).not.toBeNull();
    expect(buttons.some((button) => button.getAttribute('aria-label') === 'Log out')).toBe(true);
  });
});

describe('SHELL-001 sections first, current screens under Legacy', () => {
  it('lists the five new sections in order', async () => {
    const document = await markup();
    expect(linksOf(document.querySelector('[data-nav-group="sections"]'))).toEqual([
      ['Dashboard', '/dashboard'],
      ['Portfolio', '/portfolio'],
      ['Transactions', '/transactions'],
      ['Wallets', '/wallets'],
      ['Settings', '/preferences'],
    ]);
  });

  it('keeps every current screen in an open Legacy group with unchanged URLs and labels', async () => {
    const document = await markup();
    const group = [...document.querySelectorAll('details')].find(
      (node) => node.querySelector('summary')?.textContent === 'Legacy',
    );
    expect(group).toBeDefined();
    expect(group?.hasAttribute('open')).toBe(true);
    expect(linksOf(group)).toEqual([
      ['Ручные счета', '/manual-accounts'],
      ['Переводы между счетами', '/owned-transfers'],
      ['Вводы и выводы', '/capital-flows'],
      ['Ручные цены', '/manual-prices'],
      ['Адреса кошельков', '/wallet-addresses'],
      ['Прибыль за период', '/period-profit'],
      ['Настройки', '/settings'],
      ['Прежний обзор', '/legacy-overview'],
      ['Активы', '/assets'],
      ['Криптокошельки', '/crypto'],
    ]);
    expect(document.querySelector('nav a[href^="/liabilities"]')).toBeNull();
  });

  it('marks exactly one current destination for new and nested legacy routes', async () => {
    for (const [path, current] of [
      ['/dashboard', '/dashboard'],
      ['/preferences', '/preferences'],
      ['/manual-accounts/11111111-1111-4111-8111-111111111111', '/manual-accounts'],
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
