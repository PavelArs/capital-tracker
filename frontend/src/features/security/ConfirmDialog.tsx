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

// Deprecated: only the wallets page still uses this; SecuritySettings uses @/ui/ConfirmDialog.
// Plan 2.9 deletes it once the wallets lane has moved to the shared dialog.
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
    <SecurityDialog
      title={title}
      titleId="security-confirm"
      size="narrow"
      onClose={onClose}
      busy={busy}
    >
      <div className="ui-modal__body">
        <p className="security-dialog__text">{text}</p>
        {error && (
          <p className="ui-banner ui-banner--neg" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ui-modal__foot">
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
