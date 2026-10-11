import { type RefObject, useEffect, useRef } from 'react';

/**
 * Tab order inside a dialog or drawer: every enabled control, a radio group as one stop at its
 * checked radio.
 */
export const focusable =
  'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="radio"]), input[type="radio"]:checked:not([disabled]), summary';

interface Options {
  /** Escape calls this; without it Escape does nothing (a save in flight, a required step). */
  onEscape?: (() => void) | undefined;
  /** The element that gets the keyboard when the dialog opens; the first control by default. */
  initialFocus?: ((root: HTMLElement) => HTMLElement | null | undefined) | undefined;
}

/**
 * The keyboard contract of every modal surface: focus goes in when it opens, Tab stays inside,
 * Escape closes when allowed, and focus returns to what opened it.
 */
export function useDialogFocus(root: RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scope = root.current;
    if (scope) {
      const start = latest.current.initialFocus
        ? latest.current.initialFocus(scope)
        : scope.querySelector<HTMLElement>(focusable);
      start?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latest.current.onEscape?.();
      const inside = root.current;
      if (event.key !== 'Tab' || !inside) return;
      const items = [...inside.querySelectorAll<HTMLElement>(focusable)];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [root]);
}
