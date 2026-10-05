import { CLASSIFICATION_CHANGED, operationsApi } from '@api/operations.api';
import { SYNC_CHANGED } from '@api/sync-status.api';
import { useEffect, useState } from 'react';

// Background sync can bring new transactions at any time; a minute keeps the count fresh.
const REFRESH_MS = 60_000;

/** Blockchain transactions still to classify (CLS-COUNT); null until known or unreachable. */
export function useNeedsClassification(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      operationsApi
        .needsClassification()
        .then((next) => live && setCount(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    window.addEventListener(CLASSIFICATION_CHANGED, load);
    window.addEventListener(SYNC_CHANGED, load);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener(CLASSIFICATION_CHANGED, load);
      window.removeEventListener(SYNC_CHANGED, load);
    };
  }, []);
  return count;
}
