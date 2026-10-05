import { useSyncExternalStore } from 'react';

// Below 640 px a table no longer fits; phones get a list of two-line rows instead.
const query = '(max-width: 639.98px)';

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;
}

function subscribe(changed: () => void): () => void {
  const list = media();
  list?.addEventListener('change', changed);
  return () => list?.removeEventListener('change', changed);
}

/** True on a phone-width screen; false where the width cannot be asked (tests, old engines). */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
