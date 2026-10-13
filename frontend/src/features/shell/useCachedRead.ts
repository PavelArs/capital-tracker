import { useCallback, useEffect, useRef, useState } from 'react';

/** What a `cachedReads` entry offers a page: the last answer, and a load that keeps the next one. */
interface CachedSource<A extends unknown[], T> {
  last: (...args: A) => T | undefined;
  load: (...args: A) => Promise<T>;
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
  const [data, setData] = useState<T | null>(() => source.last(...args) ?? null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);
  const asked = useRef(args);
  asked.current = args;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the arguments.
  const reload = useCallback(
    (quiet = false) => {
      const request = ++latest.current;
      setError(null);
      if (!quiet) setData(source.last(...asked.current) ?? null);
      source.load(...asked.current).then(
        (next) => request === latest.current && setData(next),
        (failure) => request === latest.current && setError(failure),
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
    setError(null);
    setData(next);
  }, []);

  return { data, error, reload, replace };
}
