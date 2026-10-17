import {
  type ToastItem,
  type ToastTone,
  toastLifetime,
  useToastControls,
  useToastList,
} from '@contexts/ToastContext';
import { useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../features/shell/icons';
import { IconButton } from '../ui/IconButton';
import './Toast.css';

const iconOf: Record<ToastTone, IconName> = {
  success: 'check',
  info: 'info',
  warning: 'alert',
  error: 'alert',
};

const urgent = (toast: ToastItem) => toast.tone === 'error' || toast.tone === 'warning';

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const lifetime = toastLifetime(toast.tone);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timer restarts only when the hold ends.
  useLayoutEffect(() => {
    if (held) return;
    const timer = setTimeout(() => dismiss.current(), lifetime);
    return () => clearTimeout(timer);
  }, [held]);

  return (
    <div
      className={`ui-toast ui-toast--${toast.tone}`}
      // An alert is announced when it is added (the system alert event); success and info are
      // read by the polite live region they are added to (ToastViewport).
      role={urgent(toast) ? 'alert' : undefined}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Icon name={iconOf[toast.tone]} className="shell-icon ui-toast__icon" />
      <div className="ui-toast__text">
        <b>{toast.title}</b>
        {toast.detail && <small>{toast.detail}</small>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="ui-link ui-toast__action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <IconButton label="Dismiss" icon="close" size="sm" onClick={onDismiss} />
    </div>
  );
}

/**
 * The app's toasts (ToastContext.tsx has the rules): bottom right on a computer, full width
 * above the tab bar on a phone (at the top while a dialog is open), over open sheets and drawers.
 * The region is "Messages" (the bell's panel is "Notifications"). Success and info toasts are
 * added to one polite status region that stays in the page while it is empty: a screen reader
 * may skip a live region that arrives together with its text. Warnings and errors are alerts of
 * their own, which are announced as they are added.
 */
export default function ToastViewport() {
  const toasts = useToastList();
  const controls = useToastControls();
  if (!controls) return null;
  const draw = (toast: ToastItem) => (
    <Toast key={toast.id} toast={toast} onDismiss={() => controls.dismiss(toast.id)} />
  );
  return (
    <section className="ui-toasts" aria-label="Messages">
      <div className="ui-toasts__live" role="status">
        {toasts.filter((toast) => !urgent(toast)).map(draw)}
      </div>
      <div className="ui-toasts__live">{toasts.filter(urgent).map(draw)}</div>
    </section>
  );
}
