import type { ProviderFailure, WalletAddress } from '@api/wallet-addresses.api';
import { age } from '../portfolio/format';

/** A sync this page started: still running, or its last attempt failed. */
export type SyncRun = { state: 'running' } | { state: 'failed'; message: string };

export const failureMessages: Record<ProviderFailure | 'server' | 'busy', string> = {
  rate_limited: 'The Bitcoin data source is busy. Try again in a few minutes.',
  unavailable: 'Bitcoin data is temporarily unavailable. Balances shown are from the last sync.',
  invalid_response: 'The Bitcoin data source sent an answer the app cannot read. Try again later.',
  server: 'Could not reach the server. Try again.',
  busy: 'Another sync of this address is running. Try again in a moment.',
};

type Badge = { label: string; tone: 'pos' | 'info' | 'warn' | 'neg' | 'neutral' };

export function syncBadge(address: WalletAddress, run: SyncRun | undefined): Badge {
  if (run?.state === 'running') return { label: 'Syncing', tone: 'info' };
  if (run?.state === 'failed') return { label: 'Sync failed', tone: 'neg' };
  if (address.sync.state === 'complete') return { label: 'Synced', tone: 'pos' };
  if (address.sync.state === 'partial') return { label: 'Partly loaded', tone: 'warn' };
  return { label: 'Not synced', tone: 'neutral' };
}

export function SyncBadge({ address, run }: { address: WalletAddress; run?: SyncRun }) {
  const { label, tone } = syncBadge(address, run);
  return <span className={`wallets-badge wallets-badge--${tone}`}>{label}</span>;
}

/** "8 min ago" for a complete history; nothing while running or never finished. */
export function syncAge(address: WalletAddress, run: SyncRun | undefined, now = new Date()) {
  if (run?.state === 'running' || !address.sync.completedAt) return '';
  return age(address.sync.completedAt, now);
}
