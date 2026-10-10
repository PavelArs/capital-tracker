import type { IconName } from './icons';

export interface ShellSection {
  path: string;
  label: string;
  icon: IconName;
}

// Order and names follow the accepted prototype (docs/product-requirements.md, M1).
export const shellSections: readonly ShellSection[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { path: '/transactions', label: 'Transactions', icon: 'transactions' },
  { path: '/wallets', label: 'Wallets', icon: 'wallets' },
  // `/settings` was the legacy settings screen; it now redirects here (M20).
  { path: '/preferences', label: 'Settings', icon: 'settings' },
];

// Retired screens (M20) send old bookmarks to the section that replaced them. `/assets/*`
// is not here: the web server keeps that prefix for the built bundle, so the old asset
// screens were only ever reached by in-app navigation and the browser never asks for them.
export const retiredPaths = [
  ['/legacy-overview', '/dashboard'],
  ['/liabilities', '/portfolio'],
  ['/crypto', '/wallets'],
  ['/wallet-addresses', '/wallets'],
  ['/owned-transfers', '/transactions'],
  ['/capital-flows', '/dashboard'],
  ['/period-profit', '/dashboard'],
  ['/settings', '/preferences'],
  // G1: the older screens left with their last features; accounts are made in Add asset and Add
  // wallet, prices are changed on the asset page.
  ['/manual-accounts', '/wallets'],
  ['/manual-prices', '/portfolio'],
] as const;
