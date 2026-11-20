import type { ExchangeFill, Operation } from '@api/operations.api';
import { sumDecimals } from '@/utils/decimal';

// BYBIT-P2P: a Bybit spot fill is recorded as a Buy or Sell by itself once its account's records
// hold what it spent. Until then it stays to classify; a buy usually waits for USDT bought on
// P2P, which Bybit's API never lists.

/** The fill of a Bybit trade still to classify in an account, or null. */
export function waitingFill(operation: Operation): ExchangeFill | null {
  const fill = operation.chain?.fill;
  return fill && operation.status === 'needs-classification' && operation.account ? fill : null;
}

/** The buys of one account waiting for the same coin. */
export interface WaitingBuys {
  accountId: string;
  currency: ExchangeFill['currency'];
  /** When the first of them happened. */
  first: string;
  count: number;
  /** What they spent together, fees included. */
  total: string;
}

/** The waiting buys of the operation's account in its coin, the operation included. */
export function waitingBuys(
  operation: Operation,
  operations: readonly Operation[],
): WaitingBuys | null {
  const fill = waitingFill(operation);
  const accountId = operation.account?.id;
  if (fill?.side !== 'buy' || !accountId) return null;
  const others = operations.filter((item) => item.id !== operation.id);
  const fills = [operation, ...others].flatMap((item) => {
    const other = waitingFill(item);
    return other?.side === 'buy' &&
      other.currency === fill.currency &&
      item.account?.id === accountId
      ? [{ at: item.occurredAt, spent: [other.amount, other.fee] }]
      : [];
  });
  return {
    accountId,
    currency: fill.currency,
    first: fills.map((item) => item.at).sort()[0],
    count: fills.length,
    total: sumDecimals(fills.flatMap((item) => item.spent)),
  };
}

/**
 * A minute before an instant, as the UTC date and HH:MM time the Add transaction window takes:
 * a purchase dated then comes before the trade.
 */
export function minuteBefore(at: string): { date: string; time: string } {
  const before = new Date(Date.parse(at) - 60_000).toISOString();
  return { date: before.slice(0, 10), time: before.slice(11, 16) };
}
