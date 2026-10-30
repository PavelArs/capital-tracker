import { cachedReads } from '@api/cached-reads';
import {
  announceClassificationChange,
  CLASSIFICATION_CHANGED,
  type DuplicateProposal,
  operationsApi,
  type DuplicateProposals as Proposals,
} from '@api/operations.api';
import { SYNC_CHANGED } from '@api/sync-status.api';
import { useCallback, useEffect, useState } from 'react';
import { requestFailure } from '@/utils/request-failure';
import { useAttempt } from '../accounting/feedback';
import { money, quantity } from '../portfolio/format';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { moment, shortAddress, typeLabels } from './operation-format';
import { ProposalCard, ProposalItem } from './ProposalCard';
import { takeHandover } from './proposals-handover';

const place = (item: DuplicateProposal) =>
  item.transaction.wallet.label ??
  (item.transaction.wallet.network === 'bybit'
    ? 'Bybit account'
    : shortAddress(item.transaction.wallet.address));

const keyOf = (item: DuplicateProposal) => `${item.transaction.addressId}:${item.transaction.txid}`;

const refused = (message: string | undefined) =>
  message
    ? `This cannot be replaced: ${message.charAt(0).toLowerCase()}${message.slice(1)}. Open the transaction to classify it yourself.`
    : 'This cannot be replaced now. Open the transaction to classify it yourself.';

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. It may have been saved; reload the page to check.',
    status: { 409: refused, 422: refused },
    unsure: 'Could not replace it. It may have been replaced; reload the page to check.',
    fallback: 'Could not replace it. Nothing was saved; try again.',
  });

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
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  // A retry of one answer after a lost reply keeps its request id, so it is recorded once.
  const attempt = useAttempt();

  const load = useCallback(async () => {
    try {
      setFound(await cachedReads.duplicateProposals.load());
    } catch {
      // The list is an offer; without it the page works as before.
    }
  }, []);
  useEffect(() => {
    // The page read it together with the list a moment ago; asking again would only repeat it.
    // Only an answer that was kept counts: one that landed after a drop was not remembered.
    const handed = takeHandover('duplicate') && cachedReads.duplicateProposals.last() !== undefined;
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
  const replace = async (item: DuplicateProposal) => {
    const key = keyOf(item);
    setBusy(key);
    setProblem(null);
    const answer = {
      expectedVersion: item.transaction.version,
      hidden: false,
      classification: item.classification,
      ...(item.comment === null ? {} : { comment: item.comment }),
      replaces: { kind: item.record.kind, id: item.record.id, version: item.record.version },
    };
    try {
      await operationsApi.classify({ id: item.transaction.addressId }, item.transaction.txid, {
        requestId: attempt([key, answer]),
        ...answer,
      });
      attempt.done([key, answer]);
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

  return (
    <ProposalCard
      id="duplicate-proposals"
      title={
        proposals.length === 1
          ? 'One possible duplicate'
          : `${proposals.length} possible duplicates`
      }
      lead="Something you added also appears as a transaction of a wallet in the same account, so it is counted twice. Replace yours with the wallet's: the transaction keeps its exact time and amount, and the price or purpose you entered moves over to it. Nothing changes until you do."
      rule={
        <>
          Offered when the same coin moved the same way in the same account within{' '}
          {found?.windowHours} hours, and the amounts differ by at most {found?.amountPercent}%.
          Anything less certain stays as it is.
        </>
      }
      more={paged.more && <LoadMore {...paged.more} label="proposals" />}
    >
      {paged.rows.map((item) => {
        const key = keyOf(item);
        const received = item.direction === 'in';
        return (
          <ProposalItem
            key={key}
            summary={
              <span>
                <strong>
                  {quantity(item.transaction.quantity)} {item.coin}
                </strong>{' '}
                in {item.transaction.accountName}
              </span>
            }
            details={
              <>
                <span className="ui-sub">
                  You added: {typeLabels[item.record.type]} {quantity(item.record.quantity)}{' '}
                  {item.coin}
                  {item.record.valueUsd === null
                    ? ''
                    : ` worth ${money(item.record.valueUsd, 'USD')}`}
                  , {moment(item.record.occurredAt)}
                </span>
                <span className="ui-sub">
                  {place(item)} {received ? 'received' : 'sent'}{' '}
                  {quantity(item.transaction.quantity)} {item.coin},{' '}
                  {moment(item.transaction.occurredAt)}
                </span>
              </>
            }
            problem={problem?.key === key ? problem.text : null}
            action="Replace with the wallet's"
            busyLabel="Replacing…"
            busy={busy === key}
            locked={busy !== null}
            onAct={() => void replace(item)}
          />
        );
      })}
    </ProposalCard>
  );
}
