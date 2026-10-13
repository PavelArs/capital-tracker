import { lazyPage } from './lazy-page';

// SPLIT: every screen but the Dashboard (where the owner lands) and the sign-in comes as a file
// of its own, fetched when the screen is first opened. The same files are fetched ahead when the
// pointer reaches a menu link (prefetch.ts) and, a moment after sign-in, while the browser is idle.
export const pages = {
  portfolio: lazyPage(() => import('@features/portfolio/PortfolioPage')),
  asset: lazyPage(() => import('@features/portfolio/AssetPage')),
  transactions: lazyPage(() => import('@features/transactions/TransactionsPage')),
  wallets: lazyPage(() => import('@features/wallets/WalletsPage')),
  wallet: lazyPage(() => import('@features/wallets/WalletPage')),
  deposits: lazyPage(() => import('@features/deposits/DepositsPage')),
  deposit: lazyPage(() => import('@features/deposits/DepositPage')),
  realEstate: lazyPage(() => import('@features/property/RealEstatePage')),
  settings: lazyPage(() => import('@features/shell/SettingsPage')),
  history: lazyPage(() => import('@features/history/HistoryPage')),
  forgotPassword: lazyPage(() => import('@features/password-reset/ForgotPasswordPage')),
  resetPassword: lazyPage(() => import('@features/password-reset/ResetPasswordPage')),
};

/** The screen file behind each menu section, for fetching it ahead. */
export const sectionPage: Record<string, () => Promise<unknown>> = {
  '/portfolio': pages.portfolio.preload,
  '/transactions': pages.transactions.preload,
  '/wallets': pages.wallets.preload,
  '/deposits': pages.deposits.preload,
  '/real-estate': pages.realEstate.preload,
  '/preferences': pages.settings.preload,
  '/history': pages.history.preload,
};
