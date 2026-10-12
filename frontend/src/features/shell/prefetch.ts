import { cachedReads } from '@api/cached-reads';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';

// PREFETCH: a pointer over a section link, a touch on it or the keyboard focus reaching it is a
// sign the owner is about to open that section, so the reads its page starts with are asked now,
// and the page that mounts within seconds takes those answers (or the requests still on their
// way) instead of asking again. They are the same questions the pages ask first, with the same
// arguments; a failure is left for the page to report when it asks.
const AGAIN_AFTER_MS = 30_000;
const asked = new Map<string, number>();

type Reads = (currency: AccountingCurrency | undefined) => Promise<unknown>[];

const sectionReads: Record<string, Reads> = {
  '/dashboard': (currency) => [
    cachedReads.history.prefetch('1M', currency),
    cachedReads.portfolio.prefetch(currency),
  ],
  '/portfolio': (currency) => [cachedReads.portfolio.prefetch(currency)],
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
  const reads = sectionReads[path];
  if (!reads) return;
  const key = `${path}|${currency ?? ''}`;
  const last = asked.get(key);
  if (last !== undefined && now - last < AGAIN_AFTER_MS) return;
  asked.set(key, now);
  for (const read of reads(currency)) read.catch(() => undefined);
}

/** Forgets what was asked, so the next look asks again (tests). */
export function resetPrefetch(): void {
  asked.clear();
}
