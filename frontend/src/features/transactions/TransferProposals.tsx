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
import { useCallback, useEffect, useState } from 'react';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { quantity } from '../portfolio/format';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { moment, shortAddress } from './operation-format';
import { ProposalCard, ProposalItem } from './ProposalCard';
import { takeHandover } from './proposals-handover';

const place = (leg: ProposedLeg) =>
  leg.wallet.label ??
  (leg.wallet.network === 'bybit' ? 'Bybit account' : shortAddress(leg.wallet.address));

const refused = (message: string | undefined) =>
  message
    ? `These cannot be joined: ${message.charAt(0).toLowerCase()}${message.slice(1)}. Open the transactions to classify them yourself.`
    : 'These cannot be joined now. Open the transactions to classify them yourself.';

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Nothing was saved; try again.',
    status: { 409: refused, 422: refused },
    fallback: 'Could not join them. Nothing was saved; try again.',
  });

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
    // The page read it together with the list a moment ago; asking again would only repeat it.
    // Only an answer that was kept counts: one that landed after a drop was not remembered.
    const handed = takeHandover('transfer') && cachedReads.transferProposals.last() !== undefined;
    if (!handed) void load();
    window.addEventListener(CLASSIFICATION_CHANGED, load);
    window.addEventListener(SYNC_CHANGED, load);
    return () => {
      window.removeEventListener(CLASSIFICATION_CHANGED, load);
      window.removeEventListener(SYNC_CHANGED, load);
    };
  }, [load]);

  const proposals = found?.proposals ?? [];
  // PAGES: twenty proposals a page.
  const paged = useInfinite(proposals);
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

  return (
    <ProposalCard
      id="transfer-proposals"
      title={
        proposals.length === 1
          ? 'One possible transfer between your accounts'
          : `${proposals.length} possible transfers between your accounts`
      }
      lead="Coins left one account and arrived in another a little later, under different transaction hashes. Join them to keep the cost basis; only the difference counts as a fee. Nothing changes until you do."
      rule={
        <>
          Offered when the same coin arrives within {found?.windowHours} hours of the withdrawal and
          at most {found?.feePercent}% less. Anything less certain stays to classify.
        </>
      }
      more={paged.more && <LoadMore {...paged.more} label="proposals" />}
    >
      {paged.rows.map((item) => {
        const key = keyOf(item);
        const hasFee = Number(item.fee) > 0;
        return (
          <ProposalItem
            key={key}
            summary={
              <span>
                <strong>
                  {quantity(item.arrived)} {item.coin}
                </strong>{' '}
                from {item.outgoing.accountName} to {item.incoming.accountName}
              </span>
            }
            details={
              <span className="ui-sub">
                Left {place(item.outgoing)} {moment(item.outgoing.occurredAt)}, arrived in{' '}
                {place(item.incoming)} {moment(item.incoming.occurredAt)}
                {hasFee
                  ? `. ${quantity(item.sent)} ${item.coin} left, so ${quantity(item.fee)} ${item.coin} is the fee`
                  : ''}
              </span>
            }
            problem={problem?.key === key ? problem.text : null}
            action="Join as one transfer"
            busyLabel="Joining…"
            busy={busy === key}
            locked={busy !== null}
            onAct={() => void join(item)}
          />
        );
      })}
    </ProposalCard>
  );
}
