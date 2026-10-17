import { type ReactNode, useId, useState } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './Modal';

/**
 * The confirmation of a destructive or irreversible action (prototype confirm dialog): an
 * alertdialog that says exactly what will happen, a ✕ in its header, Cancel focused first, and
 * the action named with a verb and an object ("Delete transaction", "Remove wallet"). A failure
 * stays in the dialog as an alert; the dialog closes only when the caller unmounts it after
 * success.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  tone = 'danger',
  failure,
  onConfirm,
  onClose,
  overDrawer = false,
}: {
  title: string;
  /** The consequence, in a sentence or two. */
  children: ReactNode;
  confirmLabel: string;
  /** On the confirm button while the action runs ("Deleting…"); the label stays otherwise. */
  busyLabel?: string;
  /** danger for deletions; primary for an irreversible but harmless step (new codes). */
  tone?: 'danger' | 'primary';
  /** What to say when the action fails: a fixed text, or one made from the error. */
  failure: string | ((error: unknown) => string);
  onConfirm: () => Promise<void>;
  onClose: () => void;
  /** Opened from a drawer: the dialog and its scrim cover it. */
  overDrawer?: boolean;
}) {
  const titleId = useId();
  const textId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(typeof failure === 'function' ? failure(caught) : failure);
      setBusy(false);
    }
  };
  return (
    <Modal
      titleId={titleId}
      size="narrow"
      role="alertdialog"
      describedBy={textId}
      overDrawer={overDrawer}
      onEscape={busy ? undefined : onClose}
      initialFocus={(root) => root.querySelector<HTMLElement>('[data-confirm-cancel]')}
    >
      <ModalHeader titleId={titleId} title={title} onClose={onClose} closeDisabled={busy} />
      <ModalBody>
        <div id={textId} className="ui-confirm__text">
          {children}
        </div>
        {error && (
          <Banner tone="neg" role="alert">
            {error}
          </Banner>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" data-confirm-cancel="" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant={tone} busy={busy} onClick={() => void confirm()}>
          {busy && busyLabel ? busyLabel : confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
