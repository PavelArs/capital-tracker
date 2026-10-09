import { UnprocessableEntityException } from '@nestjs/common';
import {
  chainAsset,
  isExchange,
  type Network,
  unitsToAtoms,
} from '../wallet-addresses/chain-assets';
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
  network: Network;
  /** The token the leg moves (M14), or null for the network's own coin. */
  asset: string | null;
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
}

/** The movement a transfer records, in the asset of the leg; a token leg carries no fee. */
export interface PlannedTransfer {
  fromAccountId: string;
  toAccountId: string;
  /** What arrived in the other account. */
  quantity: string;
  /** The network fee the sending account paid, or 0 when the sender is not a tracked leg. */
  feeQuantity: string;
}

const net = (leg: OwnLeg) => BigInt(leg.receivedUnits) - BigInt(leg.sentUnits);
// Amounts compared across two legs are in accounting atoms: a Bybit leg (M22) keeps 18
// decimals where the chain keeps its own.
const atoms = (units: bigint, leg: OwnLeg) =>
  unitsToAtoms(units, chainAsset(leg.network, leg.asset));
const netAtoms = (leg: OwnLeg) => atoms(net(leg), leg);
const feeAtoms = (leg: OwnLeg) => atoms(BigInt(leg.feeUnits), leg);
/** The coin a leg moves, whatever network carries it: BTC, ETH, SOL, USDT or USDC. */
export const coinOf = (leg: Pick<OwnLeg, 'network' | 'asset'>) =>
  chainAsset(leg.network, leg.asset).symbol;

/**
 * BYBIT-DEPOSIT: whether two legs are the two sides of one transaction. A chain leg of a token
 * adds its log or token number to the hash, which Bybit's record does not know, so a Bybit
 * leg meets a wallet's leg by the hash alone.
 */
export function sameTransaction(
  left: Pick<OwnLeg, 'network'> & { txid: string },
  right: Pick<OwnLeg, 'network'> & { txid: string },
): boolean {
  if (left.txid === right.txid) return true;
  if (isExchange(left.network) === isExchange(right.network)) return false;
  const [exchange, chain] = isExchange(left.network) ? [left, right] : [right, left];
  return chain.txid.split('-')[0] === exchange.txid;
}

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
  if (partner && coinOf(partner) !== coinOf(leg)) throw mismatch();
  const moved = netAtoms(leg);
  if (moved === 0n) throw unfit();
  const sender = moved < 0n ? leg : partner;
  const fee = sender ? feeAtoms(sender) : 0n;
  let arrived: bigint;
  if (moved < 0n) {
    arrived = partner ? netAtoms(partner) : -moved - fee;
    if (arrived <= 0n || -moved !== arrived + fee) throw partner ? mismatch() : unfit();
  } else {
    arrived = moved;
    if (partner && -netAtoms(partner) !== arrived + fee) throw mismatch();
  }
  return {
    fromAccountId: moved < 0n ? leg.accountId : counterAccountId,
    toAccountId: moved < 0n ? counterAccountId : leg.accountId,
    quantity: formatAtoms(arrived),
    feeQuantity: formatAtoms(fee),
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
  const pairs: { outgoing: MatchableLeg; incoming: MatchableLeg }[] = [];
  const certain = (moving: MatchableLeg[]) => {
    if (moving.length !== 2) return;
    const outgoing = moving.find((leg) => net(leg) < 0n);
    const incoming = moving.find((leg) => net(leg) > 0n);
    if (!outgoing || !incoming || coinOf(outgoing) !== coinOf(incoming)) return;
    if (outgoing.accountId === null || incoming.accountId === null) return;
    if (outgoing.accountId === incoming.accountId) return;
    if (moving.some((leg) => leg.status !== null && leg.status !== 'unclassified')) return;
    if (-netAtoms(outgoing) !== netAtoms(incoming) + feeAtoms(outgoing)) return;
    pairs.push({ outgoing, incoming });
  };
  const moving = legs.filter((leg) => net(leg) !== 0n);
  // Between wallets: the legs of one transaction identity.
  const byTxid = new Map<string, MatchableLeg[]>();
  for (const leg of moving)
    if (!isExchange(leg.network)) byTxid.set(leg.txid, [...(byTxid.get(leg.txid) ?? []), leg]);
  for (const group of byTxid.values()) certain(group);
  // BYBIT-DEPOSIT: a Bybit deposit or withdrawal and the one wallet leg of the same coin in
  // the same transaction.
  for (const exchange of moving.filter((leg) => isExchange(leg.network)))
    certain([
      exchange,
      ...moving.filter(
        (leg) =>
          !isExchange(leg.network) &&
          sameTransaction(exchange, leg) &&
          coinOf(leg) === coinOf(exchange),
      ),
    ]);
  return pairs;
}
