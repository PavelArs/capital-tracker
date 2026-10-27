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
 * BPH-SPLIT: T-Bank gives past closes in the units of the day they are read. They are stored as
 * given, and the valuation puts each back in its own day's units through `fetchedAt`.
 */
export function closeObservations(
  instrumentId: string,
  history: TBankCloses,
  nominal: { amount: string; currency: string } | null,
): (BrokerPrice & { observedAt: Date })[] {
  const percent = history.currency === 'pt.';
  const currency = priceCurrencies[percent ? (nominal?.currency ?? '') : history.currency];
  if (!currency || (percent && !nominal)) return [];
  const rows: (BrokerPrice & { observedAt: Date })[] = [];
  for (const { date, close } of history.closes) {
    if (close.startsWith('-')) continue;
    let atoms = canonicalDecimalToAtoms(close);
    if (atoms === 0n) continue;
    // Both parts carry at most nine decimals, so the division is exact.
    if (nominal) atoms = (atoms * canonicalDecimalToAtoms(nominal.amount)) / (100n * ONE);
    rows.push({
      instrumentId,
      price: formatAtoms(atoms),
      currency,
      observedAt: closeInstant(date),
    });
  }
  return rows;
}

/** BPH-SETTLED: how long T-Bank may take to give past candles in the units after a split. */
const SPLIT_SETTLE_MS = 7 * 24 * 60 * 60_000;

/**
 * BPH-SETTLED: the closes safe to store now. A close dated before a split of the last seven days
 * may still be in the units before it, though its row would say it was read after; it waits
 * for a later day's run, when T-Bank has adjusted it.
 */
export function settledCloses<T extends { instrumentId: string; observedAt: Date }>(
  rows: readonly T[],
  splits: readonly FifoSplit[],
  now: Date,
): T[] {
  return rows.filter(
    (row) =>
      !splits.some(
        (split) =>
          split.instrumentId === row.instrumentId &&
          Date.parse(split.effectiveAt) > row.observedAt.getTime() &&
          Date.parse(split.effectiveAt) > now.getTime() - SPLIT_SETTLE_MS,
      ),
  );
}
