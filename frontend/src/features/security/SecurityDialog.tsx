import type { ReactNode } from 'react';
import Modal, { ModalHeader } from '@/ui/Modal';
import { focusable } from '@/ui/useDialogFocus';

interface Props {
  title: string;
  titleId: string;
  /** Escape and the ✕ close the dialog when this is given; both wait while `busy`. */
  onClose?: () => void;
  busy?: boolean;
  /** Prototype .modal.sm (420 px) for a confirmation or a short form. */
  size?: 'narrow' | 'default';
  /** The step of a longer flow, drawn under the heading. */
  steps?: { current: number; total: number };
  children: ReactNode;
}

// The ✕ comes first in the box; a step still opens on its own first control.
const firstControl = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(focusable)].find(
    (control) => !control.classList.contains('ui-close'),
  );

// The security flows' modal: the shared header with its ✕, then the step's own body and footer.
export default function SecurityDialog({
  title,
  titleId,
  onClose,
  busy = false,
  size = 'default',
  steps,
  children,
}: Props) {
  return (
    <Modal
      titleId={titleId}
      size={size}
      onEscape={onClose && !busy ? onClose : undefined}
      initialFocus={firstControl}
    >
      <ModalHeader
        titleId={titleId}
        title={title}
        onClose={onClose}
        closeDisabled={busy}
        steps={steps}
      />
      {children}
    </Modal>
  );
}
