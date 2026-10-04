import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PlaceholderSection, placeholderSections } from './navigation';
import SectionPlaceholder from './SectionPlaceholder';

afterEach(cleanup);

const expected: Record<PlaceholderSection, [string, string, string]> = {
  dashboard: ['Dashboard', 'Open manual accounts', '/manual-accounts'],
  transactions: ['Transactions', 'Open manual accounts', '/manual-accounts'],
  wallets: ['Wallets', 'Open wallet addresses', '/wallet-addresses'],
};

describe('SHELL-005 honest placeholders', () => {
  it('covers exactly the three unbuilt sections', () => {
    expect(Object.keys(placeholderSections).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [section, [title, linkName, href]] of Object.entries(expected)) {
    it(`${section}: names the section, says it is not built and links to its legacy screen`, () => {
      const fetchSpy = vi.spyOn(window, 'fetch');
      const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
      render(
        <MemoryRouter>
          <SectionPlaceholder section={section as PlaceholderSection} />
        </MemoryRouter>,
      );
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByText(/not built yet/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: linkName })).toHaveAttribute('href', href);
      expect(screen.queryByText(/your portfolio is empty/i)).toBeNull();
      expect(document.body.textContent).not.toMatch(/\d[\d,]*\.\d{2}/);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
      xhrSpy.mockRestore();
    });
  }
});
