// The last answer of each read, kept so a page the owner comes back to, or a page after a reload,
// can paint it at once (stale-while-revalidate); the page still asks the server every time.
// Answers live in memory and, for the signed-in owner, also in the browser's own IndexedDB, so
// they survive a reload. They are dropped when the owner changes something, a sync lands, or the
// session ends, and never reach another owner.
import { indexedDbStore, type ReadStore } from './read-store';

// An answer older than this is not shown any more: a skeleton is more honest than old numbers.
const MAX_AGE_MS = 15 * 60_000;
// Reading the browser's store must never hold the app back.
const HYDRATE_TIMEOUT_MS = 2_000;

// `failed`: the last time it was asked again, the server did not answer, so the page warns that
// the figures may be out of date. Kept in the browser too, so the warning survives a reload.
const entries = new Map<string, { value: unknown; at: number; failed: boolean }>();
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

/** Remembers an answer unless the cache was dropped while the read was on its way. */
export function remember(key: string, value: unknown, startedIn: number): void {
  if (startedIn !== generation) return;
  const at = Date.now();
  entries.set(key, { value, at, failed: false });
  const who = owner;
  if (who) enqueue((target) => target.save({ key, owner: who, at, value }));
}

/**
 * A read asked again and failed: the answer kept for it stays shown, marked as possibly out of
 * date until an answer replaces it, also after a reload. Nothing is marked when nothing is kept
 * or the cache was dropped while the read was on its way.
 */
export function rememberFailure(key: string, startedIn: number): void {
  if (startedIn !== generation) return;
  const entry = entries.get(key);
  if (!entry || entry.failed) return;
  entry.failed = true;
  const who = owner;
  const { value, at } = entry;
  if (who) enqueue((target) => target.save({ key, owner: who, at, value, failed: true }));
}

/** Whether the last refresh of the answer kept for a key failed. */
export function refreshFailed(key: string): boolean {
  return recall(key) !== undefined && entries.get(key)?.failed === true;
}

/** When the oldest answer kept now was loaded (ms since epoch); null when nothing is kept. */
export function keptSince(): number | null {
  let oldest: number | null = null;
  for (const key of entries.keys()) {
    const entry = entries.get(key);
    if (!entry || recall(key) === undefined) continue;
    if (oldest === null || entry.at < oldest) oldest = entry.at;
  }
  return oldest;
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
        entries.set(row.key, { value: row.value, at: row.at, failed: row.failed === true });
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
