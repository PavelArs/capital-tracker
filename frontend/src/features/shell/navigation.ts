import type { IconName } from './icons';

export type PlaceholderSection = 'dashboard' | 'portfolio' | 'transactions' | 'wallets';

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
  // `/settings` stays the legacy settings screen until it is retired (M20).
  { path: '/preferences', label: 'Settings', icon: 'settings' },
];

// Current screens keep their URLs and Russian names until a later change replaces them (D6).
export const legacyLinks = [
  ['/manual-accounts', 'Ручные счета'],
  ['/owned-transfers', 'Переводы между счетами'],
  ['/capital-flows', 'Вводы и выводы'],
  ['/manual-prices', 'Ручные цены'],
  ['/wallet-addresses', 'Адреса кошельков'],
  ['/period-profit', 'Прибыль за период'],
  ['/settings', 'Настройки'],
  ['/legacy-overview', 'Прежний обзор'],
  ['/assets', 'Активы'],
  ['/crypto', 'Криптокошельки'],
] as const;

export function isLegacyPath(pathname: string) {
  return legacyLinks.some(([path]) => pathname === path || pathname.startsWith(`${path}/`));
}

export interface PlaceholderContent {
  title: string;
  icon: IconName;
  description: string;
  legacyPath: string;
  legacyLabel: string;
}

export const placeholderSections: Record<PlaceholderSection, PlaceholderContent> = {
  dashboard: {
    title: 'Dashboard',
    icon: 'dashboard',
    description:
      'Total net worth, change for the period, the history chart and allocation will appear here.',
    legacyPath: '/manual-accounts',
    legacyLabel: 'Open manual accounts',
  },
  portfolio: {
    title: 'Portfolio',
    icon: 'portfolio',
    description:
      'Every asset across your accounts with quantity, value, cost basis and profit will appear here.',
    legacyPath: '/manual-accounts',
    legacyLabel: 'Open manual accounts',
  },
  transactions: {
    title: 'Transactions',
    icon: 'transactions',
    description: 'All purchases, sales, transfers and other operations will be listed here.',
    legacyPath: '/manual-accounts',
    legacyLabel: 'Open manual accounts',
  },
  wallets: {
    title: 'Wallets',
    icon: 'wallets',
    description: 'Your wallets with addresses, balances and sync status will appear here.',
    legacyPath: '/wallet-addresses',
    legacyLabel: 'Open wallet addresses',
  },
};
