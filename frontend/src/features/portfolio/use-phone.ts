import { useEffect, useState } from 'react';

/** Below this width tables become two-line rows (design: tables on phones). */
export const PHONE_QUERY = '(max-width: 639.98px)';

const matches = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false;

/** Whether the window is phone-sized, following later resizes and rotations. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(PHONE_QUERY);
    const changed = () => setPhone(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return phone;
}
