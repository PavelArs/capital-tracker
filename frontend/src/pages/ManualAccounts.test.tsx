import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ManualAccounts from './ManualAccounts';

// Initial presentation only: SSR executes no network effects. Live account data,
// authentication, focus and interactions are verified by DIRECTORY-UI.
function initialPage() {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      <MemoryRouter>
        <ManualAccounts />
      </MemoryRouter>,
    ),
    'text/html',
  );
}

describe('DIRECTORY-001 initial task hierarchy', () => {
  it('starts with a closed, labelled account creation action', () => {
    const document = initialPage();
    const trigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Новый счет',
    );
    expect(trigger).toBeDefined();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(trigger?.getAttribute('aria-controls') ?? 'missing');
    expect(panel?.hasAttribute('hidden')).toBe(true);
    expect(panel?.querySelector('label')?.textContent).toBe('Название счета');
  });

  it('leads with the account directory and keeps valuation in a closed disclosure', () => {
    const document = initialPage();
    const list = document.querySelector('section[aria-labelledby="manual-account-list-heading"]');
    const valuation = [...document.querySelectorAll('details')].find(
      (node) => node.querySelector('summary')?.textContent === 'Оценить выбранные счета',
    );
    expect(list).not.toBeNull();
    expect(valuation).toBeDefined();
    expect(valuation?.hasAttribute('open')).toBe(false);
    expect(
      list!.compareDocumentPosition(valuation!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(list?.textContent).toContain('Загрузка счетов');
  });
});
