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

  const urgent = toast.tone === 'error' || toast.tone === 'warning';
  return (
    <div
      className={`ui-toast ui-toast--${toast.tone}`}
      role={urgent ? 'alert' : 'status'}
      aria-atomic="true"
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
 * above the bottom safe area on a phone, over open sheets and drawers.
 */
export default function ToastViewport() {
  const toasts = useToastList();
  const controls = useToastControls();
  if (toasts.length === 0 || !controls) return null;
  return (
    <section className="ui-toasts" aria-label="Messages">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={() => controls.dismiss(toast.id)} />
      ))}
    </section>
  );
}
