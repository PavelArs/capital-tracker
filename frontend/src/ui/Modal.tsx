import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useDialogFocus } from './useDialogFocus';
import './modal.css';

interface Props {
  /** The id of the heading inside that names the dialog. */
  titleId: string;
  /** Default 520 px; narrow 420 px for one field, wide 560 px for a form (a sheet on phones). */
  size?: 'narrow' | 'default' | 'wide';
  /** Escape closes the dialog when given; leave it out while a save is in flight. */
  onEscape?: (() => void) | undefined;
  /** Where the keyboard starts; the first control by default. */
  initialFocus?: ((root: HTMLElement) => HTMLElement | null | undefined) | undefined;
  /** A dialog that interrupts with a mandatory answer. */
  role?: 'dialog' | 'alertdialog';
  describedBy?: string | undefined;
  /** One local modifier on the dialog box, for what only this dialog needs. */
  className?: string | undefined;
  /** A dialog opened over a drawer sits above it. */
  overDrawer?: boolean;
  /** The dialog box, for a dialog that moves the keyboard between its own steps. */
  boxRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

// Open modals; the page behind them does not scroll while any is open.
let open = 0;

function useScrollLock() {
  useEffect(() => {
    open += 1;
    document.documentElement.classList.add('ui-scroll-locked');
    return () => {
      open -= 1;
      if (open === 0) document.documentElement.classList.remove('ui-scroll-locked');
    };
  }, []);
}

/** The one modal dialog: a scrim, a box that keeps focus, and the head, body and foot slots. */
export default function Modal({
  titleId,
  size = 'default',
  onEscape,
  initialFocus,
  role = 'dialog',
  describedBy,
  className,
  overDrawer = false,
  boxRef,
  children,
}: Props) {
  const own = useRef<HTMLDivElement>(null);
  const box = boxRef ?? own;
  useDialogFocus(box, { onEscape, initialFocus });
  useScrollLock();
  const classes = ['ui-modal', size === 'default' ? '' : `ui-modal--${size}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={overDrawer ? 'ui-scrim ui-scrim--over-drawer' : 'ui-scrim'}>
      <div
        ref={box}
        className={classes}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        {children}
      </div>
    </div>
  );
}
