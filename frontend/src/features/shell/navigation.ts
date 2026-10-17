import type { AccountClass } from '@api/accounting.api';
import type { IconName } from './icons';

export interface ShellSection {
  path: string;
  label: string;
  icon: IconName;
  /** v8: shown once the owner holds an account of this class, or while it is open. */
  held?: AccountClass;
}

// Order and names follow the accepted prototype (docs/product-requirements.md, M1).
export const shellSections: readonly ShellSection[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { path: '/transactions', label: 'Transactions', icon: 'transactions' },
  { path: '/wallets', label: 'Wallets', icon: 'wallets' },
  { path: '/deposits', label: 'Banks', icon: 'bank' },
  { path: '/brokers', label: 'Brokers', icon: 'briefcase', held: 'broker' },
  { path: '/real-estate', label: 'Real estate', icon: 'home', held: 'property' },
  { path: '/goals', label: 'Goals', icon: 'target' },
  { path: '/history', label: 'History', icon: 'clock' },
  // `/settings` was the legacy settings screen; it now redirects here (M20).
  { path: '/preferences', label: 'Settings', icon: 'settings' },
];

/** The phone tab bar's sections; every other one is in the More sheet (polish §3). */
export const tabSections: readonly string[] = [
  '/dashboard',
  '/portfolio',
  '/transactions',
  '/goals',
];

/** Whether `pathname` is the section at `path` or a page under it. */
export const inSection = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export const appTitle = 'Capital Tracker';

// The pages under a section, named in the browser tab without their record's name.
const detailTitles: readonly (readonly [string, string])[] = [
  ['/portfolio/', 'Asset'],
  ['/wallets/', 'Wallet'],
  ['/deposits/', 'Deposit'],
  ['/goals/', 'Goal'],
];

/** The browser tab title of a page: its section or page kind, then the app (WCAG 2.4.2). */
export function pageTitle(pathname: string): string {
  const name =
    shellSections.find((section) => section.path === pathname)?.label ??
    detailTitles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ??
    null;
  return name ? `${name} · ${appTitle}` : appTitle;
}

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
