import type { TradeCommand } from '@api/trades.api';
import {
  decimal,
  MAX_COMMENT_LENGTH,
  positive,
  type TransactionEntry,
  tradeFromEntry,
  trimmed,
} from './add-transaction';

// "Convert" in the Add transaction window: cash in one currency becomes cash in another, such as
// rubles handed over for dollars. It is one sale of the cash given up, settled in the cash
// received (CASH-CONVERT): the account's balance of each moves, nothing counts as money in or
// out, and the cost of the cash given up leaves first-in first-out like any other sale.
export const cashCurrencies = ['USD', 'EUR', 'RUB'] as const;
export type CashCurrency = (typeof cashCurrencies)[number];

export interface ConvertEntry {
  from: CashCurrency;
  to: CashCurrency;
  /** Units of `from` handed over. */
  amount: string;
  /** Units of `to` received. */
  received: string;
  date: string;
  time: string;
  comment: string;
}

export type ConvertProblem = 'currency' | 'amount' | 'received' | 'date' | 'time' | 'comment';

export function convertProblems(entry: ConvertEntry, today: string): Set<ConvertProblem> {
  const found = new Set<ConvertProblem>();
  if (entry.from === entry.to) found.add('currency');
  if (positive(entry.amount) === null) found.add('amount');
  if (positive(entry.received) === null) found.add('received');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date > today) found.add('date');
  if (entry.time && !/^\d{2}:\d{2}$/.test(entry.time)) found.add('time');
  if ([...entry.comment.trim()].length > MAX_COMMENT_LENGTH) found.add('comment');
  return found;
}

const PLACES = 18;

/** `numerator / denominator` of two positive decimal strings, rounded to 18 places and trimmed. */
function quotient(numerator: string, denominator: string): string {
  const atoms = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(PLACES, '0').slice(0, PLACES));
  };
  const divisor = atoms(denominator);
  const scaled = (atoms(numerator) * 10n ** BigInt(PLACES) * 2n + divisor) / (divisor * 2n);
  const padded = String(scaled).padStart(PLACES + 1, '0');
  const fraction = padded.slice(-PLACES).replace(/0+$/, '');
  const whole = padded.slice(0, -PLACES);
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * What one unit of the cash given up fetched in the cash received, as units of `to` per unit of
 * `from`; null while an amount is missing. It is the owner's own rate, from the two amounts.
 */
export function impliedRate(entry: Pick<ConvertEntry, 'amount' | 'received'>): string | null {
  const amount = decimal(entry.amount);
  const received = decimal(entry.received);
  return amount === null || received === null || !positive(amount) || !positive(received)
    ? null
    : quotient(received, amount);
}

/**
 * The rate in words for the two amounts, a dollar or else a euro as the unit: "1 USD = 90 RUB".
 * Shown only; the saved amounts are what was typed.
 */
export function rateText(entry: ConvertEntry): string | null {
  const rate = impliedRate(entry);
  if (rate === null) return null;
  const base = [entry.from, entry.to].includes('USD') ? 'USD' : 'EUR';
  const other = entry.from === base ? entry.to : entry.from;
  const perBase =
    entry.from === base ? rate : quotient(decimal(entry.amount)!, decimal(entry.received)!);
  return `1 ${base} = ${trimmed(Number(perBase), 4)} ${other}`;
}

/**
 * The sale as the server takes it. USD received is the sale's USD amount itself. EUR or RUB
 * received go as paid: when the cash given up is USD the owner's two amounts are the rate, so
 * the sale is worth exactly the dollars handed over; between EUR and RUB the server values the
 * amount at the Bank of Russia rate of the day.
 */
export function convertTrade(
  entry: ConvertEntry,
  instrumentId: string,
  identity: { requestId: string; expectedJournalRevision: number },
  orderWithinTimestamp?: number,
): TradeCommand {
  const ownRate = entry.from === 'USD' && entry.to !== 'USD';
  const sale: TransactionEntry = {
    side: 'sell',
    instrumentId,
    amount: decimal(entry.amount)!,
    date: entry.date,
    time: entry.time,
    total: decimal(entry.received)!,
    currency: entry.to,
    rate: ownRate ? (impliedRate(entry) ?? '') : '',
    rateEdited: ownRate,
    fee: '',
    comment: entry.comment,
  };
  return tradeFromEntry(sale, identity, orderWithinTimestamp, true);
}
