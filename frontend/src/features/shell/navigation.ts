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

// Screens the new sections do not cover yet keep their URLs and Russian names (D6, M20): CSV
// import and trades by hand per account, and changing a manual price after the asset exists.
// They are no longer in the sidebar (G1); Settings lists them as "Older screens".
export const olderScreens = [
  {
    path: '/manual-accounts',
    label: 'Manual accounts',
    hint: 'Opening balances, trades added by hand and CSV import for each account.',
  },
  {
    path: '/manual-prices',
    label: 'Manual prices',
    hint: 'Change the stored price of an asset you value by hand.',
  },
] as const;

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
] as const;

/** Settings is the current section on the older screens it lists. */
export function isOlderScreenPath(pathname: string) {
  return olderScreens.some(({ path }) => pathname === path || pathname.startsWith(`${path}/`));
}
