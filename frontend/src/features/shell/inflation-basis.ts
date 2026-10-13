import { useSyncExternalStore } from 'react';

/** Which rate values after inflation use: the published index, or the owner's own yearly rate. */
export type InflationBasis = 'official' | 'personal';

const KEY = 'inflation-basis';
const listeners = new Set<() => void>();

const fromStorage = (): InflationBasis => {
  try {
    return localStorage.getItem(KEY) === 'personal' ? 'personal' : 'official';
  } catch {
    return 'official';
  }
};

// Kept here too, so a browser that refuses storage still follows the choice while the tab lives.
let current: InflationBasis = fromStorage();

const emit = () => {
  for (const listener of listeners) listener();
};

export function setInflationBasis(basis: InflationBasis): void {
  current = basis;
  try {
    localStorage.setItem(KEY, basis);
  } catch {
    // the choice holds until the tab closes
  }
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = fromStorage();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

/** The saved choice, official until the owner picks their own rate; saved in this browser. */
export function useInflationBasis(): readonly [InflationBasis, (basis: InflationBasis) => void] {
  const basis = useSyncExternalStore(
    subscribe,
    () => current,
    (): InflationBasis => 'official',
  );
  return [basis, setInflationBasis] as const;
}
