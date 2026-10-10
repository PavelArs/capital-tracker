// The last answer of each read this session, kept in memory only so a page the owner comes
// back to can paint it at once while a fresh answer loads (stale-while-revalidate). Nothing
// reaches storage, and everything is dropped when the session or the data changes.

// An answer older than this is not shown any more: a skeleton is more honest than old numbers.
const MAX_AGE_MS = 15 * 60_000;

const entries = new Map<string, { value: unknown; at: number }>();
let generation = 0;

/** The last answer for a key while it is recent enough. */
export function recall<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > MAX_AGE_MS) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/** Remembers an answer unless the cache was dropped while the read was on its way. */
export function remember(key: string, value: unknown, startedIn: number): void {
  if (startedIn === generation) entries.set(key, { value, at: Date.now() });
}

/** Marks the start of a read, so an answer that lands after a drop is not kept. */
export const generationNow = () => generation;

/** After a change by the owner, a sync or a sign-in or sign-out: nothing old may be painted. */
export function forgetReads(): void {
  generation++;
  entries.clear();
}
