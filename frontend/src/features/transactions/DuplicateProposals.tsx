import { cachedReads } from '@api/cached-reads';
import {
  announceClassificationChange,
  CLASSIFICATION_CHANGED,
  type DuplicateProposal,
  operationsApi,
  type DuplicateProposals as Proposals,
} from '@api/operations.api';
import { SYNC_CHANGED } from '@api/sync-status.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { newRequestId } from '../accounting/feedback';
import { money, quantity } from '../portfolio/format';
import { moment, shortAddress, typeLabels } from './operation-format';

// CLS-DUPLICATE: how many proposals are listed before "Show all".
const SHOWN = 3;

const place = (item: DuplicateProposal) =>
  item.transaction.wallet.label ??
  (item.transaction.wallet.network === 'bybit'
    ? 'Bybit account'
    : shortAddress(item.transaction.wallet.address));

const keyOf = (item: DuplicateProposal) => `${item.transaction.addressId}:${item.transaction.txid}`;

function failure(error: unknown): string {
  if (!isAxiosError(error) || error.response === undefined)
    return 'Could not reach the server. Nothing was saved; try again.';
  const body = error.response.data as { message?: unknown } | undefined;
  if (error.response.status === 409 || error.response.status === 422)
    return typeof body?.message === 'string'
      ? `This cannot be replaced: ${body.message.charAt(0).toLowerCase()}${body.message.slice(1)}. Open the transaction to classify it yourself.`
      : 'This cannot be replaced now. Open the transaction to classify it yourself.';
  return 'Could not replace it. Nothing was saved; try again.';
}

/**
 * CLS-DUPLICATE: a record the owner added by hand or from CSV and a wallet's transaction in the
 * same account that look like one movement. Nothing changes until the owner says so; one tap
 * answers the transaction as the record said and deletes the record, in one step.
 */
export default function DuplicateProposals({
  onReplaced,
}: {
  onReplaced: (message: string) => void;
}) {
  const [found, setFound] = useState<Proposals | null>(
    () => cachedReads.duplicateProposals.last() ?? null,
  );
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setFound(await cachedReads.duplicateProposals.load());
    } catch {
      // The list is an offer; without it the page works as before.
    }
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener(CLASSIFICATION_CHANGED, load);
    window.addEventListener(SYNC_CHANGED, load);
    return () => {
      window.removeEventListener(CLASSIFICATION_CHANGED, load);
      window.removeEventListener(SYNC_CHANGED, load);
    };
  }, [load]);

  const proposals = found?.proposals ?? [];
  if (proposals.length === 0) return null;
  const replace = async (item: DuplicateProposal) => {
    const key = keyOf(item);
    setBusy(key);
    setProblem(null);
    try {
      await operationsApi.classify({ id: item.transaction.addressId }, item.transaction.txid, {
        requestId: newRequestId(),
        expectedVersion: item.transaction.version,
        hidden: false,
        classification: item.classification,
        ...(item.comment === null ? {} : { comment: item.comment }),
        replaces: { kind: item.record.kind, id: item.record.id, version: item.record.version },
      });
      announceClassificationChange();
      onReplaced(
        `Replaced your record with the wallet's: ${quantity(item.transaction.quantity)} ${item.coin} in ${item.transaction.accountName}.`,
      );
    } catch (error) {
      setProblem({ key, text: failure(error) });
    } finally {
      setBusy(null);
    }
  };

  const listed = all ? proposals : proposals.slice(0, SHOWN);
  return (
    <section className="shell-card transactions-proposals" aria-labelledby="duplicate-proposals">
      <h2 id="duplicate-proposals">
        {proposals.length === 1
          ? 'One possible duplicate'
          : `${proposals.length} possible duplicates`}
      </h2>
      <p className="transactions-proposals__lead">
        Something you added also appears as a transaction of a wallet in the same account, so it is
        counted twice. Replace yours with the wallet's: the transaction keeps its exact time and
        amount, and the price or purpose you entered moves over to it. Nothing changes until you do.
      </p>
      <ul className="transactions-proposals__list">
        {listed.map((item) => {
          const key = keyOf(item);
          const received = item.direction === 'in';
          return (
            <li key={key} className="transactions-proposal">
              <div className="transactions-proposal__text">
                <span>
                  <strong>
                    {quantity(item.transaction.quantity)} {item.coin}
                  </strong>{' '}
                  in {item.transaction.accountName}
                </span>
                <span className="portfolio-sub">
                  You added: {typeLabels[item.record.type]} {quantity(item.record.quantity)}{' '}
                  {item.coin}
                  {item.record.valueUsd === null
                    ? ''
                    : ` worth ${money(item.record.valueUsd, 'USD')}`}
                  , {moment(item.record.occurredAt)}
                </span>
                <span className="portfolio-sub">
                  {place(item)} {received ? 'received' : 'sent'}{' '}
                  {quantity(item.transaction.quantity)} {item.coin},{' '}
                  {moment(item.transaction.occurredAt)}
                </span>
                {problem?.key === key && (
                  <span className="transactions-proposal__error" role="alert">
                    {problem.text}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="shell-button"
                disabled={busy !== null}
                onClick={() => void replace(item)}
              >
                {busy === key ? 'Replacing…' : "Replace with the wallet's"}
              </button>
            </li>
          );
        })}
      </ul>
      {proposals.length > SHOWN && (
        <button type="button" className="shell-link" onClick={() => setAll((current) => !current)}>
          {all ? 'Show fewer' : `Show all ${proposals.length}`}
        </button>
      )}
      <p className="shell-note">
        Offered when the same coin moved the same way in the same account within{' '}
        {found?.windowHours} hours, and the amounts differ by at most {found?.amountPercent}%.
        Anything less certain stays as it is.
      </p>
    </section>
  );
}
