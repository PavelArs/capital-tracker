import { useSyncExternalStore } from 'react';

/**
 * Whether the figures on screen can be trusted as current: the browser is offline, the server
 * stopped answering reads (no answer, or a 5xx) since the last one it answered, or a read has
 * been on its way for a while. The shell says so above every page (ConnectionBanner), so a toast
 * is never the only sign that what is shown is kept from before.
 */
export interface Connection {
  /** The browser says it has no network. */
  offline: boolean;
  /** A read got no answer, and the same read has not answered since. */
  failing: boolean;
  /** A read has been on its way for more than `SLOW_MS`. */
  slow: boolean;
  /** Bumped by Retry: the shell draws the page again, which reads again. */
  attempt: number;
}

// A read slower than this is said to be refreshing.
export const SLOW_MS = 3_000;

let state: Connection = {
  offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  failing: false,
  slow: false,
  attempt: 0,
};
const listeners = new Set<() => void>();
// Reads on their way, each with the timer that marks it slow.
const pending = new Map<object, ReturnType<typeof setTimeout>>();
const slowReads = new Set<object>();
// Reads that got no answer, by what they asked for, until that same read answers.
const failedReads = new Set<unknown>();

function update(next: Partial<Connection>): void {
  const merged = { ...state, ...next };
  if (
    merged.offline === state.offline &&
    merged.failing === state.failing &&
    merged.slow === state.slow &&
    merged.attempt === state.attempt
  )
    return;
  state = merged;
  for (const listener of listeners) listener();
}

export const connection = {
  get: (): Connection => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** A read is sent; `token` names it until it settles. */
  started(token: object): void {
    pending.set(
      token,
      setTimeout(() => {
        slowReads.add(token);
        update({ slow: true });
      }, SLOW_MS),
    );
  },
  /**
   * A read settled: `answered` is true when the server gave an answer below 500, false when it
   * gave none or a 5xx, and left out when the read says nothing (cancelled, or sent again).
   * `key` names what was read, so only the same read answering clears its failure.
   */
  settled(token: object, answered?: boolean, key: unknown = token): void {
    if (!pending.has(token)) return;
    clearTimeout(pending.get(token));
    pending.delete(token);
    slowReads.delete(token);
    if (answered === true) failedReads.delete(key);
    if (answered === false) failedReads.add(key);
    update({ slow: slowReads.size > 0, failing: failedReads.size > 0 });
  },
  setOffline(offline: boolean): void {
    update({ offline });
  },
  /** Retry: the page is drawn again and reads again. */
  retry(): void {
    update({ attempt: state.attempt + 1 });
  },
  /** Tests: back to a fresh page. */
  reset(): void {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    slowReads.clear();
    failedReads.clear();
    state = {
      offline: typeof navigator !== 'undefined' && navigator.onLine === false,
      failing: false,
      slow: false,
      attempt: 0,
    };
    for (const listener of listeners) listener();
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => connection.setOffline(false));
  window.addEventListener('offline', () => connection.setOffline(true));
}

/** The connection state, kept current. */
export function useConnection(): Connection {
  return useSyncExternalStore(connection.subscribe, connection.get, connection.get);
}

/** Whether what is shown may be kept from before: offline, or reads stopped answering. */
export const showingKept = (current: Connection) => current.offline || current.failing;
