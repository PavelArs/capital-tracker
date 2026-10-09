import type { ProviderFailure, WalletAddress } from '@api/wallet-addresses.api';
import { age } from '../portfolio/format';
import { networkOf } from './networks';

/** A sync this page started: still running, or its last attempt failed. */
export type SyncRun = { state: 'running' } | { state: 'failed'; message: string };

/** Why the page's own sync stopped, naming the network's data ("Bitcoin data …"). */
export function failureMessage(
  reason: ProviderFailure | 'server' | 'busy',
  address?: Pick<WalletAddress, 'network'>,
): string {
  const network = address ? networkOf(address).name : 'Blockchain';
  switch (reason) {
    case 'rate_limited':
      return `The ${network} data source is busy. Try again in a few minutes.`;
    case 'unavailable':
      return `${network} data is temporarily unavailable.`;
    case 'invalid_response':
      return `The ${network} data source sent an answer the app cannot read. Try again later.`;
    case 'not_configured':
      return address?.network === 'bybit'
        ? 'The stored Bybit API key cannot be read on this server. Add the account again with its read-only key.'
        : `${network} sync needs a valid Etherscan API key on the server.`;
    case 'key_rejected':
      return `${network} did not accept the API key: it may have expired or been deleted. Add the account again with a new read-only key.`;
    case 'server':
      return 'Could not reach the server. Try again.';
    case 'busy':
      return 'Another sync of this address is running. Try again in a moment.';
  }
}

type Badge = { label: string; tone: 'pos' | 'info' | 'warn' | 'neg' | 'neutral' };

/** The background job's view first (M11), then what the page itself is doing. */
export function syncBadge(address: WalletAddress, run: SyncRun | undefined): Badge {
  if (run?.state === 'running') return { label: 'Syncing', tone: 'info' };
  if (run?.state === 'failed') return { label: 'Sync failed', tone: 'neg' };
  const { status, state } = address.sync;
  if (status === 'syncing') return { label: 'Syncing', tone: 'info' };
  if (status === 'failed') return { label: 'Sync failed', tone: 'neg' };
  if (status === 'delayed') return { label: 'Delayed', tone: 'warn' };
  if (state === 'complete') return { label: 'Synced', tone: 'pos' };
  if (state === 'partial') return { label: 'Partly loaded', tone: 'warn' };
  return { label: 'Not synced', tone: 'neutral' };
}

export function SyncBadge({ address, run }: { address: WalletAddress; run?: SyncRun }) {
  const { label, tone } = syncBadge(address, run);
  return <span className={`wallets-badge wallets-badge--${tone}`}>{label}</span>;
}

/** The last time the whole history was up to date, if ever. */
function lastSynced(address: WalletAddress): string | null {
  return address.sync.lastSuccessAt ?? address.sync.completedAt;
}

/**
 * "8 min ago" next to "Synced"; nothing while running, never finished or failing, where the
 * message says how old the shown balance is.
 */
export function syncAge(address: WalletAddress, run: SyncRun | undefined, now = new Date()) {
  const last = lastSynced(address);
  const { status } = address.sync;
  if (run || status === 'syncing' || status === 'failed' || status === 'delayed' || !last) {
    return '';
  }
  return age(last, now);
}

/**
 * SYNC-STATUS: why the wallet is not up to date, in plain words, with how old the shown
 * balance is. The page's own failed attempt wins over the stored one it just replaced.
 */
export function syncProblem(
  address: WalletAddress,
  run: SyncRun | undefined,
  now = new Date(),
): string | null {
  if (run?.state === 'running') return null;
  const reason =
    run?.state === 'failed'
      ? run.message
      : address.sync.status === 'failed' || address.sync.status === 'delayed'
        ? (address.sync.errorMessage ?? failureMessage('unavailable', address))
        : null;
  if (reason === null) return null;
  const last = lastSynced(address);
  return last && address.chainBalance !== null
    ? `${reason} Balances shown are from ${age(last, now)}.`
    : reason;
}
