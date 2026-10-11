import { useSyncExternalStore } from 'react';

// The same width where the page header stacks and the bell panel becomes a sheet (shell-page.css).
const query = '(max-width: 560px)';

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
export function useCompactScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
