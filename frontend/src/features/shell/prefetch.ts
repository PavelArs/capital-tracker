import { cachedReads } from '@api/cached-reads';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { sectionPage, warmedPages } from './route-pages';

// PREFETCH: a pointer over a section link, a touch on it or the keyboard focus reaching it is a
// sign the owner is about to open that section, so the reads its page starts with are asked now,
// and the page that mounts within seconds takes those answers (or the requests still on their
// way) instead of asking again. They are the same questions the pages ask first, with the same
// arguments; a failure is left for the page to report when it asks. The screen's own file (see
// route-pages.ts) is fetched at the same moment.
const AGAIN_AFTER_MS = 30_000;
const asked = new Map<string, number>();

type Reads = (currency: AccountingCurrency | undefined) => Promise<unknown>[];

const sectionReads: Record<string, Reads> = {
  '/dashboard': (currency) => [
    cachedReads.history.prefetch('1M', currency),
    cachedReads.portfolio.prefetch(currency),
  ],
  '/portfolio': (currency) => [cachedReads.portfolio.prefetch(currency)],
  '/deposits': () => [cachedReads.deposits.prefetch()],
  // The page paints its list only with the cards above it, so all three are read together.
  '/transactions': (currency) => [
    cachedReads.operations.prefetch(currency),
    cachedReads.transferProposals.prefetch(),
    cachedReads.duplicateProposals.prefetch(),
  ],
};

export function prefetchSection(
  path: string,
  currency: AccountingCurrency | undefined,
  now = Date.now(),
): void {
  // The file of the screen comes first: asking again for a file already fetched costs nothing.
  sectionPage[path]?.().catch(() => undefined);
  const reads = sectionReads[path];
  if (!reads) return;
  const key = `${path}|${currency ?? ''}`;
  const last = asked.get(key);
  if (last !== undefined && now - last < AGAIN_AFTER_MS) return;
  asked.set(key, now);
  for (const read of reads(currency)) read.catch(() => undefined);
}

const WARM_AFTER_MS = 1_500;

/**
 * Once the owner is signed in and the first screen has settled, fetches the files of the other
 * screens one after another while the browser is idle, so opening one later costs no download
 * even without the pointer visiting its menu link first. A file is asked for only once the
 * one before it has arrived (or failed), so a slow connection is never shared out among several.
 * Returns what stops it.
 */
export function warmPages(): () => void {
  const loaders = warmedPages;
  // Idle callbacks where the browser has them (Safari does not); a short wait elsewhere.
  const idle = typeof window.requestIdleCallback === 'function';
  let stopped = false;
  let pending: number | undefined;
  const next = (index: number) => {
    if (stopped || index >= loaders.length) return;
    const load = () => {
      void loaders[index]()
        .catch(() => undefined)
        .then(() => next(index + 1));
    };
    pending = idle
      ? window.requestIdleCallback(load, { timeout: 4_000 })
      : window.setTimeout(load, 250);
  };
  const start = window.setTimeout(() => next(0), WARM_AFTER_MS);
  return () => {
    stopped = true;
    window.clearTimeout(start);
    if (pending === undefined) return;
    if (idle) window.cancelIdleCallback(pending);
    else window.clearTimeout(pending);
  };
}

/** Forgets what was asked, so the next look asks again (tests). */
export function resetPrefetch(): void {
  asked.clear();
}
