import { cachedReads } from '@api/cached-reads';
import type { ProposedLeg, TransferProposal } from '@api/operations.api';
import { requestFailure } from '@/utils/request-failure';
import { quantity } from '../portfolio/format';
import LoadMore from '../shell/InfiniteScroll';
import { moment, shortAddress } from './operation-format';
import { ProposalCard, ProposalItem } from './ProposalCard';
import { useProposals } from './useProposals';

const place = (leg: ProposedLeg) =>
  leg.wallet.label ??
  (leg.wallet.network === 'bybit' ? 'Bybit account' : shortAddress(leg.wallet.address));

const refused = (message: string | undefined) =>
  message
    ? `These cannot be joined: ${message.charAt(0).toLowerCase()}${message.slice(1)}. Open the transactions to classify them yourself.`
    : 'These cannot be joined now. Open the transactions to classify them yourself.';

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. It may have been saved; reload the page to check.',
    status: { 409: refused, 422: refused },
    unsure: 'Could not join them. They may have been joined; reload the page to check.',
    fallback: 'Could not join them. Nothing was saved; try again.',
  });

/**
 * XFER-PROPOSED: a withdrawal and a receipt of one coin in two accounts that look like one
 * transfer but name different transactions. Nothing is joined until the owner says so; one
 * tap answers the withdrawal as a transfer naming the receipt, and what went missing between
 * them is the transfer's fee.
 */
export default function TransferProposals({ onJoined }: { onJoined: (message: string) => void }) {
  const { found, proposals, paged, busy, problem, act } = useProposals(
    'transfer',
    cachedReads.transferProposals,
    failure,
  );
  if (proposals.length === 0) return null;
  const keyOf = (item: TransferProposal) => `${item.outgoing.addressId}:${item.outgoing.txid}`;
  const join = (item: TransferProposal) =>
    act(
      keyOf(item),
      item.outgoing,
      {
        expectedVersion: item.outgoing.version,
        hidden: false,
        classification: {
          type: 'transfer' as const,
          accountId: item.incoming.accountId,
          partner: { addressId: item.incoming.addressId, txid: item.incoming.txid },
        },
      },
      () =>
        onJoined(
          `Joined as one transfer: ${quantity(item.arrived)} ${item.coin} from ${item.outgoing.accountName} to ${item.incoming.accountName}.`,
        ),
    );

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
