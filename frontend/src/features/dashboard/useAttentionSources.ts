import { cachedReads } from '@api/cached-reads';
import { CLASSIFICATION_CHANGED } from '@api/operations.api';
import { SYNC_CHANGED, type SyncSource } from '@api/sync-status.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { useCallback, useEffect, useRef, useState } from 'react';

// Background sync and the price job run every few minutes; a minute keeps the block honest.
const REFRESH_MS = 60_000;

export interface AttentionSources {
  /** False until the first read has answered or failed. */
  loaded: boolean;
  toClassify: number | null;
  sources: SyncSource[] | null;
  wallets: WalletAddress[] | null;
  now: Date;
}

const settled = <T>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

/**
 * DASH-ATTENTION inputs: the classification count, every background source and the tracked
 * wallets, read again every minute and whenever a sync or an answer changes them. A read
 * that fails leaves its part unknown (null) instead of keeping an older answer.
 */
export function useAttentionSources(): AttentionSources {
  // Coming back to the page shows the last answers while the reads below run again.
  const [state, setState] = useState<AttentionSources>(() => {
    const toClassify = cachedReads.toClassify.last() ?? null;
    const sources = cachedReads.sources.last() ?? null;
    const wallets = cachedReads.wallets.last() ?? null;
    return {
      loaded: toClassify !== null && sources !== null && wallets !== null,
      toClassify,
      sources,
      wallets,
      now: new Date(),
    };
  });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    const [toClassify, sources, wallets] = await Promise.allSettled([
      cachedReads.toClassify.load(),
      cachedReads.sources.load(),
      cachedReads.wallets.load(),
    ]);
    if (request !== latest.current) return;
    setState({
      loaded: true,
      toClassify: settled(toClassify),
      sources: settled(sources),
      wallets: settled(wallets),
      now: new Date(),
    });
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const changed = () => void load();
    window.addEventListener(SYNC_CHANGED, changed);
    window.addEventListener(CLASSIFICATION_CHANGED, changed);
    return () => {
      latest.current += 1;
      window.clearInterval(timer);
      window.removeEventListener(SYNC_CHANGED, changed);
      window.removeEventListener(CLASSIFICATION_CHANGED, changed);
    };
  }, [load]);

  return state;
}
