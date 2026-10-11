import { type ReactNode, useRef } from 'react';
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
  children: ReactNode;
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
  children,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, { onEscape, initialFocus });
  const classes = ['ui-modal', size === 'default' ? '' : `ui-modal--${size}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="ui-scrim">
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
