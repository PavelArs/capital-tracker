import type { ReactNode } from 'react';
import Modal from '@/ui/Modal';

interface Props {
  title: string;
  titleId: string;
  /** Escape and the focus trap stay; Escape closes only when this is given. */
  onEscape?: () => void;
  children: ReactNode;
}

// Prototype modal for the security flows: a heading, then the step's own form.
export default function SecurityDialog({ title, titleId, onEscape, children }: Props) {
  return (
    <Modal titleId={titleId} onEscape={onEscape}>
      <div className="ui-modal__head">
        <h2 id={titleId}>{title}</h2>
      </div>
      {children}
    </Modal>
  );
}
