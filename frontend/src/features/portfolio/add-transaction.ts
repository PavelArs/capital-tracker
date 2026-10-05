import type { FxRatesReport } from '@api/fx-rates.api';
import type { TradeCommand } from '@api/trades.api';

// "Add transaction" from the accepted prototype, limited to buys and sells and the currency
// they were paid in (CUR-PAID-RUB). Other types and wallet-balance rules come with M9.
export const paidIn = ['USD', 'USDT', 'USDC', 'EUR', 'RUB'] as const;
export type PaidIn = (typeof paidIn)[number];
export const needsRate = (currency: PaidIn): currency is 'EUR' | 'RUB' =>
  currency === 'EUR' || currency === 'RUB';

export interface TransactionEntry {
  side: 'buy' | 'sell';
  instrumentId: string;
  amount: string;
  date: string;
  time: string;
  total: string;
  currency: PaidIn;
  /** Units of the paid currency per 1 USD, as shown in the rate field. */
  rate: string;
  /** Whether the owner changed the prefilled Bank of Russia rate. */
  rateEdited: boolean;
  fee: string;
}

/** "1 000,50" as typed becomes "1000.50"; anything else that is not a decimal is null. */
export function decimal(value: string): string | null {
  const text = value.replace(/[\s ]/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}
export const positive = (value: string) => {
  const text = decimal(value);
  return text !== null && Number(text) > 0 ? text : null;
};

/** Display figure for a rate or a computed amount; the saved amounts are what was typed. */
export function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/** The Bank of Russia rate of the date as units per 1 USD, or null if none is stored. */
export function bankRate(currency: 'EUR' | 'RUB', report: FxRatesReport): string | null {
  const rub = (code: 'USD' | 'EUR') =>
    report.rates.find((rate) => rate.currency === code)?.rubPerUnit ?? null;
  const usd = rub('USD');
  if (usd === null) return null;
  if (currency === 'RUB') return usd;
  const eur = rub('EUR');
  return eur === null ? null : trimmed(Number(usd) / Number(eur), 6);
}

/** The cost or proceeds in USD for the summary line, or null while it cannot be known. */
export function usdTotal(entry: TransactionEntry): number | null {
  const total = positive(entry.total);
  if (total === null) return null;
  if (!needsRate(entry.currency)) return Number(total);
  const rate = positive(entry.rate);
  return rate === null ? null : Number(total) / Number(rate);
}

export type EntryProblem = 'instrument' | 'amount' | 'date' | 'time' | 'total' | 'rate' | 'fee';

export function problems(entry: TransactionEntry, today: string): Set<EntryProblem> {
  const found = new Set<EntryProblem>();
  if (!entry.instrumentId) found.add('instrument');
  if (positive(entry.amount) === null) found.add('amount');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date > today) found.add('date');
  if (entry.time && !/^\d{2}:\d{2}$/.test(entry.time)) found.add('time');
  if (positive(entry.total) === null) found.add('total');
  if (needsRate(entry.currency) && positive(entry.rate) === null) found.add('rate');
  if (entry.fee && decimal(entry.fee) === null) found.add('fee');
  return found;
}

/**
 * The trade as the server takes it. RUB and EUR amounts go as paid; the server converts them
 * at the Bank of Russia rate of the date unless the owner changed the rate. USDT and USDC count
 * one to one with USD.
 */
export function tradeFromEntry(
  entry: TransactionEntry,
  identity: { requestId: string; expectedJournalRevision: number },
): TradeCommand {
  const gross = decimal(entry.total)!;
  const fee = entry.fee ? decimal(entry.fee)! : '0';
  const trade = {
    instrumentId: entry.instrumentId,
    side: entry.side,
    occurredAt: `${entry.date}T${entry.time || '00:00'}:00.000Z`,
    orderWithinTimestamp: 0,
    quantity: decimal(entry.amount)!,
    ...identity,
  };
  if (!needsRate(entry.currency)) return { ...trade, grossUsd: gross, feeUsd: fee };
  return {
    ...trade,
    paid: {
      currency: entry.currency,
      gross,
      fee,
      ...(entry.rateEdited ? { perUsd: decimal(entry.rate)! } : {}),
    },
  };
}
