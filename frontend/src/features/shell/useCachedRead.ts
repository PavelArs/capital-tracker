import { useCallback, useEffect, useRef, useState } from 'react';

/** What a `cachedReads` entry offers a page: the last answer, and a load that keeps the next one. */
interface CachedSource<A extends unknown[], T> {
  last: (...args: A) => T | undefined;
  load: (...args: A) => Promise<T>;
}

/** What the hook holds, and the arguments (as a key) it was read for. */
interface Held<T> {
  key: string;
  data: T | null;
  error: unknown;
}

export interface CachedRead<T> {
  /** The answer shown: the last one kept, then the one the server gave; null until there is one. */
  data: T | null;
  /** Why the newest load failed (data keeps what was shown before); null when it did not. */
  error: unknown;
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
  const [state, setState] = useState<Held<T>>(() => ({
    key,
    data: source.last(...args) ?? null,
    error: null,
  }));
  const latest = useRef(0);
  const asked = useRef({ args, key });
  asked.current = { args, key };

  // The state belongs to the arguments it was read for. On the render where they change, it is
  // not shown: the kept answer for the new arguments is (or nothing), before any effect runs.
  const held: Held<T> =
    state.key === key ? state : { key, data: source.last(...args) ?? null, error: null };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the arguments.
  const reload = useCallback(
    (quiet = false) => {
      const request = ++latest.current;
      const { args: now, key: nowKey } = asked.current;
      setState((previous) => ({
        key: nowKey,
        data: quiet && previous.key === nowKey ? previous.data : (source.last(...now) ?? null),
        error: null,
      }));
      source.load(...now).then(
        (next) => request === latest.current && setState({ key: nowKey, data: next, error: null }),
        (failure) =>
          request === latest.current &&
          setState((previous) => ({
            key: nowKey,
            data: previous.key === nowKey ? previous.data : null,
            error: failure,
          })),
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
    setState({ key: asked.current.key, data: next, error: null });
  }, []);

  return { data: held.data, error: held.error, reload, replace };
}
