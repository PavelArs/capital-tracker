import { useRef } from 'react';

export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * The id of this attempt. A retry of the same entries after a lost answer keeps it, so the
 * server records it once; changed entries are a new attempt with a new id.
 */
export function useAttempt() {
  const last = useRef<{ key: string; id: string } | null>(null);
  return (entries: unknown) => {
    const key = JSON.stringify(entries);
    if (last.current?.key !== key) last.current = { key, id: newRequestId() };
    return last.current.id;
  };
}
