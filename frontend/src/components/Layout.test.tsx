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
async function markup(path = '/manual-accounts') {
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

describe('SHELL-001/002 navigation presentation', () => {
  it('names navigation and exposes a working keyboard skip destination', async () => {
    const document = await markup();
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Основная навигация');
    const skip = [...document.querySelectorAll('a')].find(
      (link) => link.textContent === 'К содержимому',
    );
    expect(skip).toBeDefined();
    const target = document.querySelector(skip?.getAttribute('href') ?? '#missing');
    expect(target?.tagName).toBe('MAIN');
    expect(target?.getAttribute('tabindex')).toBe('-1');
  });

  it('identifies the current account destination for nested detail routes', async () => {
    const document = await markup('/manual-accounts/11111111-1111-4111-8111-111111111111');
    const current = document.querySelectorAll('a[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].getAttribute('href')).toBe('/manual-accounts');
  });

  it('keeps legacy destinations in a labelled subordinate disclosure', async () => {
    const document = await markup();
    const group = [...document.querySelectorAll('details')].find(
      (node) => node.querySelector('summary')?.textContent === 'Прежние данные',
    );
    expect(group).toBeDefined();
    expect([...group!.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/legacy-overview',
      '/assets',
      '/crypto',
    ]);
    expect(document.querySelector('nav a[href^="/liabilities"]')).toBeNull();
  });
});
