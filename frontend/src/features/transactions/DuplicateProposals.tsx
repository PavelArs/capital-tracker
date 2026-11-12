import { cachedReads } from '@api/cached-reads';
import type { DuplicateProposal } from '@api/operations.api';
import { requestFailure } from '@/utils/request-failure';
import { money, quantity } from '../portfolio/format';
import LoadMore from '../shell/InfiniteScroll';
import { moment, shortAddress, typeLabels } from './operation-format';
import { ProposalCard, ProposalItem } from './ProposalCard';
import { useProposals } from './useProposals';

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
  const { found, proposals, paged, busy, problem, act } = useProposals(
    'duplicate',
    cachedReads.duplicateProposals,
    failure,
  );
  if (proposals.length === 0) return null;
  const replace = (item: DuplicateProposal) =>
    act(
      keyOf(item),
      item.transaction,
      {
        expectedVersion: item.transaction.version,
        hidden: false,
        classification: item.classification,
        ...(item.comment === null ? {} : { comment: item.comment }),
        replaces: { kind: item.record.kind, id: item.record.id, version: item.record.version },
      },
      () =>
        onReplaced(
          `Replaced your record with the wallet's: ${quantity(item.transaction.quantity)} ${item.coin} in ${item.transaction.accountName}.`,
        ),
    );

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
