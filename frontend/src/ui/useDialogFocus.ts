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

// Open dialogs, innermost last: only the innermost one answers the keyboard, so a confirmation
// opened over a drawer takes Escape and Tab for itself.
const open: object[] = [];

/**
 * What stays usable behind an open dialog: the toasts (they move clear of a phone sheet and keep
 * their Dismiss and action) and a scrim that closes its own dialog on a tap (`data-inert-keep`).
 */
const keep = '.ui-toasts, [data-inert-keep]';

// How many open dialogs made each element inert; an element inert before any dialog opened is
// never counted, so closing a dialog leaves it as it was.
const inertBy = new Map<Element, number>();

/**
 * Makes everything outside `dialog` inert: every sibling of the dialog and of each of its
 * ancestors up to the body. Dialogs render in place (no portal), so the page around them is
 * made inert rather than the app root that holds them. Returns the release.
 */
function inertOutside(dialog: HTMLElement): () => void {
  const made: Element[] = [];
  for (let node: Element = dialog; node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.matches(keep) || sibling instanceof HTMLScriptElement)
        continue;
      const count = inertBy.get(sibling);
      if (count === undefined && sibling.hasAttribute('inert')) continue;
      inertBy.set(sibling, (count ?? 0) + 1);
      sibling.setAttribute('inert', '');
      made.push(sibling);
    }
    if (node.parentElement === document.body) break;
  }
  document.body.classList.add('has-dialog');
  return () => {
    for (const element of made) {
      const count = (inertBy.get(element) ?? 1) - 1;
      if (count > 0) {
        inertBy.set(element, count);
        continue;
      }
      inertBy.delete(element);
      element.removeAttribute('inert');
    }
    if (open.length === 0) document.body.classList.remove('has-dialog');
  };
}

/**
 * The keyboard contract of every modal surface: focus goes in when it opens, Tab stays inside,
 * Escape closes when allowed, and focus returns to what opened it. While it is open the rest of
 * the page is inert (no pointer, keyboard or screen-reader access) and the body carries
 * `has-dialog` (phone toasts move to the top).
 */
export function useDialogFocus(root: RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const self = {};
    open.push(self);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scope = root.current;
    const release = scope ? inertOutside(scope) : () => undefined;
    if (scope) {
      // A chosen start that the dialog does not have falls back to its first control.
      const start =
        latest.current.initialFocus?.(scope) ?? scope.querySelector<HTMLElement>(focusable);
      start?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (open[open.length - 1] !== self) return;
      if (event.key === 'Escape') latest.current.onEscape?.();
      const inside = root.current;
      if (event.key !== 'Tab' || !inside) return;
      const items = [...inside.querySelectorAll<HTMLElement>(focusable)];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Focus outside the dialog (the body after a focused button turned disabled, or a control
      // behind the scrim) comes back in at the edge Tab moves towards.
      const outside = !active || !inside.contains(active);
      if (outside || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(self), 1);
      // The page comes back before the keyboard returns to it: an inert opener takes no focus.
      release();
      // Back to the opener, unless the closing code already put the keyboard somewhere else.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener?.isConnected) opener.focus();
    };
  }, [root]);
}
