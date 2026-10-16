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
  'too-many-rewards': 'There are more income payments than the records keep.',
  'too-many-entries': 'There are more entries than the records keep.',
};

/** An import that got no answer may still have been written, so leaving must reload the page. */
const unanswered = (error: unknown) => !isAxiosError(error) || error.response === undefined;

const failure = (error: unknown, step: 'preview' | 'import') =>
  requestFailure(error, {
    unreachable:
      step === 'import'
        ? 'Could not reach the server. Try again; the same request will not load the history twice.'
        : 'Could not reach the server. Try again.',
    status: {
      401: 'Your session has ended. Sign in again.',
      404: 'This account no longer reads T-Bank. Close this window and connect it again.',
      409:
        step === 'import'
          ? 'The account or its T-Bank history changed since the check. Check it again.'
          : 'The records of this account do not allow loading this history as it stands.',
      422: (said) => said ?? 'T-Bank did not give the history. Connect the account again.',
      503: 'T-Bank could not be reached. Try again in a few minutes.',
    },
    fallback: 'Try again.',
  });

const entries = (count: number) => (count === 1 ? '1 entry' : `${count} entries`);

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
  const unsure = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

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
      if (unanswered(caught)) unsure.current = true;
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
    // One sentence per reason, naming the shares it concerns, however many entries it touches.
    const tickers = new Map<ImportProblemReason, Set<string>>();
    for (const problem of preview.problems) {
      const named = tickers.get(problem.reason) ?? new Set<string>();
      if (problem.ticker) named.add(problem.ticker);
      tickers.set(problem.reason, named);
    }
    for (const [reason, named] of tickers)
      reasons.push(
        named.size > 0
          ? `${problemText[reason]} (${[...named].slice(0, 5).join(', ')})`
          : problemText[reason],
      );
    if (reasons.length === 0) reasons.push('T-Bank has no operations to load for this account.');
  }

  const done = receipt !== null;
  // A failed import that may have been written still reloads the page on leaving.
  const leave = done || unsure.current ? onImported : onClose;
  return (
    <Modal
      titleId={`${id}-title`}
      size="wide"
      onEscape={busy ? undefined : leave}
      initialFocus={() => heading.current}
    >
      <div className="ui-modal__head">
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
          Load T-Bank history
        </h2>
        <CloseButton onClick={leave} disabled={busy} />
      </div>
      <div className="ui-modal__body" aria-live="polite">
        {done ? (
          <p className="ui-banner ui-banner--pos" role="status">
            Loaded {entries(receipt.trades + receipt.rewards)} ({receipt.trades} for trades, money
            in and out, fees and taxes, {receipt.rewards} for income payments) into {accountName}.
          </p>
        ) : busy && preview === null ? (
          <p className="broker-note" role="status">
            Reading the history from T-Bank…
          </p>
        ) : preview ? (
          <>
            <p className="broker-note">
              {preview.canImport
                ? `The history of ${accountName} becomes ${entries(preview.trades + preview.rewards)} (${preview.trades} for trades, money in and out, fees and taxes, ${preview.rewards} for income payments), from ${moscowDate(first as string)} to ${moscowDate(last as string)}. A security you have not loaded before becomes an asset priced by hand, so it has no price until you enter one.`
                : `The history of ${accountName} cannot be loaded as it stands.`}
            </p>
            {preview.canImport && preview.grouping !== 'operation' && (
              <p className="broker-note">
                There are many trades, so trades of one share in one{' '}
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
          <button type="button" className="shell-button shell-button--primary" onClick={leave}>
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              className="shell-button shell-button--ghost"
              onClick={leave}
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
