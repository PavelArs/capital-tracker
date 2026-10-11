// The last answer of each read, kept so a page the owner comes back to can paint it at once
// (stale-while-revalidate) and a reload does not ask the server again for what it just said.
// Answers live in memory and, for the signed-in owner, also in the browser's own IndexedDB, so
// they survive a reload. They are dropped when the owner changes something, a sync lands, or the
// session ends, and never reach another owner.
import { indexedDbStore, type ReadStore } from './read-store';

// An answer older than this is not shown any more: a skeleton is more honest than old numbers.
const MAX_AGE_MS = 15 * 60_000;
// Reading the browser's store must never hold the app back.
const HYDRATE_TIMEOUT_MS = 2_000;

// `restored`: kept by the browser from before a reload and not asked again since.
const entries = new Map<string, { value: unknown; at: number; restored: boolean }>();
let generation = 0;
let owner: string | null = null;
let store: ReadStore | null | undefined;
// Writes to the store go one after another, so a clear never overtakes the answer before it.
let queue: Promise<unknown> = Promise.resolve();

const browserStore = (): ReadStore | null => {
  if (store === undefined) store = indexedDbStore();
  return store;
};

function enqueue(job: (target: ReadStore) => Promise<unknown>): void {
  const target = browserStore();
  if (!target) return;
  queue = queue.then(() => job(target)).catch(() => undefined);
}

/** Replaces where answers are persisted (null: nowhere); tests use it. */
export function setReadStore(next: ReadStore | null): void {
  store = next;
  queue = Promise.resolve();
}

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

/**
 * An answer the browser kept from before a reload, while it is younger than `within`
 * milliseconds: the page uses it as it is instead of asking the server again. An answer
 * fetched since the reload is never reused this way; the page always loads.
 */
export function recallRestored<T>(key: string, within: number): T | undefined {
  const entry = entries.get(key);
  if (!entry?.restored || Date.now() - entry.at >= within) return undefined;
  return recall<T>(key);
}

/** Remembers an answer unless the cache was dropped while the read was on its way. */
export function remember(key: string, value: unknown, startedIn: number): void {
  if (startedIn !== generation) return;
  const at = Date.now();
  entries.set(key, { value, at, restored: false });
  const who = owner;
  if (who) enqueue((target) => target.save({ key, owner: who, at, value }));
}

/** Marks the start of a read, so an answer that lands after a drop is not kept. */
export const generationNow = () => generation;

/** After a change by the owner, a sync or a sign-in or sign-out: nothing old may be painted. */
export function forgetReads(): void {
  generation++;
  entries.clear();
  enqueue((target) => target.clear());
}

/**
 * The owner is signed in: the answers the browser kept for them come back into memory. Anything
 * kept for someone else, or too old to paint, is not used and the store is emptied of it.
 */
export async function hydrateReads(ownerId: string): Promise<void> {
  const startedIn = generation;
  owner = ownerId;
  const target = browserStore();
  if (!target) return;
  try {
    const rows = await Promise.race([
      target.load(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), HYDRATE_TIMEOUT_MS);
      }),
    ]);
    // A change or a sign-out while reading: whatever was kept is old now.
    if (startedIn !== generation || owner !== ownerId) return;
    if (rows.some((row) => row.owner !== ownerId)) {
      enqueue((last) => last.clear());
      return;
    }
    const now = Date.now();
    for (const row of rows) {
      if (now - row.at <= MAX_AGE_MS && !entries.has(row.key))
        entries.set(row.key, { value: row.value, at: row.at, restored: true });
    }
  } catch {
    // Nothing kept, or the browser would not say: the pages ask the server as usual.
  }
}

/** The owner is signed out (or was never signed in): nothing is kept, in memory or in the browser. */
export function releaseReads(): void {
  owner = null;
  forgetReads();
}

/** A sign-in just succeeded: answers from now on are kept for this owner. */
export function adoptReads(ownerId: string): void {
  owner = ownerId;
}
