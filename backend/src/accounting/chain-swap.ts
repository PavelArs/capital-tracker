import { UnprocessableEntityException } from '@nestjs/common';
import { chainAsset, type Network, unitsToAtoms } from '../wallet-addresses/chain-assets';
import { unfit } from './chain-classification';
import { canonicalDecimalToAtoms, formatAtoms } from './money';

// swap-chain-coins (CLS-SWAP-*): coins that left one of the owner's addresses paid for other
// coins that arrived at one of them, any coin for any other. The two raw rows stay as synced;
// together they are one swap in the account the bought coins arrived in.

/** One synced leg of a swap, on one of the owner's addresses. */
export interface SwapSide {
  addressId: string;
  txid: string;
  /** The account of the address (M10), or null until the owner picks one. */
  accountId: string | null;
  network: Network;
  /** The token the leg moves (M14), or null for the network's own coin. */
  asset: string | null;
  blockTime: string;
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
}

/** What one swap of two legs records. */
export interface PlannedSwap {
  /** The account the bought coins arrived in; it records the swap. */
  accountId: string;
  /** When the bought coins arrived. */
  occurredAt: string;
  paying: SwapSide & { accountId: string };
  receiving: SwapSide & { accountId: string };
  /** What left the paying address for the swap, its network fee not included. */
  paid: string;
  received: string;
  /** The paying leg's network fee when it is paid in the coin the leg moves, else 0. */
  feeQuantity: string;
  /**
   * Paid from another account: the owned transfer that brings the paid coins over first, with
   * the network fee; the swap itself then pays none.
   */
  carry: {
    fromAccountId: string;
    toAccountId: string;
    occurredAt: string;
    quantity: string;
    feeQuantity: string;
  } | null;
}

const net = (leg: SwapSide) => BigInt(leg.receivedUnits) - BigInt(leg.sentUnits);
const coins = (units: bigint, leg: SwapSide) =>
  formatAtoms(unitsToAtoms(units, chainAsset(leg.network, leg.asset)));
const symbol = (leg: SwapSide) => chainAsset(leg.network, leg.asset).symbol;
const placed = (leg: SwapSide, other: string): SwapSide & { accountId: string } => {
  if (leg.accountId === null) throw new UnprocessableEntityException(other);
  return { ...leg, accountId: leg.accountId };
};
/** USD stablecoins count 1:1 with USD, as cash does (M9). */
const stablecoins = new Set(['USDT', 'USDC']);

/**
 * CLS-SWAP-SAME, CLS-SWAP-CROSS: the swap that classifying `leg` as paid with or paying for
 * `other` records. The paying leg is the one coins left; a fee in the coin it moves is not part
 * of what it paid. Paid from another account, an owned transfer brings the coins to the
 * receiving account first, no later than they arrive, and pays the fee there.
 */
export function planSwap(leg: SwapSide, other: SwapSide): PlannedSwap {
  if (leg.addressId === other.addressId && leg.txid === other.txid)
    throw new UnprocessableEntityException('Choose the other side of the swap');
  const own = placed(leg, 'Choose the account of this wallet first');
  const counter = placed(other, 'Choose the account of the other wallet first');
  if (net(own) === 0n || net(counter) === 0n) throw unfit();
  if (net(own) > 0n === net(counter) > 0n)
    throw new UnprocessableEntityException('Choose a transaction that moved coins the other way');
  const [paying, receiving] = net(own) < 0n ? [own, counter] : [counter, own];
  if (symbol(paying) === symbol(receiving))
    throw new UnprocessableEntityException('A swap needs two different coins');
  // A token leg's fee is paid in the network's coin, by a leg of its own.
  const fee = paying.asset === null ? BigInt(paying.feeUnits) : 0n;
  const paid = -net(paying) - fee;
  if (paid <= 0n) throw unfit();
  const occurredAt = receiving.blockTime;
  const carried = paying.accountId !== receiving.accountId;
  return {
    accountId: receiving.accountId,
    occurredAt,
    paying,
    receiving,
    paid: coins(paid, paying),
    received: coins(net(receiving), receiving),
    feeQuantity: carried ? '0' : coins(fee, paying),
    carry: carried
      ? {
          fromAccountId: paying.accountId,
          toAccountId: receiving.accountId,
          occurredAt: paying.blockTime < occurredAt ? paying.blockTime : occurredAt,
          quantity: coins(paid, paying),
          feeQuantity: coins(fee, paying),
        }
      : null,
  };
}

/**
 * CLS-SWAP-VALUE: what the swap was worth in USD, the bought coins' cost basis and the paid
 * coins' proceeds. The owner's value wins; a stablecoin on either side counts 1:1; otherwise
 * the stored price of the paid coin, rounded to cents. Unknown stays null, never 0.
 */
export function swapValueUsd(
  chosen: string | null,
  plan: Pick<PlannedSwap, 'paying' | 'receiving' | 'paid' | 'received'>,
  paidPriceUsd: string | null,
): string | null {
  if (chosen !== null) return chosen;
  if (stablecoins.has(symbol(plan.paying))) return plan.paid;
  if (stablecoins.has(symbol(plan.receiving))) return plan.received;
  if (paidPriceUsd === null) return null;
  const product = canonicalDecimalToAtoms(plan.paid) * canonicalDecimalToAtoms(paidPriceUsd);
  // Atoms carry 30 places, so the product carries 60; cents keep 2, half away from zero.
  const unit = 10n ** 58n;
  const cents = (product + unit / 2n) / unit;
  return formatAtoms(cents * 10n ** 28n);
}

/** CLS-SWAP-RECORD: how far apart a transaction and the record it replaces can be. */
export const SWAP_RECORD_WINDOW_MS = 7 * 24 * 3_600_000;

/** What a swap of one transaction against a record the owner added by hand records. */
export interface PlannedRecordSwap {
  /** The wallet's account; it holds the swap. */
  accountId: string;
  /** When the transaction happened: the swap takes its time, not the record's. */
  occurredAt: string;
  /** The transaction's coins left the wallet (the record is a purchase) or arrived (a sale). */
  paying: boolean;
  /** The transaction's coins, its network fee not included. */
  quantity: string;
  /** The network fee, when the transaction paid it in the coin it moved. */
  feeQuantity: string;
}

/**
 * CLS-SWAP-RECORD: the swap that answering `leg` as a swap against a purchase or sale added by
 * hand records. The record stands for the other side, so only this transaction is read.
 */
export function planRecordSwap(leg: SwapSide): PlannedRecordSwap {
  const own = placed(leg, 'Choose the account of this wallet first');
  const moved = net(own);
  if (moved === 0n) throw unfit();
  const paying = moved < 0n;
  const fee = paying && own.asset === null ? BigInt(own.feeUnits) : 0n;
  const quantity = paying ? -moved - fee : moved;
  if (quantity <= 0n) throw unfit();
  return {
    accountId: own.accountId,
    occurredAt: own.blockTime,
    paying,
    quantity: coins(quantity, own),
    feeQuantity: coins(fee, own),
  };
}
