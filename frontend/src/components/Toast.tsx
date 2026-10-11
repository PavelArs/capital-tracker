import { useError } from '@contexts/ErrorContext';
import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../features/shell/icons';
import './Toast.css';

/** How long a pop-up stays; hovering or focusing it holds it open. */
const AUTO_HIDE_MS = 7000;

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timer restarts only when the hold ends.
  useLayoutEffect(() => {
    if (held) return;
    const timer = setTimeout(() => dismiss.current(), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [held]);

  return (
    <div
      className="toast"
      role="alert"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Icon name="alert" className="shell-icon toast__icon" />
      <p className="toast__message">{message}</p>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" />
      </button>
    </div>
  );
}

/**
 * The pop-up errors of the whole app (design system: Banner, error). Top right on a computer,
 * full width under the pinned header on a phone.
 */
export default function ToastViewport() {
  const { toasts, dismissToast } = useError();
  const [top, setTop] = useState<number | null>(null);

  // Below 960px the sections strip is pinned at the top: the pop-up sits just under it.
  useLayoutEffect(() => {
    if (toasts.length === 0) return;
    const place = () => {
      const narrow = window.matchMedia?.('(max-width: 960px)').matches;
      const bottom = document.querySelector('.shell-nav')?.getBoundingClientRect().bottom;
      setTop(narrow && bottom !== undefined ? Math.max(0, bottom) : null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [toasts.length]);

  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" style={top === null ? undefined : { top: top + 8 }}>
      {toasts.map((toast) => (
        <Toast key={toast.id} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}
