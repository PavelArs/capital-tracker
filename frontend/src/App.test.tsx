import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

// Routing only: the signed-in owner and every screen are stand-ins, so a URL shows which
// screen the application chose. Real login and navigation run in SHELL-UI.
vi.mock('@contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: { id: 'owner', email: 'owner@example.test' }, loading: false }),
}));
vi.mock('@components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});
const { screenNamed } = vi.hoisted(() => ({
  screenNamed: (name: string) => ({ default: () => <h1>{name}</h1> }),
}));
vi.mock('@features/dashboard/DashboardPage', () => screenNamed('Dashboard'));
vi.mock('@features/portfolio/PortfolioPage', () => screenNamed('Portfolio'));
vi.mock('@features/transactions/TransactionsPage', () => screenNamed('Transactions'));
vi.mock('@features/wallets/WalletsPage', () => screenNamed('Wallets'));
vi.mock('@features/shell/SettingsPage', () => screenNamed('Settings'));
vi.mock('@pages/ManualAccounts', () => screenNamed('Ручные счета'));
vi.mock('@pages/ManualPrices', () => screenNamed('Ручные цены'));

function open(path: string) {
  window.history.replaceState(null, '', path);
  render(<App />);
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('LEGACY-RETIRE: retired screens send old bookmarks to their replacement', () => {
  it.each([
    ['/legacy-overview', '/dashboard', 'Dashboard'],
    ['/assets', '/portfolio', 'Portfolio'],
    ['/assets/stock', '/portfolio', 'Portfolio'],
    ['/liabilities', '/portfolio', 'Portfolio'],
    ['/crypto', '/wallets', 'Wallets'],
    ['/wallet-addresses', '/wallets', 'Wallets'],
    ['/owned-transfers', '/transactions', 'Transactions'],
    ['/capital-flows', '/dashboard', 'Dashboard'],
    ['/period-profit', '/dashboard', 'Dashboard'],
    ['/settings', '/preferences', 'Settings'],
  ])('%s opens %s', async (old, replacement, heading) => {
    open(old);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(window.location.pathname).toBe(replacement);
  });

  it.each([
    ['/manual-accounts', 'Ручные счета'],
    ['/manual-prices', 'Ручные цены'],
  ])('keeps %s, which no new screen covers yet', async (path, heading) => {
    open(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
  });
});
