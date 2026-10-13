import { useSyncExternalStore } from 'react';

/**
 * A choice of one of two values kept in this browser: read from storage once, followed across
 * tabs, and held in memory too, so a browser that refuses storage still follows it while the
 * tab lives.
 */
export function storedChoice<T extends string>(key: string, fallback: T, other: T) {
  const fromStorage = (): T => {
    try {
      return localStorage.getItem(key) === other ? other : fallback;
    } catch {
      return fallback;
    }
  };
  let current: T = fromStorage();
  const listeners = new Set<() => void>();

  const set = (value: T): void => {
    current = value;
    try {
      localStorage.setItem(key, value);
    } catch {
      // the choice holds until the tab closes
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      current = fromStorage();
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  };

  const use = (): readonly [T, (value: T) => void] => {
    const value = useSyncExternalStore(
      subscribe,
      () => current,
      (): T => fallback,
    );
    return [value, set] as const;
  };

  return { use, set };
}
