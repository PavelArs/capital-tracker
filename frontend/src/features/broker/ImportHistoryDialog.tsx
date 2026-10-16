import {
  brokersApi,
  type ImportProblemReason,
  type TBankImportPreview,
  type TBankImportReceipt,
} from '@api/brokers.api';
import { isAxiosError } from 'axios';
import { useEffect, useId, useRef, useState } from 'react';
import Modal from '@/ui/Modal';
import { moscowDate } from '@/utils/dates';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import CloseButton from '../shell/CloseButton';
import './broker.css';

const problemText: Record<ImportProblemReason, string> = {
  'not-recordable':
    'T-Bank operations the app cannot record yet (for example a bond paid back in part, or a card payment).',
  'already-imported': 'Some of these operations were already loaded, into this or another account.',
  'no-rate': 'There is no Bank of Russia rate for the date of an operation.',
  amount: 'An amount is outside what the records can hold.',
  'fee-above-proceeds': 'A sale has a fee larger than the money it brought.',
  'not-held': 'A sale or purchase spends more than the account held at that time.',
  'before-records': 'An operation is older than the date the records can start from.',
  'too-many-rewards': 'There are more dividends and coupons than the records keep.',
  'too-many-entries': 'There are more entries than the records keep.',
};

const failure = (error: unknown, step: 'preview' | 'import') =>
  requestFailure(error, {
    unreachable:
      step === 'import'
        ? 'Could not reach the server. Try again; the same request will not load the history twice.'
        : 'Could not reach the server. Try again.',
    status: {
      401: 'Your session has ended. Sign in again.',
      409: 'The account or its T-Bank history changed since the check. Check it again.',
      422: (said) => said ?? 'T-Bank did not give the history. Connect the account again.',
      503: 'T-Bank could not be reached. Try again in a few minutes.',
    },
    fallback: 'Try again.',
  });

const times = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

interface Props {
  accountId: string;
  accountName: string;
  onClose: () => void;
  /** The history was written: the page shows it. */
  onImported: () => void;
}

// "Load T-Bank history" (BROKER-HISTORY): checks what the account's T-Bank history would become,
// says what stands in the way, and writes exactly what was checked in one command.
export default function ImportHistoryDialog({
  accountId,
  accountName,
  onClose,
  onImported,
}: Props) {
  const id = useId();
  const [preview, setPreview] = useState<TBankImportPreview | null>(null);
  const [receipt, setReceipt] = useState<TBankImportReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // One request id per checked history, so a retry of a lost answer finds the first receipt.
  const request = useRef<{ hash: string; requestId: string } | null>(null);
  const latest = useRef(0);

  const check = async () => {
    const mine = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const found = await brokersApi.importPreview(accountId);
      if (mine !== latest.current) return;
      setPreview(found);
    } catch (caught) {
      if (mine !== latest.current) return;
      setPreview(null);
      setError(failure(caught, 'preview'));
    }
    setBusy(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: checks once when the dialog opens
  useEffect(() => {
    void check();
    return () => {
      latest.current += 1;
    };
  }, []);

  const load = async () => {
    if (!preview?.canImport || busy) return;
    if (request.current?.hash !== preview.previewHash)
      request.current = { hash: preview.previewHash, requestId: newRequestId() };
    setBusy(true);
    setError(null);
    try {
      setReceipt(
        await brokersApi.importHistory(accountId, {
          requestId: request.current.requestId,
          previewHash: preview.previewHash,
        }),
      );
    } catch (caught) {
      // A changed history is checked again; a failure that left it unknown can be retried as is.
      if (isAxiosError(caught) && caught.response?.status === 409) setPreview(null);
      setError(failure(caught, 'import'));
    }
    setBusy(false);
  };

  const first = preview?.entries.map((entry) => entry.occurredAt).sort()[0];
  const last = preview?.entries
    .map((entry) => entry.occurredAt)
    .sort()
    .at(-1);
  const reasons: string[] = [];
  if (preview && !preview.canImport) {
    if (preview.accountHasEntries)
      reasons.push(
        'This account already holds records. History is loaded only into an empty account, so nothing is counted twice.',
      );
    if (!preview.fitsTradeLimit)
      reasons.push('There are more trades than the records keep, even combined by month.');
    for (const problem of preview.problems)
      reasons.push(
        problem.ticker && problem.reason === 'not-held'
          ? `${problemText[problem.reason]} (${problem.ticker})`
          : problemText[problem.reason],
      );
    if (reasons.length === 0) reasons.push('T-Bank has no operations to load for this account.');
  }

  const done = receipt !== null;
  return (
    <Modal
      titleId={`${id}-title`}
      size="wide"
      onEscape={busy ? undefined : done ? onImported : onClose}
    >
      <div className="ui-modal__head">
        <h2 id={`${id}-title`}>Load T-Bank history</h2>
        <CloseButton onClick={done ? onImported : onClose} disabled={busy} />
      </div>
      <div className="ui-modal__body">
        {done ? (
          <p className="ui-banner ui-banner--pos" role="status">
            Loaded {times(receipt.trades, 'trade')} and {times(receipt.rewards, 'reward')} into{' '}
            {accountName}.
          </p>
        ) : busy && preview === null ? (
          <p className="broker-note" role="status">
            Reading the history from T-Bank…
          </p>
        ) : preview ? (
          <>
            <p className="broker-note">
              {preview.canImport
                ? `The history of ${accountName} becomes ${times(preview.trades, 'trade')} and ${preview.rewards === 1 ? '1 dividend or coupon' : `${preview.rewards} dividends and coupons`}, from ${moscowDate(first as string)} to ${moscowDate(last as string)}. Securities become assets priced by hand, so their values stay empty until you enter a price.`
                : `The history of ${accountName} cannot be loaded as it stands.`}
            </p>
            {preview.canImport && preview.grouping !== 'operation' && (
              <p className="broker-note">
                There are many trades, so those on one{' '}
                {preview.grouping === 'day' ? 'day' : 'month'} are combined into one entry.
              </p>
            )}
            {reasons.length > 0 && (
              <ul className="broker-reasons">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        {error && (
          <p className="ui-banner ui-banner--neg" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ui-modal__foot">
        {done ? (
          <button type="button" className="shell-button shell-button--primary" onClick={onImported}>
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              className="shell-button shell-button--ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            {preview === null || !preview.canImport ? (
              <button
                type="button"
                className="shell-button shell-button--primary"
                onClick={() => void check()}
                disabled={busy}
              >
                Check again
              </button>
            ) : (
              <button
                type="button"
                className="shell-button shell-button--primary"
                onClick={() => void load()}
                disabled={busy}
              >
                Load history
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
