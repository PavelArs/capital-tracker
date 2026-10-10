import { cachedReads } from '@api/cached-reads';
import {
  announceClassificationChange,
  CLASSIFICATION_CHANGED,
  operationsApi,
  type TransferProposals as Proposals,
  type ProposedLeg,
  type TransferProposal,
} from '@api/operations.api';
import { SYNC_CHANGED } from '@api/sync-status.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { newRequestId } from '../accounting/feedback';
import { quantity } from '../portfolio/format';
import { moment, shortAddress } from './operation-format';

// XFER-PROPOSED: how many proposals are listed before "Show all".
const SHOWN = 3;

const place = (leg: ProposedLeg) =>
  leg.wallet.label ??
  (leg.wallet.network === 'bybit' ? 'Bybit account' : shortAddress(leg.wallet.address));

function failure(error: unknown): string {
  if (!isAxiosError(error) || error.response === undefined)
    return 'Could not reach the server. Nothing was saved; try again.';
  const body = error.response.data as { message?: unknown } | undefined;
  if (error.response.status === 409 || error.response.status === 422)
    return typeof body?.message === 'string'
      ? `These cannot be joined: ${body.message.charAt(0).toLowerCase()}${body.message.slice(1)}. Open the transactions to classify them yourself.`
      : 'These cannot be joined now. Open the transactions to classify them yourself.';
  return 'Could not join them. Nothing was saved; try again.';
}

/**
 * XFER-PROPOSED: a withdrawal and a receipt of one coin in two accounts that look like one
 * transfer but name different transactions. Nothing is joined until the owner says so; one
 * tap answers the withdrawal as a transfer naming the receipt, and what went missing between
 * them is the transfer's fee.
 */
export default function TransferProposals({ onJoined }: { onJoined: (message: string) => void }) {
  const [found, setFound] = useState<Proposals | null>(
    () => cachedReads.transferProposals.last() ?? null,
  );
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setFound(await cachedReads.transferProposals.load());
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
  const keyOf = (item: TransferProposal) => `${item.outgoing.addressId}:${item.outgoing.txid}`;
  const join = async (item: TransferProposal) => {
    const key = keyOf(item);
    setBusy(key);
    setProblem(null);
    try {
      await operationsApi.classify({ id: item.outgoing.addressId }, item.outgoing.txid, {
        requestId: newRequestId(),
        expectedVersion: item.outgoing.version,
        hidden: false,
        classification: {
          type: 'transfer',
          accountId: item.incoming.accountId,
          partner: { addressId: item.incoming.addressId, txid: item.incoming.txid },
        },
      });
      announceClassificationChange();
      onJoined(
        `Joined as one transfer: ${quantity(item.arrived)} ${item.coin} from ${item.outgoing.accountName} to ${item.incoming.accountName}.`,
      );
    } catch (error) {
      setProblem({ key, text: failure(error) });
    } finally {
      setBusy(null);
    }
  };

  const listed = all ? proposals : proposals.slice(0, SHOWN);
  return (
    <section className="shell-card transactions-proposals" aria-labelledby="transfer-proposals">
      <h2 id="transfer-proposals">
        {proposals.length === 1
          ? 'One possible transfer between your accounts'
          : `${proposals.length} possible transfers between your accounts`}
      </h2>
      <p className="transactions-proposals__lead">
        Coins left one account and arrived in another a little later, under different transaction
        hashes. Join them to keep the cost basis; only the difference counts as a fee. Nothing
        changes until you do.
      </p>
      <ul className="transactions-proposals__list">
        {listed.map((item) => {
          const key = keyOf(item);
          const hasFee = Number(item.fee) > 0;
          return (
            <li key={key} className="transactions-proposal">
              <div className="transactions-proposal__text">
                <strong>
                  {quantity(item.arrived)} {item.coin}
                </strong>{' '}
                from {item.outgoing.accountName} to {item.incoming.accountName}
                <span className="portfolio-sub">
                  Left {place(item.outgoing)} {moment(item.outgoing.occurredAt)}, arrived in{' '}
                  {place(item.incoming)} {moment(item.incoming.occurredAt)}
                  {hasFee
                    ? `. ${quantity(item.sent)} ${item.coin} left, so ${quantity(item.fee)} ${item.coin} is the fee`
                    : ''}
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
                onClick={() => void join(item)}
              >
                {busy === key ? 'Joining…' : 'Join as one transfer'}
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
        Offered when the same coin arrives within {found?.windowHours} hours of the withdrawal and
        at most {found?.feePercent}% less. Anything less certain stays to classify.
      </p>
    </section>
  );
}
