// CLS-RECORDED: a chain transaction the owner already added by hand or from CSV. The answer names
// that trade or swap in the wallet's own account and records nothing; the record counts, the
// transaction no longer does on its own. Should the record be deleted, or the wallet move to
// another account, the transaction counts and asks to be classified again.
//
// CLS-PAID: USDT or USDC that left one wallet to pay for a purchase the owner added by hand in
// another account. The answer carries the coins over to that account (an owned transfer) and
// settles the purchase anew, so it spends them instead of counting as money from outside.

import { UnprocessableEntityException } from '@nestjs/common';
import { canonicalDecimalToAtoms } from './money';
import { cashAsset } from './trade-settlement';

/** The coins a manual or CSV record moved, by symbol in upper case. */
export interface RecordCoins {
  received: (string | null)[];
  sent: (string | null)[];
}

/** A trade's coins: a buy receives its asset and spends its cash, a sale the other way. */
export function tradeCoins(
  side: 'buy' | 'sell',
  asset: string | null,
  settlement: string | null,
): RecordCoins {
  const [received, sent] = side === 'buy' ? [asset, settlement] : [settlement, asset];
  return { received: [upper(received)], sent: [upper(sent)] };
}

/** A swap's coins: what it paid and what it got. */
export function swapCoins(outgoing: string | null, incoming: string | null): RecordCoins {
  return { received: [upper(incoming)], sent: [upper(outgoing)] };
}

/** Whether the record moved the leg's coin the way the leg did. */
export function recordMoves(coins: RecordCoins, symbol: string, inbound: boolean): boolean {
  return (inbound ? coins.received : coins.sent).includes(symbol.toUpperCase());
}

const upper = (symbol: string | null) => symbol?.toUpperCase() ?? null;

/**
 * SQL: the trade or swap the answer `v` names still counts in the account `account` (an SQL
 * expression). Ids were stored in lower case, as Postgres prints them.
 */
const recordCounts = (v: string, account: string) => `(EXISTS (
    SELECT 1 FROM account_trades rt
      JOIN account_trade_versions rv ON rv."ownerId"=rt."ownerId"
        AND rv."accountId"=rt."accountId" AND rv."tradeId"=rt.id
        AND rv.version=rt."currentVersion"
      WHERE ${v}.details->'operation'->>'kind'='trade' AND rt."ownerId"=${v}."ownerId"
        AND rt."accountId"=${account} AND rt.id::text=${v}.details->'operation'->>'id'
        AND rv.kind<>'void')
  OR EXISTS (
    SELECT 1 FROM account_swaps rs
      JOIN account_swap_versions rw ON rw."ownerId"=rs."ownerId"
        AND rw."accountId"=rs."accountId" AND rw."swapId"=rs.id
        AND rw.version=rs."currentVersion"
      WHERE ${v}.details->'operation'->>'kind'='swap' AND rs."ownerId"=${v}."ownerId"
        AND rs."accountId"=${account} AND rs.id::text=${v}.details->'operation'->>'id'
        AND rw.kind<>'void'))`;

/**
 * SQL: the answer `v` names a record that no longer counts, so the transaction is unanswered.
 * An answer that carried coins to the record's account (CLS-PAID) stays what it did, a transfer,
 * whatever becomes of the purchase.
 */
export const recordGone = (v: string, account: string) =>
  `(${v}.status='classified' AND ${v}.type='recorded' AND ${v}."transferId" IS NULL
    AND NOT ${recordCounts(v, account)})`;

/** The coins a purchase can be settled in and a wallet can send. */
const payingCoins: readonly string[] = Object.values(cashAsset)
  .filter((asset) => asset.assetType === 'crypto')
  .map((asset) => asset.symbol);

/** A purchase the owner added, as far as paying for it from a wallet is concerned. */
export interface PurchaseRecord {
  side: 'buy' | 'sell';
  asset: string | null;
  /** The cash asset of its settlement, if it has one. */
  cash: string | null;
  /** Atoms of that cash the purchase spent from its account. */
  cashSpent: bigint;
  /** What the purchase cost in all, in atoms of its cash: price and fee. */
  total: bigint;
  /** Paid in RUB or EUR, or an income, gift or fee entry: not settled in coins. */
  other: boolean;
}

const refuse = (message: string) => new UnprocessableEntityException(message);

/** The coins a purchase has still to be paid with, in atoms; refuses a purchase coins cannot pay. */
export function unpaidFor(record: PurchaseRecord, coin: string): bigint {
  const symbol = coin.toUpperCase();
  if (record.side !== 'buy' || record.other)
    throw refuse('Only a purchase paid in USDT or USDC can be paid from another wallet');
  if (!payingCoins.includes(symbol))
    throw refuse('Only USDT or USDC can pay for a purchase in another wallet');
  if (record.cash !== null && record.cash.toUpperCase() !== symbol && record.cashSpent > 0n)
    throw refuse(`That purchase was paid with ${record.cash}`);
  const unpaid = record.total - (record.cash?.toUpperCase() === symbol ? record.cashSpent : 0n);
  if (unpaid <= 0n) throw refuse('That purchase was already paid from the cash of its account');
  return unpaid;
}

/** CLS-PAID: the instant the coins must have reached the purchase's account by, just before it. */
export function carryTime(sent: Date, purchased: Date): Date {
  return sent < purchased ? sent : new Date(purchased.getTime() - 1);
}

/** The cost of a purchase in atoms of its cash, from the stored decimal strings. */
export const purchaseTotal = (grossUsd: string, feeUsd: string): bigint =>
  canonicalDecimalToAtoms(grossUsd) + canonicalDecimalToAtoms(feeUsd);
