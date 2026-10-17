import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/*
 * NOTIFICATION RULES (design system; plan section 1.5). Pick the pattern by the situation, not
 * by taste. A toast is never the only place a fact about money appears: an estimated, stale,
 * incomplete or missing value keeps its badge, banner or note on the page itself.
 *
 * | Situation                                                         | Pattern                     |
 * |-------------------------------------------------------------------|-----------------------------|
 * | A completed command whose dialog or drawer closed (added, saved,  | toast `success` (title = the |
 * | deleted, renamed, synced, exported, codes regenerated, password   | old banner text, e.g. "Goal |
 * | changed, copied)                                                  | saved."; detail optional);  |
 * |                                                                   | keep the focus move to the  |
 * |                                                                   | row or the page heading     |
 * | A process started that finishes later (wallet added, sync started)| toast `info`                |
 * | Validation or a save failure inside an open dialog or drawer      | Banner tone="neg" in it and |
 * |                                                                   | field errors (no toast)     |
 * | A page load failed and there is nothing to show                   | ErrorState with Try again   |
 * | A refresh failed but data is on screen (stale)                    | Banner tone="warn" + Try    |
 * |                                                                   | again                       |
 * | Guidance, previews, verdicts, missing prices, estimates > 60 days | Banner tone="info" / "warn" |
 * |                                                                   | / "pos" (role="note")       |
 * | A background or global action failed (logout, a request, an       | toast `error`               |
 * | inline setting)                                                   |                             |
 * | Needs attention (to classify, failed sync, stale prices or        | the bell panel and the nav  |
 * | estimates, deposits ending)                                       | count                       |
 *
 * Toasts: bottom right (full width above the safe area on a phone), at most 3, newest last; the
 * same title again replaces the one on screen. success and info are role="status", warning and
 * error role="alert". They hide after 5 s (error 7 s) and hold while hovered or focused. No Undo
 * on a toast: deletions are voids or remove credentials, and they are confirmed first.
 */

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastInput {
  tone: ToastTone;
  /** One short sentence: what happened ("Goal saved."). */
  title: string;
  /** An optional second line. */
  detail?: string;
  /** One text action ("View", "Review"); the toast closes when it is used. */
  action?: { label: string; onClick: () => void };
}

export interface ToastItem extends ToastInput {
  id: number;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

interface ToastControls extends ToastApi {
  clear: () => void;
}

/** More than this many at once and the oldest goes: a burst stays readable. */
export const MAX_TOASTS = 3;
/** How long a toast stays; hovering or focusing it holds it open. */
export const toastLifetime = (tone: ToastTone) => (tone === 'error' ? 7000 : 5000);

// Two contexts: the controls never change, so a page that only shows toasts does not render
// again each time one comes or goes; only the viewport reads the list.
const ControlsContext = createContext<ToastControls | undefined>(undefined);
const ListContext = createContext<readonly ToastItem[]>([]);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);

  const show = useCallback((toast: ToastInput) => {
    const id = nextId++;
    // The same title again replaces the one on screen, so it is not stacked twice; a repeat
    // without a detail line keeps the one already said (the dialog's "Buy 0.01 BTC · Bybit").
    setToasts((current) => {
      const said = current.find((item) => item.title === toast.title);
      const detail = toast.detail ?? said?.detail;
      return [
        ...current.filter((item) => item.title !== toast.title),
        { ...toast, ...(detail ? { detail } : {}), id },
      ].slice(-MAX_TOASTS);
    });
    return id;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  const controls = useMemo(() => ({ show, dismiss, clear }), [show, dismiss, clear]);
  return (
    <ControlsContext.Provider value={controls}>
      <ListContext.Provider value={toasts}>{children}</ListContext.Provider>
    </ControlsContext.Provider>
  );
}

const inert: ToastControls = { show: () => 0, dismiss: () => {}, clear: () => {} };

/** The provider's controls, or undefined outside one (the useError alias insists on one). */
export function useToastControls(): ToastControls | undefined {
  return useContext(ControlsContext);
}

/** The toasts on screen, oldest first (ToastViewport). */
export function useToastList(): readonly ToastItem[] {
  return useContext(ListContext);
}

/**
 * Shows short-lived messages for completed commands and background failures; see the rules
 * above. The app always has a ToastProvider; a component rendered alone in a unit test has
 * none, and there `show` does nothing (wrap it in ToastProvider with a ToastViewport to see them).
 */
export function useToast(): ToastApi {
  return useContext(ControlsContext) ?? inert;
}
