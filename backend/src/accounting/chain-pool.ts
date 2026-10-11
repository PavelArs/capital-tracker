import { UnprocessableEntityException } from '@nestjs/common';
import {
  chainAsset,
  isExchange,
  type Network,
  unitsToAtoms,
} from '../wallet-addresses/chain-assets';
import { unfit } from './chain-classification';
import { canonicalDecimalToAtoms, formatAtoms } from './money';

// liquidity-pool-chain-legs (POOL-*): coins the owner put into a liquidity pool (Uniswap and
// the like) stay theirs, with their purchase price, until the pool returns them. A withdrawal
// names the deposit of the same coin it returns: what came back above the deposit is pool
// income at the time, what came back below it left without a sale price (impermanent loss).
// A withdrawal marked as a part of the deposit (POOL-PARTIAL) leaves the rest in the pool; the
// withdrawals of one deposit are settled in the order they happened, and one that is not a part
// closes it. The raw rows stay as synced; only the owner's answers say what they were.

/** One synced leg of a pool deposit or withdrawal, on one of the owner's addresses. */
export interface PoolLeg {
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

type Units = Pick<PoolLeg, 'network' | 'asset' | 'receivedUnits' | 'sentUnits' | 'feeUnits'>;

/** The network fee the leg itself paid: a chain's own coin carries it, a token leg does not. */
export function ownFeeUnits(leg: Units): bigint {
  return leg.asset === null && !isExchange(leg.network) ? BigInt(leg.feeUnits) : 0n;
}

/** POOL-DEPOSIT: what went into the pool, the network fee apart; 0 or less moved nothing in. */
export function poolDepositUnits(leg: Units): bigint {
  return BigInt(leg.sentUnits) - BigInt(leg.receivedUnits) - ownFeeUnits(leg);
}

/** POOL-WITHDRAW: what the pool returned, the network fee of the withdrawal apart. */
export function poolReturnUnits(leg: Units): bigint {
  return BigInt(leg.receivedUnits) - BigInt(leg.sentUnits) + ownFeeUnits(leg);
}

/** Base units of the leg's asset as a decimal string, signed. */
export function poolCoins(units: bigint, leg: Pick<PoolLeg, 'network' | 'asset'>): string {
  const asset = chainAsset(leg.network, leg.asset);
  const magnitude = formatAtoms(unitsToAtoms(units < 0n ? -units : units, asset));
  return units < 0n ? `-${magnitude}` : magnitude;
}

/** What one withdrawal of a deposit records. */
export interface PlannedPoolWithdrawal {
  accountId: string;
  /** When the coins came back. */
  occurredAt: string;
  /** What the whole deposit put into the pool. */
  deposited: string;
  returned: string;
  /** Coins returned above what was still in the pool: pool income; "0" when none. */
  gain: string;
  /** Coins the pool kept for good, below what was still in it: left without a sale price. */
  loss: string;
  /** Whether more of the deposit is expected back, so a shortfall is no loss yet. */
  partial: boolean;
  /** What is still in the pool after this withdrawal; "0" once the deposit is closed. */
  remaining: string;
}

/** A withdrawal of one deposit, in the coin's accounting atoms. */
export interface PoolStep {
  returnedAtoms: bigint;
  partial: boolean;
}

/** What one withdrawal did to its deposit, in accounting atoms. */
export interface PoolSettlement {
  /** The part of the deposit that came back. */
  principal: bigint;
  /** What came back beyond what was still in the pool. */
  gain: bigint;
  /** What the pool kept: only the withdrawal that closes the deposit can lose. */
  loss: bigint;
  /** What is still in the pool afterwards. */
  remaining: bigint;
}

/**
 * POOL-PARTIAL: settles the withdrawals of one deposit, oldest first. Each returns the deposit
 * up to what is still in the pool and the rest is gain; one that is not a part closes the
 * deposit, so what it left is a loss.
 */
export function settlePool(depositedAtoms: bigint, steps: readonly PoolStep[]): PoolSettlement[] {
  let remaining = depositedAtoms;
  return steps.map(({ returnedAtoms, partial }) => {
    const principal = returnedAtoms < remaining ? returnedAtoms : remaining;
    const loss = partial ? 0n : remaining - principal;
    remaining = partial ? remaining - principal : 0n;
    return { principal, gain: returnedAtoms - principal, loss, remaining };
  });
}

/** What the leg returned, in accounting atoms. */
export function poolReturnAtoms(leg: Units): bigint {
  return unitsToAtoms(poolReturnUnits(leg), chainAsset(leg.network, leg.asset));
}

/** What the deposit leg put into the pool, in accounting atoms. */
export function poolDepositAtoms(leg: Units): bigint {
  return unitsToAtoms(poolDepositUnits(leg), chainAsset(leg.network, leg.asset));
}

/** The order the withdrawals of one deposit happened in: time, then transaction id. */
export function byPoolOrder(
  left: { blockTime: string | Date; txid: string },
  right: { blockTime: string | Date; txid: string },
): number {
  const [a, b] = [new Date(left.blockTime).getTime(), new Date(right.blockTime).getTime()];
  if (a !== b) return a - b;
  return left.txid < right.txid ? -1 : left.txid > right.txid ? 1 : 0;
}

/**
 * POOL-WITHDRAW, POOL-INVALID: whether the receipt can return the deposit of the same coin made
 * earlier from an address of the same account. Whether the deposit is answered as one, and not
 * already returned, the caller checks.
 */
export function checkPoolWithdrawal(withdrawal: PoolLeg, deposit: PoolLeg): void {
  if (isExchange(withdrawal.network)) throw unfit();
  if (withdrawal.addressId === deposit.addressId && withdrawal.txid === deposit.txid)
    throw new UnprocessableEntityException('Choose a pool deposit');
  if (poolReturnUnits(withdrawal) <= 0n) throw unfit();
  if (isExchange(deposit.network) || poolDepositUnits(deposit) <= 0n)
    throw new UnprocessableEntityException('Choose a pool deposit');
  const coin = (leg: PoolLeg) => chainAsset(leg.network, leg.asset).symbol;
  if (coin(withdrawal) !== coin(deposit))
    throw new UnprocessableEntityException('A pool withdrawal returns the coin of its deposit');
  if (withdrawal.accountId === null)
    throw new UnprocessableEntityException('Choose the account of this wallet first');
  if (deposit.accountId !== withdrawal.accountId)
    throw new UnprocessableEntityException('Choose a pool deposit of this wallet');
  if (deposit.blockTime > withdrawal.blockTime)
    throw new UnprocessableEntityException('Choose a pool deposit made before this withdrawal');
}

/** A withdrawal of one deposit, as the caller found it. */
export interface PoolWithdrawalOf {
  leg: PoolLeg;
  partial: boolean;
}

/**
 * POOL-WITHDRAW, POOL-PARTIAL, POOL-INVALID: what the receipt records against its deposit; the
 * difference is the pool's gain or loss. `earlier` are the withdrawals of the same deposit
 * made before it, oldest first.
 */
export function planPoolWithdrawal(
  withdrawal: PoolLeg,
  deposit: PoolLeg,
  options: { partial?: boolean; earlier?: readonly PoolWithdrawalOf[] } = {},
): PlannedPoolWithdrawal {
  checkPoolWithdrawal(withdrawal, deposit);
  const partial = options.partial === true;
  const earlier = options.earlier ?? [];
  // Parts of one deposit are added up in base units, so they come back on its own network.
  const together = (leg: PoolLeg) => leg.network === deposit.network && leg.asset === deposit.asset;
  if (
    (partial || earlier.length > 0) &&
    ![withdrawal, ...earlier.map((e) => e.leg)].every(together)
  )
    throw new UnprocessableEntityException(
      'Withdrawals of one deposit come back on the network of the deposit',
    );
  const deposited = poolDepositAtoms(deposit);
  const settled = settlePool(deposited, [
    ...earlier.map((item) => ({
      returnedAtoms: poolReturnAtoms(item.leg),
      partial: item.partial,
    })),
    { returnedAtoms: poolReturnAtoms(withdrawal), partial },
  ]);
  const before = earlier.length > 0 ? settled[earlier.length - 1].remaining : deposited;
  if (before === 0n)
    throw new UnprocessableEntityException('That pool deposit was already returned in full');
  const mine = settled[earlier.length];
  return {
    accountId: withdrawal.accountId as string,
    occurredAt: withdrawal.blockTime,
    deposited: formatAtoms(deposited),
    returned: formatAtoms(poolReturnAtoms(withdrawal)),
    gain: formatAtoms(mine.gain),
    loss: formatAtoms(mine.loss),
    partial,
    remaining: formatAtoms(mine.remaining),
  };
}

/** USD stablecoins count 1:1 with USD, as cash does (M9). */
const stablecoins = new Set(['USDT', 'USDC']);

/**
 * POOL-WITHDRAW: what the gain was worth in USD, its cost basis and income. The owner's value
 * wins; USDT and USDC count 1:1; otherwise the coin's stored price, rounded to cents. Unknown
 * stays null, never 0.
 */
export function poolGainValueUsd(
  chosen: string | null,
  symbol: string,
  gain: string,
  priceUsd: string | null,
): string | null {
  return chosen ?? storedValueUsd(symbol, gain, priceUsd);
}

/**
 * What a quantity of a coin was worth in USD when nobody said: USDT and USDC count 1:1;
 * otherwise the coin's stored price, rounded to cents. Unknown stays null, never 0.
 */
export function storedValueUsd(
  symbol: string,
  quantity: string,
  priceUsd: string | null,
): string | null {
  if (stablecoins.has(symbol)) return quantity;
  if (priceUsd === null) return null;
  const product = canonicalDecimalToAtoms(quantity) * canonicalDecimalToAtoms(priceUsd);
  // Atoms carry 30 places, so the product carries 60; cents keep 2, half away from zero.
  const unit = 10n ** 58n;
  const cents = (product + unit / 2n) / unit;
  return formatAtoms(cents * 10n ** 28n);
}

/**
 * D1 for a pool leg: how its answer moves the account's holdings, in the leg's base units. A
 * deposit and a withdrawal spend only their own network fee; a withdrawal that closed its
 * deposit with less than was in the pool also takes the shortfall (`loss`, in the leg's base
 * units), without a sale price. A gain is pool income, an entry of its own.
 */
export function poolMoveUnits(leg: Units, loss = 0n): bigint {
  return -ownFeeUnits(leg) - loss;
}

/** Accounting atoms as base units of the leg's asset, rounded down. */
export function poolAtomsToUnits(atoms: bigint, leg: Pick<PoolLeg, 'network' | 'asset'>): bigint {
  return atoms / unitsToAtoms(1n, chainAsset(leg.network, leg.asset));
}
