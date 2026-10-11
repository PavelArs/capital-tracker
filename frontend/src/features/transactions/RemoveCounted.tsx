import type { Operation } from '@api/operations.api';
import { operationsApi } from '@api/operations.api';
import { useState } from 'react';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { Icon } from '../shell/icons';
import { isCountedGap } from './operation-format';

interface Props {
  operation: Operation;
  /** The footer's other buttons are locked while a request runs. */
  disabled?: boolean;
  onDeleted: () => void;
}

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Nothing was deleted; try again.',
    status: {
      409: 'This record was changed elsewhere. Close this window, reload and try again.',
      422: 'This record has an answer. Change it to "Needs classification" first, then delete it.',
    },
    fallback: 'Could not delete the record. Try again.',
  });

/**
 * BYBIT-GAP-DELETE: a record the owner made by counting a Bybit balance difference is their own
 * and can be deleted, after asking; no other blockchain or exchange record can. Nothing is
 * shown for any other record.
 */
export default function RemoveCounted({ operation, disabled = false, onDeleted }: Props) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!operation.chain || !operation.wallet || !isCountedGap(operation.chain.txid)) return null;
  const { wallet } = operation;
  const { txid } = operation.chain;
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await operationsApi.removeCounted(wallet, txid, {
        requestId: newRequestId(),
        expectedVersion: operation.classification?.version ?? 0,
      });
      onDeleted();
    } catch (failed) {
      setBusy(false);
      setAsking(false);
      setError(failure(failed));
    }
  };
  if (!asking)
    return (
      <>
        {error && (
          <span className="ui-banner ui-banner--neg" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          className="shell-button shell-button--ghost transactions-delete"
          disabled={disabled}
          onClick={() => setAsking(true)}
        >
          <Icon name="trash" className="shell-icon shell-icon--sm" />
          Delete
        </button>
      </>
    );
  return (
    <div className="transactions-remove">
      <p className="transactions-remove__text">
        Bybit still holds these coins, so the difference shows again.
      </p>
      <button
        type="button"
        className="shell-button shell-button--secondary"
        disabled={busy}
        onClick={() => setAsking(false)}
      >
        Keep
      </button>
      <button
        type="button"
        className="shell-button shell-button--ghost transactions-delete"
        disabled={busy}
        onClick={() => void remove()}
      >
        {busy ? 'Deleting…' : 'Delete record'}
      </button>
    </div>
  );
}
