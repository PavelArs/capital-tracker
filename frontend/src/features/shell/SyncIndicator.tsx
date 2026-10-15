import { cachedReads } from '@api/cached-reads';
import { SYNC_CHANGED, type SyncSource } from '@api/sync-status.api';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { needAttention } from './attention';
import { useAttention } from './attention-context';
import { summarizeSync } from './sync-summary';

// The background jobs run every few minutes; a minute keeps "8 min ago" honest.
const REFRESH_MS = 60_000;

/** Sidebar foot: whether prices and wallets are up to date; opens Wallets. */
export default function SyncIndicator({ onFollow }: { onFollow?: () => void }) {
  const [sources, setSources] = useState<SyncSource[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const attention = useAttention();

  const load = useCallback(async () => {
    try {
      setSources(await cachedReads.sources.load());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setNow(new Date());
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const changed = () => void load();
    window.addEventListener(SYNC_CHANGED, changed);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(SYNC_CHANGED, changed);
    };
  }, [load]);

  const summary =
    sources === null
      ? {
          tone: 'neutral' as const,
          title: failed ? 'Sync status unavailable' : 'Checking sync…',
          detail: failed ? 'Could not reach the server' : '',
          problems: [],
        }
      : summarizeSync(sources, now);
  // N4: the plate counts what the bell counts, so the two never disagree.
  const items = attention?.loaded ? attention.attention.items : [];
  if (items.length > 0) {
    summary.tone = 'warn';
    summary.title = needAttention(items.length);
    summary.problems = items.map((item) => item.title);
  }
  return (
    <Link
      to="/wallets"
      className={`shell-sync shell-sync--${summary.tone}`}
      data-sync-status
      title={summary.problems.join('\n') || undefined}
      onClick={onFollow}
    >
      <span className="shell-sync__dot" aria-hidden="true" />
      <span>
        <b>{summary.title}</b>
        {summary.detail}
      </span>
    </Link>
  );
}
