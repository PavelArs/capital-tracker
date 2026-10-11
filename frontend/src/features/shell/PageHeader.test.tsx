import { accountingApi } from '@api/accounting.api';
import { fxRatesApi } from '@api/fx-rates.api';
import { ownerSettingsApi } from '@api/owner-settings.api';
import { portfolioAssetsApi } from '@api/portfolio-assets.api';
import { securityApi } from '@api/security.api';
import { ThemeProvider } from '@contexts/ThemeContext';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetIdentity } from './asset-identity';
import { MainCurrencyProvider } from './main-currency';
import PageHeader from './PageHeader';
import SettingsPage from './SettingsPage';

// Settings → Security has its own tests; here it only has to render.
vi.mock('@contexts/AuthContext', () => ({ useAuth: () => ({ logoutEverywhere: vi.fn() }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
    mainCurrency: 'EUR',
    dustThresholdUsd: null,
  });
  vi.spyOn(portfolioAssetsApi, 'listAll').mockReturnValue(new Promise(() => {}));
  vi.spyOn(accountingApi, 'listAccounts').mockReturnValue(new Promise(() => {}));
  vi.spyOn(fxRatesApi, 'get').mockReturnValue(new Promise(() => {}));
  vi.spyOn(securityApi, 'get').mockReturnValue(new Promise(() => {}));
});

afterEach(cleanup);

function Address() {
  const { pathname, search } = useLocation();
  return <output aria-label="Address">{pathname + search}</output>;
}

function renderAt(path: string, page = <PageHeader title="Transactions" />) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <MainCurrencyProvider>
          {page}
          <Address />
        </MainCurrencyProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const switcher = () => screen.getByRole('radiogroup', { name: 'Currency' });

describe('Shared page header', () => {
  it('shows the title and the main currency, and leaves Add transaction to the page below it', async () => {
    renderAt('/transactions', <PageHeader title="Transactions" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(switcher()).getByRole('radio', { name: 'EUR' })).toBeChecked(),
    );
    expect(screen.queryByRole('button', { name: 'Add transaction' })).toBeNull();
  });

  it('switches the currency in the address and keeps the other parameters', async () => {
    renderAt('/transactions?asset=BTC');
    await waitFor(() =>
      expect(within(switcher()).getByRole('radio', { name: 'EUR' })).toBeChecked(),
    );
    await userEvent.click(within(switcher()).getByRole('radio', { name: 'RUB' }));
    expect(screen.getByRole('status', { name: 'Address' })).toHaveTextContent(
      '/transactions?asset=BTC&currency=RUB',
    );
    expect(within(switcher()).getByRole('radio', { name: 'RUB' })).toBeChecked();
  });

  it('prefers the asked currency, then the page data, then the main currency', async () => {
    renderAt('/portfolio?currency=USD', <PageHeader title="Portfolio" currency="RUB" />);
    expect(within(switcher()).getByRole('radio', { name: 'USD' })).toBeChecked();
    cleanup();
    renderAt('/portfolio', <PageHeader title="Portfolio" currency="RUB" />);
    expect(within(switcher()).getByRole('radio', { name: 'RUB' })).toBeChecked();
  });

  it('follows a main currency saved in Settings at once', async () => {
    vi.spyOn(ownerSettingsApi, 'get').mockResolvedValue({
      mainCurrency: 'USD',
      dustThresholdUsd: null,
    });
    vi.spyOn(ownerSettingsApi, 'update').mockResolvedValue({
      mainCurrency: 'RUB',
      dustThresholdUsd: null,
    });
    renderAt('/preferences', <SettingsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(switcher()).getByRole('radio', { name: 'USD' })).toBeChecked(),
    );
    const main = screen.getByRole('radiogroup', { name: 'Main currency' });
    await userEvent.click(within(main).getByRole('radio', { name: 'RUB' }));
    await waitFor(() =>
      expect(within(switcher()).getByRole('radio', { name: 'RUB' })).toBeChecked(),
    );
  });
});

describe('Asset identity', () => {
  it('gives each known ticker its own colour and glyph, whatever the case', () => {
    expect(assetIdentity({ symbol: 'BTC', name: 'Bitcoin' })).toEqual({
      color: 'var(--c-btc)',
      glyph: '₿',
    });
    expect(assetIdentity({ symbol: 'eth', name: 'Ethereum' })).toEqual({
      color: 'var(--c-eth)',
      glyph: 'Ξ',
    });
    expect(assetIdentity({ symbol: 'SOL', name: 'Solana' }).color).toBe('var(--c-sol)');
    expect(assetIdentity({ symbol: 'ZEC', name: 'Zcash' }).color).toBe('var(--c-zec)');
    expect(assetIdentity({ symbol: 'TRX', name: 'TRON' }).color).toBe('var(--c-trx)');
    expect(assetIdentity({ symbol: 'XLM', name: 'Stellar' }).color).toBe('var(--c-xlm)');
    // The two dollar tokens tell apart, and neither looks like cash.
    expect(assetIdentity({ symbol: 'USDT', name: 'Tether' })).toEqual({
      color: 'var(--c-usdt)',
      glyph: '₮',
    });
    expect(assetIdentity({ symbol: 'USDC', name: 'USD Coin' }).color).toBe('var(--c-usdc)');
    expect(assetIdentity({ symbol: 'RUB', name: 'Rubles' }).glyph).toBe('₽');
  });

  it('gives an unknown token one of six colours by its ticker, the same every time', () => {
    const color = (symbol: string) =>
      assetIdentity({ symbol, name: symbol, assetType: 'crypto' }).color;
    expect(color('ORB')).toMatch(/^var\(--c-p[1-6]\)$/);
    expect(color('ORB')).toBe(color('orb'));
    const seen = new Set(['ORB', 'PEPE', 'SHIB', 'LINK', 'UNI', 'AAVE', 'MKR', 'LDO'].map(color));
    expect(seen.size).toBeGreaterThan(2);
  });

  it('falls back to a neutral colour and the first letter', () => {
    expect(assetIdentity({ symbol: 'DOGE', name: 'Dogecoin' })).toEqual({
      color: 'var(--c-other)',
      glyph: 'D',
    });
    expect(assetIdentity({ symbol: null, name: 'house' })).toEqual({
      color: 'var(--c-other)',
      glyph: 'H',
    });
    // Cash without a known ticker still reads as cash.
    expect(assetIdentity({ symbol: 'CHF', name: 'Franc', assetType: 'fiat' })).toEqual({
      color: 'var(--c-cash)',
      glyph: 'C',
    });
  });
});
