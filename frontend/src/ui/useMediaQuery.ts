import { useCallback, useSyncExternalStore } from 'react';

function media(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;
}

/** Whether a CSS media query matches now; false where it cannot be asked (tests, old engines). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (changed: () => void) => {
      const list = media(query);
      list?.addEventListener('change', changed);
      return () => list?.removeEventListener('change', changed);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => media(query)?.matches ?? false,
    () => false,
  );
}

/** Below 640 px a table no longer fits; phones get a list of two-line rows instead. */
export const useNarrowScreen = () => useMediaQuery('(max-width: 639.98px)');

/** The width where the page header stacks and the bell panel becomes a sheet (shell-page.css). */
export const useCompactScreen = () => useMediaQuery('(max-width: 560px)');
