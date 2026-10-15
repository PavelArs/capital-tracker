import { useCallback, useEffect, useRef, useState } from 'react';

/** What a `cachedReads` entry offers a page: the last answer, and a load that keeps the next one. */
interface CachedSource<A extends unknown[], T> {
  last: (...args: A) => T | undefined;
  load: (...args: A) => Promise<T>;
  /** Whether asking again for the last answer failed, also before a reload. */
  failed?: (...args: A) => boolean;
}

/** What the hook holds, and the arguments (as a key) it was read for. */
interface Held<T> {
  key: string;
  data: T | null;
  error: unknown;
  /** A load failed while `data` was shown, and no answer has replaced it since. */
  failed: boolean;
}

export interface CachedRead<T> {
  /** The answer shown: the last one kept, then the one the server gave; null until there is one. */
  data: T | null;
  /** Why the newest load failed (data keeps what was shown before); null when it did not. */
  error: unknown;
  /**
   * The answer shown may be out of date: asking again failed, now or before a reload, and no
   * answer has replaced it since. A load on its way keeps the warning until it answers.
   */
  stale: boolean;
  /** Asks again. `quiet` keeps what is shown meanwhile; otherwise the kept answer (or nothing). */
  reload: (quiet?: boolean) => void;
  /** Shows an answer the page got elsewhere (a save returns the new state) instead of asking. */
  replace: (next: T) => void;
}

/**
 * The way a page reads: it paints the last answer at once (stale-while-revalidate), loads in the
 * background, lets only the newest load change the page, and drops answers that arrive after the
 * page moved on. Every page that shows a read from `cachedReads` uses this instead of its own
 * state, effect and counter. Pass the arguments the read takes; a change of arguments loads
 * again and shows the kept answer for the new ones, never the old ones.
 *
 * ```tsx
 * const { data: list, error } = useCachedRead(cachedReads.deposits);
 * const { data: deposit, error, replace } = useCachedRead(cachedReads.deposit, depositId);
 * ```
 */
export function useCachedRead<A extends unknown[], T>(
  source: CachedSource<A, T>,
  ...args: A
): CachedRead<T> {
  const key = JSON.stringify(args);
  // What the cache keeps for some arguments, with whether its refresh failed (also before a reload).
  const kept = (read: A): Omit<Held<T>, 'key' | 'error'> => {
    const data = source.last(...read) ?? null;
    return { data, failed: data !== null && source.failed?.(...read) === true };
  };
  const [state, setState] = useState<Held<T>>(() => ({ key, error: null, ...kept(args) }));
  const latest = useRef(0);
  const asked = useRef({ args, key });
  asked.current = { args, key };

  // The state belongs to the arguments it was read for. On the render where they change, it is
  // not shown: the kept answer for the new arguments is (or nothing), before any effect runs.
  const held: Held<T> = state.key === key ? state : { key, error: null, ...kept(args) };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the arguments.
  const reload = useCallback(
    (quiet = false) => {
      const request = ++latest.current;
      const { args: now, key: nowKey } = asked.current;
      // A quiet load keeps what is shown, and with it the warning that its refresh failed: the
      // cache may have dropped those figures meanwhile, but no answer has replaced them yet.
      setState((previous) =>
        quiet && previous.key === nowKey
          ? { ...previous, error: null }
          : { key: nowKey, error: null, ...kept(now) },
      );
      source.load(...now).then(
        (next) =>
          request === latest.current &&
          setState({ key: nowKey, data: next, error: null, failed: false }),
        (failure) =>
          request === latest.current &&
          setState((previous) => {
            const data = previous.key === nowKey ? previous.data : null;
            return { key: nowKey, data, error: failure, failed: data !== null };
          }),
      );
    },
    [source, key],
  );

  useEffect(() => {
    reload();
    // Leaving the page, or asking something else, makes this load's answer too late to show.
    return () => {
      latest.current++;
    };
  }, [reload]);

  const replace = useCallback((next: T) => {
    latest.current++;
    setState({ key: asked.current.key, data: next, error: null, failed: false });
  }, []);

  // Another reader of the same figures may have failed to refresh them since they were shown.
  const stale =
    held.data !== null &&
    (held.failed || (held.data === source.last(...args) && source.failed?.(...args) === true));

  return { data: held.data, error: held.error, stale, reload, replace };
}
