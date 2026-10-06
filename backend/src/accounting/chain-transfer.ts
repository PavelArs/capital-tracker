import { UnprocessableEntityException } from '@nestjs/common';
import { unfit } from './chain-classification';
import { formatAtoms } from './money';

// link-own-transfers (M13, XFER-*): coins that leave one of the owner's accounts and arrive in
// another are one transfer, which keeps their cost basis and changes capital only by the
// network fee (PR-OPS-6). The raw rows stay as synced; the transfer is an owned transfer.

/** One synced leg of a chain transaction on one of the owner's addresses. */
export interface OwnLeg {
  addressId: string;
  /** The account of the address (M10), or null until the owner picks one. */
  accountId: string | null;
  network: 'bitcoin';
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
}

/** The movement a transfer records, in the coin of the leg. */
export interface PlannedTransfer {
  fromAccountId: string;
  toAccountId: string;
  /** What arrived in the other account. */
  quantity: string;
  /** The network fee the sending account paid, or 0 when the sender is not a tracked leg. */
  feeQuantity: string;
}

const SAT_TO_ATOMS = 10n ** 22n;
const net = (leg: OwnLeg) => BigInt(leg.receivedUnits) - BigInt(leg.sentUnits);
const coins = (units: bigint) => formatAtoms(units * SAT_TO_ATOMS);

export const sameAccount = () =>
  new UnprocessableEntityException('Choose an account other than the one of this wallet');
export const mismatch = () =>
  new UnprocessableEntityException(
    'The other wallet did not receive what this one sent, less the network fee',
  );

/**
 * XFER-AUTO, XFER-MANUAL: the transfer that classifying `leg` as a move to or from
 * `counterAccountId` records. When the other side of the same transaction is one of the
 * owner's addresses in that account (`partner`), it must have received exactly what was sent
 * less the fee; otherwise an outgoing leg sends its amount less the fee and an incoming leg
 * receives its whole amount, its fee paid by the sender.
 */
export function planTransfer(
  leg: OwnLeg & { accountId: string },
  counterAccountId: string,
  partner: OwnLeg | null,
): PlannedTransfer {
  if (counterAccountId === leg.accountId) throw sameAccount();
  const moved = net(leg);
  if (moved === 0n) throw unfit();
  const sender = moved < 0n ? leg : partner;
  const fee = sender ? BigInt(sender.feeUnits) : 0n;
  let arrived: bigint;
  if (moved < 0n) {
    arrived = partner ? net(partner) : -moved - fee;
    if (arrived <= 0n || -moved !== arrived + fee) throw partner ? mismatch() : unfit();
  } else {
    arrived = moved;
    if (partner && -net(partner) !== arrived + fee) throw mismatch();
  }
  return {
    fromAccountId: moved < 0n ? leg.accountId : counterAccountId,
    toAccountId: moved < 0n ? counterAccountId : leg.accountId,
    quantity: coins(arrived),
    feeQuantity: coins(fee),
  };
}

/** A leg with the owner's current answer for it, for automatic matching. */
export interface MatchableLeg extends OwnLeg {
  txid: string;
  /** Null before the first answer. */
  status: 'unclassified' | 'classified' | 'hidden' | null;
}

/**
 * D7, XFER-AUTO, XFER-UNKNOWN: transactions that are certainly a transfer between two of the
 * owner's accounts. Exactly one of the owner's addresses sent and exactly one received, both
 * in accounts, different ones, neither answered yet, and the receiver got what was sent less
 * the fee. Anything less certain stays to classify; nothing is guessed.
 */
export function ownTransferPairs(
  legs: readonly MatchableLeg[],
): { outgoing: MatchableLeg; incoming: MatchableLeg }[] {
  const byTxid = new Map<string, MatchableLeg[]>();
  for (const leg of legs) byTxid.set(leg.txid, [...(byTxid.get(leg.txid) ?? []), leg]);
  const pairs: { outgoing: MatchableLeg; incoming: MatchableLeg }[] = [];
  for (const group of byTxid.values()) {
    const moving = group.filter((leg) => net(leg) !== 0n);
    if (moving.length !== 2) continue;
    const outgoing = moving.find((leg) => net(leg) < 0n);
    const incoming = moving.find((leg) => net(leg) > 0n);
    if (!outgoing || !incoming || outgoing.network !== incoming.network) continue;
    if (outgoing.accountId === null || incoming.accountId === null) continue;
    if (outgoing.accountId === incoming.accountId) continue;
    if (moving.some((leg) => leg.status !== null && leg.status !== 'unclassified')) continue;
    if (-net(outgoing) !== net(incoming) + BigInt(outgoing.feeUnits)) continue;
    pairs.push({ outgoing, incoming });
  }
  return pairs;
}
