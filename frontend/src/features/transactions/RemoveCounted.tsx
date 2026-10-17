import type { Operation } from '@api/operations.api';
import { operationsApi } from '@api/operations.api';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { requestFailure } from '@/utils/request-failure';
import { useAttempt } from '../accounting/feedback';
import { isCountedGap } from './operation-format';

interface Props {
  operation: Operation;
  /** The footer's other buttons are locked while a request runs. */
  disabled?: boolean;
  onDeleted: () => void;
}

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable:
      'Could not reach the server. The record may have been deleted; reload the page to check.',
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
  const attempt = useAttempt();
  if (!operation.chain || !operation.wallet || !isCountedGap(operation.chain.txid)) return null;
  const { wallet } = operation;
  const { txid } = operation.chain;
  // A failure stays in the confirmation; the drawer closes when the record is gone.
  const remove = async () => {
    const removal = { expectedVersion: operation.classification?.version ?? 0 };
    await operationsApi.removeCounted(wallet, txid, {
      requestId: attempt([wallet.id, txid, removal]),
      ...removal,
    });
    onDeleted();
  };
  return (
    <>
      <Button
        variant="ghost"
        destructive
        icon="trash"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        Delete
      </Button>
      {/* The confirmation covers the drawer it is opened from, so it is drawn outside it. */}
      {asking &&
        createPortal(
          <ConfirmDialog
            title="Delete this record?"
            confirmLabel="Delete record"
            busyLabel="Deleting…"
            failure={failure}
            onConfirm={remove}
            onClose={() => setAsking(false)}
            overDrawer
          >
            Bybit still holds these coins, so the difference shows again.
          </ConfirmDialog>,
          document.body,
        )}
    </>
  );
}
