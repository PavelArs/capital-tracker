import {
  type SyncRunEntry,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { useEffect, useState } from 'react';
import Badge, { type BadgeTone } from '@/ui/Badge';
import { dayClockText } from '@/utils/dates';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { failureMessage, type SyncRun } from './SyncStatus';

const badges: Record<SyncRunEntry['state'], { label: string; tone: BadgeTone }> = {
  synced: { label: 'Synced', tone: 'pos' },
  partial: { label: 'Partly loaded', tone: 'info' },
  delayed: { label: 'Delayed', tone: 'warn' },
  failed: { label: 'Failed', tone: 'neg' },
};

const stored = (count: number) => `${count} new transaction${count === 1 ? '' : 's'}`;

/** What the pass did, in a sentence: what it stored, or why it stopped. */
export function explain(entry: SyncRunEntry, address: Pick<WalletAddress, 'network'>): string {
  if (entry.state === 'synced')
    return entry.imported > 0 ? `Stored ${stored(entry.imported)}.` : 'Up to date. Nothing new.';
  if (entry.state === 'partial')
    return `Stored ${stored(entry.imported)}. More history loads on the next pass.`;
  const reason = entry.message ?? failureMessage('unavailable', address);
  return entry.imported > 0
    ? `${reason} Stored ${stored(entry.imported)} before it stopped.`
    : reason;
}

interface Props {
  address: WalletAddress;
  run: SyncRun | undefined;
}

// W3: the sync card of the wallet's page in the prototype: when each pass ran, how it ended and
// why, newest first. Only the latest pass is kept in the wallet's own status.
export default function SyncJournal({ address, run }: Props) {
  // undefined while loading, null when the read failed.
  const [entries, setEntries] = useState<SyncRunEntry[] | null | undefined>(undefined);
  const running = run?.state === 'running';
  const lastAttemptAt = address.sync.lastAttemptAt;

  // A pass that ends (this page's or the background job's) adds a row: read again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the last attempt and the page's own run only say when to read again.
  useEffect(() => {
    if (running) return;
    let live = true;
    walletAddressesApi
      .syncRuns(address.id)
      .then((items) => live && setEntries(items))
      .catch(() => live && setEntries(null));
    return () => {
      live = false;
    };
  }, [address.id, lastAttemptAt, running]);

  // PAGES: twenty passes a page.
  const paged = useInfinite(entries ?? []);
  return (
    <section aria-labelledby="address-sync-journal">
      <h3 id="address-sync-journal" className="ui-section-t">
        Sync history
      </h3>
      {!entries?.length ? (
        <p className="ui-muted wallets-small">
          {entries === null
            ? 'Could not load the history.'
            : entries
              ? 'No syncs recorded yet. They appear here after the next one.'
              : 'Loading…'}
        </p>
      ) : (
        <ul className="wallets-list wallets-journal">
          {paged.rows.map((entry) => (
            <li key={entry.at}>
              <Badge tone={badges[entry.state].tone} dot>
                {badges[entry.state].label}
              </Badge>
              <time className="ui-muted wallets-small" dateTime={entry.at}>
                {dayClockText(entry.at)} UTC
              </time>
              <span className="wallets-journal__text">{explain(entry, address)}</span>
            </li>
          ))}
        </ul>
      )}
      {paged.more && <LoadMore {...paged.more} label="sync passes" />}
    </section>
  );
}
