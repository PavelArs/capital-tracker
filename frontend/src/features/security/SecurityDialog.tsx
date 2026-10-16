import type { ReactNode } from 'react';
import Modal from '@/ui/Modal';
import { focusable } from '@/ui/useDialogFocus';
import CloseButton from '../shell/CloseButton';

interface Props {
  title: string;
  titleId: string;
  /** Escape and the ✕ close the dialog when this is given; both wait while `busy`. */
  onClose?: () => void;
  busy?: boolean;
  /** Prototype .modal.sm (420 px) for a confirmation or a short form. */
  size?: 'narrow' | 'default';
  children: ReactNode;
}

// The ✕ comes first in the box; a step still opens on its own first control.
const firstControl = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(focusable)].find(
    (control) => !control.classList.contains('shell-close'),
  );

// Prototype modal for the security flows: a heading with its ✕, then the step's own form.
export default function SecurityDialog({
  title,
  titleId,
  onClose,
  busy = false,
  size = 'default',
  children,
}: Props) {
  return (
    <Modal
      titleId={titleId}
      size={size}
      onEscape={onClose && !busy ? onClose : undefined}
      initialFocus={firstControl}
    >
      <div className="ui-modal__head">
        <h2 id={titleId}>{title}</h2>
        {onClose && <CloseButton onClick={onClose} disabled={busy} />}
      </div>
      {children}
    </Modal>
  );
}
