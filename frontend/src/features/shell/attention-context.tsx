import { cachedReads } from '@api/cached-reads';
import type { HiddenAsset } from '@api/hidden-assets.api';
import { CLASSIFICATION_CHANGED } from '@api/operations.api';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { SYNC_CHANGED, type SyncSource } from '@api/sync-status.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAskedCurrency } from '../portfolio/currency';
import { type Attention, collectAttention } from './attention';

// Background sync and the price job run every few minutes; a minute keeps the bell honest.
const REFRESH_MS = 60_000;

export interface AttentionState {
  /** False until the first read has answered or failed. */
  loaded: boolean;
  attention: Attention;
  /** The tracked wallets, null where they could not be read. */
  wallets: WalletAddress[] | null;
  now: Date;
  /** Reads everything again, e.g. after the owner saved a transaction. */
  refresh: () => void;
}

interface Sources {
  loaded: boolean;
  toClassify: number | null;
  sources: SyncSource[] | null;
  wallets: WalletAddress[] | null;
  portfolio: PortfolioValuation | null;
  hiddenAssets: HiddenAsset[] | null;
  now: Date;
}

const AttentionContext = createContext<AttentionState | null>(null);

const settled = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

/**
 * ATTN-BELL inputs for the whole shell: the classification count, every background source,
 * the tracked wallets and today's valuation, read once for all pages, again every minute and
 * whenever a sync or an answer changes them. A read that fails leaves its part unknown
 * (null) instead of keeping an older answer.
 */
export function AttentionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Sources>({
    loaded: false,
    toClassify: null,
    sources: null,
    wallets: null,
    portfolio: null,
    hiddenAssets: null,
    now: new Date(),
  });
  const latest = useRef(0);
  // The bell reads the valuation in the page's currency, so both share one request and answer.
  const [asked] = useAskedCurrency();
  const askedRef = useRef(asked);
  askedRef.current = asked;

  const load = useCallback(async () => {
    const request = ++latest.current;
    const [toClassify, sources, wallets, portfolio, hiddenAssets] = await Promise.allSettled([
      cachedReads.toClassify.load(),
      cachedReads.sources.load(),
      cachedReads.wallets.load(),
      cachedReads.portfolio.load(askedRef.current),
      cachedReads.hiddenAssets.load(),
    ]);
    if (request !== latest.current) return;
    setState({
      loaded: true,
      toClassify: settled(toClassify),
      sources: settled(sources),
      wallets: settled(wallets),
      portfolio: settled(portfolio),
      hiddenAssets: settled(hiddenAssets),
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

  const value = useMemo<AttentionState>(
    () => ({
      loaded: state.loaded,
      attention: collectAttention(state),
      wallets: state.wallets,
      now: state.now,
      refresh: () => void load(),
    }),
    [state, load],
  );
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>;
}

/** Null outside the shell, where a page simply has no bell. */
export function useAttention(): AttentionState | null {
  return useContext(AttentionContext);
}
