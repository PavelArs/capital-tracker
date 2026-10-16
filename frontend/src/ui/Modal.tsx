import CloseButton from '@features/shell/CloseButton';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { Steps } from './Steps';
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

/**
 * A dialog's head: the 20 px title (h2, id `titleId`), the ✕ when the dialog can be closed,
 * the steps of a multi-step dialog under it and an optional intro line.
 */
export function ModalHeader({
  titleId,
  title,
  onClose,
  closeDisabled = false,
  steps,
  intro,
}: {
  titleId: string;
  title: ReactNode;
  /** The ✕; left out, the dialog has none (a required step). */
  onClose?: () => void;
  /** The ✕ waits while a save is in flight. */
  closeDisabled?: boolean;
  steps?: { current: number; total: number };
  /** A line under the title: what the dialog does. */
  intro?: ReactNode;
}) {
  return (
    <>
      <div className="ui-modal__head">
        <h2 id={titleId}>{title}</h2>
        {onClose && <CloseButton onClick={onClose} disabled={closeDisabled} />}
        {intro && <div className="ui-modal__intro">{intro}</div>}
      </div>
      {steps && (
        <div className="ui-modal__steps">
          <Steps current={steps.current} total={steps.total} />
        </div>
      )}
    </>
  );
}

/** The dialog's fields: a grid with 16 px between them; the part that scrolls in a tall dialog. */
export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className ? `ui-modal__body ${className}` : 'ui-modal__body'}>{children}</div>
  );
}

/**
 * The dialog's buttons, at the right. `summary` is the muted line at the left that sums up what
 * Save will do ("Cost $1,200 · counted as a new deposit"). Put `<span className="ui-grow" />`
 * between a Back button and the main one to push them apart.
 */
export function ModalFooter({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="ui-modal__foot">
      {summary !== undefined && summary !== null && <p className="ui-modal__summary">{summary}</p>}
      {children}
    </div>
  );
}
