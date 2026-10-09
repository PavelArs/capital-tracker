// CLS-RECORDED: a chain transaction the owner already added by hand or from CSV. The answer names
// that trade or swap in the wallet's own account and records nothing; the record counts, the
// transaction no longer does on its own. Should the record be deleted, or the wallet move to
// another account, the transaction counts and asks to be classified again.

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

/** SQL: the answer `v` names a record that no longer counts, so the transaction is unanswered. */
export const recordGone = (v: string, account: string) =>
  `(${v}.status='classified' AND ${v}.type='recorded' AND NOT ${recordCounts(v, account)})`;
