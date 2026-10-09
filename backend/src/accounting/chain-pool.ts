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
// The raw rows stay as synced; only the owner's answers say what they were.

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
  deposited: string;
  returned: string;
  /** Coins returned above the deposit: pool income; "0" when none. */
  gain: string;
  /** Coins returned below the deposit: they left without a sale price; "0" when none. */
  loss: string;
}

/**
 * POOL-WITHDRAW, POOL-INVALID: the receipt returns the deposit of the same coin made earlier from
 * an address of the same account; the difference is the pool's gain or loss. Whether the
 * deposit is answered as one, and not already returned, the caller checks.
 */
export function planPoolWithdrawal(withdrawal: PoolLeg, deposit: PoolLeg): PlannedPoolWithdrawal {
  if (isExchange(withdrawal.network)) throw unfit();
  if (withdrawal.addressId === deposit.addressId && withdrawal.txid === deposit.txid)
    throw new UnprocessableEntityException('Choose a pool deposit');
  const returned = poolReturnUnits(withdrawal);
  if (returned <= 0n) throw unfit();
  const deposited = poolDepositUnits(deposit);
  if (isExchange(deposit.network) || deposited <= 0n)
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
  // Both legs move one coin; a token's units match across networks, so each side counts in
  // its own decimals.
  const depositedAtoms = canonicalDecimalToAtoms(poolCoins(deposited, deposit));
  const returnedAtoms = canonicalDecimalToAtoms(poolCoins(returned, withdrawal));
  const difference = returnedAtoms - depositedAtoms;
  return {
    accountId: withdrawal.accountId,
    occurredAt: withdrawal.blockTime,
    deposited: formatAtoms(depositedAtoms),
    returned: formatAtoms(returnedAtoms),
    gain: formatAtoms(difference > 0n ? difference : 0n),
    loss: formatAtoms(difference < 0n ? -difference : 0n),
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
  if (chosen !== null) return chosen;
  if (stablecoins.has(symbol)) return gain;
  if (priceUsd === null) return null;
  const product = canonicalDecimalToAtoms(gain) * canonicalDecimalToAtoms(priceUsd);
  // Atoms carry 30 places, so the product carries 60; cents keep 2, half away from zero.
  const unit = 10n ** 58n;
  const cents = (product + unit / 2n) / unit;
  return formatAtoms(cents * 10n ** 28n);
}

/**
 * D1 for a pool leg: how its answer moves the account's holdings, in the leg's base units. A
 * deposit and a withdrawal spend only their own network fee; a withdrawal that returned less
 * than its deposit also takes the shortfall, without a sale price. A gain is pool income, an
 * entry of its own.
 */
export function poolMoveUnits(leg: Units, deposit: Units | null): bigint {
  const fee = -ownFeeUnits(leg);
  if (deposit === null) return fee;
  const short = poolReturnUnits(leg) - poolDepositUnits(deposit);
  return short < 0n ? fee + short : fee;
}
