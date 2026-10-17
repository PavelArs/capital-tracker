import { useRef } from 'react';

export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * The id of an attempt. Each pending command keeps its id until `done`, so a retry after a lost
 * answer is recorded once even when another command failed in between; changed entries are a new
 * attempt with a new id. A component that unmounts on success needs no `done`.
 */
export function useAttempt() {
  const ids = useRef(new Map<string, string>());
  const attempt = (entries: unknown) => {
    const key = JSON.stringify(entries);
    const id = ids.current.get(key) ?? newRequestId();
    ids.current.set(key, id);
    return id;
  };
  attempt.done = (entries: unknown) => ids.current.delete(JSON.stringify(entries));
  return attempt;
}
