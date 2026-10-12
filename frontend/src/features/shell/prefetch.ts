import { cachedReads } from '@api/cached-reads';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';

// PREFETCH: a pointer over a section link, a touch on it or the keyboard focus reaching it is a
// sign the owner is about to open that section, so the reads its page starts with are asked now
// and are on their way (or kept) when the page mounts. They are the same questions the pages ask
// first (same arguments, so the same cached read and the same request in flight); a failure is
// left for the page to report when it asks again.
const AGAIN_AFTER_MS = 30_000;
const asked = new Map<string, number>();

type Reads = (currency: AccountingCurrency | undefined) => Promise<unknown>[];

const sectionReads: Record<string, Reads> = {
  '/dashboard': (currency) => [
    cachedReads.history.load('1M', currency),
    cachedReads.portfolio.load(currency),
  ],
  '/portfolio': (currency) => [cachedReads.portfolio.load(currency)],
  // The page paints its list only with the cards above it, so all three are read together.
  '/transactions': (currency) => [
    cachedReads.operations.load(currency),
    cachedReads.transferProposals.load(),
    cachedReads.duplicateProposals.load(),
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
