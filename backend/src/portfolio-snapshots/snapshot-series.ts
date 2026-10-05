import { formatPercent, formatSignedProduct } from '../accounting/money';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
// Owner decision Q4: the chart history starts on 1 January 2025.
export const HISTORY_FROM_MS = Date.parse('2025-01-01T00:00:00.000Z');
// Hourly points serve the 24H and 7D periods; older history is daily.
export const HOURLY_WINDOW_MS = 8 * DAY_MS;

export const historyPeriods = ['24H', '7D', '1M', '3M', '1Y', 'ALL'] as const;
export type HistoryPeriod = (typeof historyPeriods)[number];
export const DEFAULT_PERIOD: HistoryPeriod = '1M';
const PERIOD_MS: Record<Exclude<HistoryPeriod, 'ALL'>, number> = {
  '24H': DAY_MS,
  '7D': 7 * DAY_MS,
  '1M': 30 * DAY_MS,
  '3M': 91 * DAY_MS,
  '1Y': 365 * DAY_MS,
};

export interface PricePoint {
  at: number;
  price: string;
  source: string;
}
export interface SnapshotValue {
  at: number;
  currency: string;
  /** Exact sum of priced holdings; null when the currency has no rate at that instant. */
  value: string | null;
  complete: boolean;
}

export const hourStart = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS;
export const snapshotKey = (at: number, currency: string) => `${at}:${currency}`;

/**
 * Every instant the cache holds at `now`: each UTC midnight since 1 January 2025 and each
 * whole hour of the last 8 days, counted from the hour snapshots began.
 */
export function seriesInstants(now: number, hourlyFrom: number): number[] {
  const instants = new Set<number>();
  for (let day = HISTORY_FROM_MS; day <= now; day += DAY_MS) instants.add(day);
  const latest = hourStart(now);
  const earliest = Math.max(hourStart(hourlyFrom), latest - HOURLY_WINDOW_MS + HOUR_MS);
  for (let hour = earliest; hour <= latest; hour += HOUR_MS) instants.add(hour);
  return [...instants].sort((left, right) => left - right);
}

export function periodStart(period: HistoryPeriod, now: number) {
  if (period === 'ALL') return { from: HISTORY_FROM_MS, hourly: false };
  return { from: now - PERIOD_MS[period], hourly: period === '24H' || period === '7D' };
}

/** The stored points a chart period shows: hourly for 24H and 7D, otherwise midnights. */
export function periodPoints<T extends { at: number }>(
  rows: readonly T[],
  period: HistoryPeriod,
  now: number,
): T[] {
  const { from, hourly } = periodStart(period, now);
  return rows
    .filter((row) => row.at >= from && row.at <= now && (hourly || row.at % DAY_MS === 0))
    .sort((left, right) => left.at - right.at);
}

/** The latest entry at or before the instant in an ascending series. */
export function latestAtOrBefore<T extends { at: number }>(
  series: readonly T[],
  at: number,
): T | undefined {
  let low = 0;
  let high = series.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (series[middle].at <= at) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? undefined : series[low - 1];
}

/**
 * Stored market prices per asset, ascending. At one instant the same order as the live
 * valuation (prices/market-price.store.ts) wins: spot, then hourly, then daily close, then
 * the provider name.
 */
export function marketSeries(
  rows: readonly {
    asset: string;
    observedAt: number;
    price: string;
    source: string;
    kind: string;
  }[],
): Map<string, PricePoint[]> {
  const ordered = [...rows].sort(
    (left, right) =>
      left.asset.localeCompare(right.asset) ||
      left.observedAt - right.observedAt ||
      (left.kind < right.kind ? 1 : left.kind > right.kind ? -1 : 0) ||
      (left.source < right.source ? -1 : left.source > right.source ? 1 : 0),
  );
  const series = new Map<string, PricePoint[]>();
  for (const row of ordered) {
    const points = series.get(row.asset) ?? [];
    if (points.at(-1)?.at === row.observedAt) continue;
    points.push({ at: row.observedAt, price: row.price, source: row.source });
    series.set(row.asset, points);
  }
  return series;
}

/** Manual price points per instrument: each point's latest revision, voided points dropped. */
export function manualSeries(
  rows: readonly {
    instrumentId: string;
    observedAt: number;
    revision: number;
    kind: 'set' | 'void';
    priceUsd: string | null;
  }[],
): Map<string, PricePoint[]> {
  const current = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.instrumentId}:${row.observedAt}`;
    const known = current.get(key);
    if (!known || known.revision < row.revision) current.set(key, row);
  }
  const series = new Map<string, PricePoint[]>();
  for (const row of [...current.values()].sort(
    (left, right) => left.observedAt - right.observedAt,
  )) {
    if (row.kind !== 'set' || row.priceUsd === null) continue;
    const points = series.get(row.instrumentId) ?? [];
    points.push({ at: row.observedAt, price: row.priceUsd, source: 'manual' });
    series.set(row.instrumentId, points);
  }
  return series;
}

/** A Bank of Russia rate applies from midnight of its Moscow date (UTC+3). */
export const rateDateStart = (date: string) => Date.parse(`${date}T00:00:00+03:00`);

/** Decimal text without trailing fractional zeros, as numeric text may carry them. */
export function canonicalValue(value: string | null): string | null {
  if (value === null || !value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/** The computed snapshots that differ from the stored ones; equal rows are left untouched. */
export function snapshotChanges(
  existing: ReadonlyMap<string, { value: string | null; complete: boolean }>,
  computed: readonly SnapshotValue[],
): SnapshotValue[] {
  return computed.filter((row) => {
    const stored = existing.get(snapshotKey(row.at, row.currency));
    return (
      !stored ||
      stored.complete !== row.complete ||
      canonicalValue(stored.value) !== canonicalValue(row.value)
    );
  });
}

const SCALE = 60;
/** Nonnegative or signed decimal text as an exact scale-60 integer. */
export function valueAtoms(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const magnitude = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -magnitude : magnitude;
}

/** Change between the period's first and last value; no percentage from a zero start. */
export function periodChange(start: string | null, end: string | null) {
  if (start === null || end === null) return { change: null, changePercent: null };
  const from = valueAtoms(start);
  const change = valueAtoms(end) - from;
  return {
    change: formatSignedProduct(change),
    changePercent: from > 0n ? formatPercent(change, from) : null,
  };
}
