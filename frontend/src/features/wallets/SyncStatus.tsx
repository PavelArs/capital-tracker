import type { ProviderFailure, WalletAddress } from '@api/wallet-addresses.api';
import Badge from '@/ui/Badge';
import { age } from '../portfolio/format';
import { networkOf } from './networks';

/** A sync this page started: still running, or its last attempt failed. */
export type SyncRun = { state: 'running' } | { state: 'failed'; message: string };

/** Why the page's own sync stopped, naming the network's data ("Bitcoin data …"). */
export function failureMessage(
  reason: ProviderFailure | 'server' | 'failed' | 'session' | 'busy',
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
      if (address?.network === 'tron')
        return 'TronGrid refused the requests. A free TronGrid API key on the server lets the app read Tron wallets.';
      if (address?.network === 'zcash')
        return 'The Zcash data sources refused the requests. A free NOWNodes API key on the server lets the app read Zcash wallets.';
      return address?.network === 'bybit'
        ? 'The stored Bybit API key cannot be read on this server. Add the account again with its read-only key.'
        : `${network} sync needs a valid Etherscan API key on the server.`;
    case 'key_rejected':
      return `${network} did not accept the API key: it may have expired or been deleted. Add the account again with a new read-only key.`;
    case 'plan_required':
      return `The free Etherscan plan does not cover ${network}, and no other free source is set up for it yet.`;
    case 'server':
      return 'Could not reach the server. Try again.';
    case 'failed':
      return 'The server could not finish the sync. Try again.';
    case 'session':
      return 'Your session has ended. Sign in again.';
    case 'busy':
      return 'Another sync of this address is running. Try again in a moment.';
  }
}

/** WALLET-SYNC-OFF: three failed passes in a row make the app switch a wallet's sync off. */
export const SYNC_OFF_AFTER = 3;

type SyncState = { label: string; tone: 'pos' | 'info' | 'warn' | 'neg' | 'neutral' };

/** The background job's view first (M11), then what the page itself is doing. */
export function syncBadge(address: WalletAddress, run: SyncRun | undefined): SyncState {
  if (run?.state === 'running') return { label: 'Syncing', tone: 'info' };
  // A switched-off wallet reads nothing, so what its last pass said no longer describes it.
  if (address.sync.off)
    return { label: 'Sync off', tone: address.sync.off.reason === 'failures' ? 'warn' : 'neutral' };
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
  // A sync running right now pulses (prototype "Syncing").
  return (
    <Badge tone={tone} dot pulse={label === 'Syncing'}>
      {label}
    </Badge>
  );
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
  if (
    address.sync.off ||
    run ||
    status === 'syncing' ||
    status === 'failed' ||
    status === 'delayed' ||
    !last
  ) {
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
  if (run?.state === 'running' || address.sync.off) return null;
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

/**
 * WALLET-SYNC-OFF: why a wallet is not read any more, how old the shown balance is, and that the
 * transactions found so far stay. Null while the sync is on.
 */
export function syncOffNote(
  address: WalletAddress,
  now = new Date(),
): { tone: 'warn' | 'info'; text: string } | null {
  const { off } = address.sync;
  if (!off) return null;
  const last = lastSynced(address);
  const stale =
    last && address.chainBalance !== null ? ` Balances shown are from ${age(last, now)}.` : '';
  const kept = ' The transactions found so far stay.';
  if (off.reason === 'manual')
    return { tone: 'info', text: `Sync is switched off.${stale}${kept}` };
  const cause = address.sync.errorMessage ? ` ${address.sync.errorMessage}` : '';
  return {
    tone: 'warn',
    text: `Sync was switched off after ${SYNC_OFF_AFTER} failed attempts in a row.${cause}${stale}${kept}`,
  };
}
