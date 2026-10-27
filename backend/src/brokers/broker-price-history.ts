import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import type { FifoSplit } from '../accounting/share-split-types';
import { type BrokerPrice, priceCurrencies } from './broker-prices';
import type { TBankCloses } from './tbank-client';

/** BPH-FETCH: past prices are read from the first day the portfolio history shows. */
export const PRICE_HISTORY_FROM = '2025-01-01';

/** BPH-CLOSE: a day's close values the last millisecond of its Moscow day. */
export const closeInstant = (date: string) => new Date(`${date}T23:59:59.999+03:00`);

const ONE = canonicalDecimalToAtoms('1');

/**
 * BPH-CLOSE: each positive close as a price at the end of its day. A close in percent ('pt.')
 * needs the bond's unchanging nominal; without it, or in another currency, nothing is kept.
 * BPH-SPLIT: T-Bank gives past candles in today's units, and the valuation divides a price by
 * the splits after it, so a close before a split is put back in the units of its day.
 */
export function closeObservations(
  instrumentId: string,
  history: TBankCloses,
  nominal: { amount: string; currency: string } | null,
  splits: readonly FifoSplit[],
): (BrokerPrice & { observedAt: Date })[] {
  const percent = history.currency === 'pt.';
  const currency = priceCurrencies[percent ? (nominal?.currency ?? '') : history.currency];
  if (!currency || (percent && !nominal)) return [];
  const rows: (BrokerPrice & { observedAt: Date })[] = [];
  for (const { date, close } of history.closes) {
    let atoms = canonicalDecimalToAtoms(close.replace(/^-/, ''));
    if (close.startsWith('-') || atoms === 0n) continue;
    // Both parts carry at most nine decimals, so the division is exact.
    if (nominal) atoms = (atoms * canonicalDecimalToAtoms(nominal.amount)) / (100n * ONE);
    const observedAt = closeInstant(date);
    for (const split of splits)
      if (
        split.instrumentId === instrumentId &&
        Date.parse(split.effectiveAt) > observedAt.getTime()
      )
        atoms *= BigInt(split.ratio);
    rows.push({ instrumentId, price: formatAtoms(atoms), currency, observedAt });
  }
  return rows;
}
