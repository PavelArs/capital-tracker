import { useState } from 'react';
import SecurityDialog from './SecurityDialog';

interface Props {
  title: string;
  text: string;
  confirmLabel: string;
  /** Shown on the confirm button while the action runs. */
  busyLabel?: string;
  /** What to say when the action fails: a fixed text, or one made from the error. */
  failure: string | ((error: unknown) => string);
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

// Prototype confirmDialog: one destructive action, Cancel focused first.
export default function ConfirmDialog({
  title,
  text,
  confirmLabel,
  busyLabel = 'Logging out…',
  failure,
  onConfirm,
  onClose,
}: Props) {
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
    <SecurityDialog title={title} titleId="security-confirm" onEscape={busy ? undefined : onClose}>
      <div className="portfolio-dialog__body">
        <p className="security-dialog__text">{text}</p>
        {error && (
          <p className="portfolio-dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="portfolio-dialog__foot">
        <button
          type="button"
          className="shell-button shell-button--ghost"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="shell-button shell-button--danger"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </SecurityDialog>
  );
}
