// INFL-INDEX: purchasing power over time. A currency's inflation is kept as the change of its
// consumer price level from the previous month; the level is their running product. The
// factor between two dates says how many units of the currency at the later date buy what one
// unit bought at the earlier one. Ratios of money are not themselves money, so the arithmetic
// is plain floating point; callers round the money they derive.

export type InflationBasis = 'official' | 'personal';

const DAY_MS = 86_400_000;
// A month's level is anchored on its 15th and interpolated linearly between anchors.
const ANCHOR_DAY = 15;
const MONTH_DAYS = 30.4375;
// Months over which the latest known inflation is carried forward to estimate the months the
// statistics office has not published yet.
const TREND_MONTHS = 12;

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const isDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const monthNumber = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
export function monthFromNumber(number: number): string {
  const year = Math.floor(number / 12);
  return `${String(year).padStart(4, '0')}-${String((number % 12) + 1).padStart(2, '0')}`;
}
export const previousMonth = (month: string) => monthFromNumber(monthNumber(month) - 1);
export const nextMonth = (month: string) => monthFromNumber(monthNumber(month) + 1);

const anchorTime = (month: string) =>
  Date.parse(`${month}-${String(ANCHOR_DAY).padStart(2, '0')}T00:00:00Z`);

export interface InflationSeries {
  /** Level of each month with a known change, and of the month before the first change. */
  levels: ReadonlyMap<string, number>;
  /** The month a known level chain starts with; levels before it are not comparable. */
  chainStart: string | null;
  /** The latest month with a known change. */
  last: string | null;
  /** Average monthly change over the latest months, as a fraction; the estimate beyond `last`. */
  trend: number;
  /** Months not published yet and not typed in, estimated at the trend in the chain. */
  estimatedMonths: ReadonlySet<string>;
}

/**
 * Monthly changes in percent by month. `publishedLast` is the latest month the statistics office
 * has published, when known: a later month with no figure of its own is not published yet.
 */
export type MonthlyChanges = ReadonlyMap<string, number> & {
  readonly publishedLast?: string | null;
};

/** Average monthly change over the latest `window` months up to `month`, as a fraction. */
function trendTo(levels: ReadonlyMap<string, number>, month: string, window: number): number {
  if (window === 0) return 0;
  const from = levels.get(monthFromNumber(monthNumber(month) - window)) as number;
  return ((levels.get(month) as number) / from) ** (1 / window) - 1;
}

/**
 * Chains monthly changes (percent from the previous month) into levels. A month not published
 * yet that has no figure typed in, between the latest published month and a later typed one, is
 * estimated at the trend of the months before it, like the months after the latest one. Any
 * other missing month breaks the chain: only the stretch ending at the latest month is
 * comparable.
 */
export function buildSeries(changes: MonthlyChanges): InflationSeries {
  const known = [...changes.keys()].sort();
  const estimatedMonths = new Set<string>();
  if (known.length === 0)
    return { levels: new Map(), chainStart: null, last: null, trend: 0, estimatedMonths };
  const last = known[known.length - 1];
  const published = changes.publishedLast ?? null;
  const unpublished = (month: string) =>
    published !== null && changes.has(published) && month > published;
  // The chain, oldest first: back from the latest month while each month is known or unpublished.
  const months: string[] = [];
  for (let month = last; changes.has(month) || unpublished(month); month = previousMonth(month))
    months.push(month);
  months.reverse();
  const levels = new Map<string, number>();
  const base = previousMonth(months[0]);
  levels.set(base, 1);
  let level = 1;
  months.forEach((month, index) => {
    let change = changes.get(month);
    if (change === undefined) {
      // The chain starts on a known month, so an unpublished one always has months before it.
      change = trendTo(levels, previousMonth(month), Math.min(TREND_MONTHS, index)) * 100;
      estimatedMonths.add(month);
    }
    level *= 1 + change / 100;
    levels.set(month, level);
  });
  return {
    levels,
    chainStart: base,
    last,
    trend: trendTo(levels, last, Math.min(TREND_MONTHS, months.length)),
    estimatedMonths,
  };
}

export interface LevelAt {
  level: number;
  /** True when the date lies beyond the latest published month. */
  estimated: boolean;
}

/** The level on a day, or null before the chain starts (or when no month is known). */
export function levelOn(series: InflationSeries, day: string): LevelAt | null {
  if (series.chainStart === null || series.last === null) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  const lastAnchor = anchorTime(series.last);
  if (time >= lastAnchor) {
    const months = (time - lastAnchor) / DAY_MS / MONTH_DAYS;
    const lastLevel = series.levels.get(series.last) as number;
    return { level: lastLevel * (1 + series.trend) ** months, estimated: time > lastAnchor };
  }
  // The anchor at or before the day, then the one after it.
  const month = day.slice(0, 7);
  const lowerMonth = time >= anchorTime(month) ? month : previousMonth(month);
  const lowerLevel = series.levels.get(lowerMonth);
  const upperLevel = series.levels.get(nextMonth(lowerMonth));
  if (lowerLevel === undefined || upperLevel === undefined) return null;
  const lowerTime = anchorTime(lowerMonth);
  const share = (time - lowerTime) / (anchorTime(nextMonth(lowerMonth)) - lowerTime);
  return { level: lowerLevel + (upperLevel - lowerLevel) * share, estimated: false };
}

export interface InflationFactor {
  /** Units of the currency at `to` that buy what one unit bought at `from`. */
  factor: number;
  /**
   * The span reaches past the latest month, over a month estimated in the chain, or rests on the
   * owner's own rate.
   */
  estimated: boolean;
}

/** Official inflation between two days (`from` not after `to`); null when a level is unknown. */
export function officialFactor(
  series: InflationSeries,
  from: string,
  to: string,
): InflationFactor | null {
  if (from > to) return null;
  const start = levelOn(series, from);
  const end = levelOn(series, to);
  if (!start || !end) return null;
  // A month's change shapes the levels between the anchor before it and its own anchor.
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  const overEstimate = [...series.estimatedMonths].some(
    (month) => anchorTime(previousMonth(month)) < toTime && fromTime < anchorTime(month),
  );
  return {
    factor: end.level / start.level,
    estimated: start.estimated || end.estimated || overEstimate,
  };
}

/** The owner's own annual rate (percent), compounded daily over the span. */
export function personalFactor(
  annualPercent: number,
  from: string,
  to: string,
): InflationFactor | null {
  if (from > to) return null;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  return { factor: (1 + annualPercent / 100) ** (days / 365), estimated: true };
}

/** Inflation over the latest twelve published months in percent; null with less history. */
export function trailingYearPercent(series: InflationSeries): number | null {
  if (series.last === null) return null;
  const from = series.levels.get(monthFromNumber(monthNumber(series.last) - 12));
  const to = series.levels.get(series.last);
  return from === undefined || to === undefined ? null : (to / from - 1) * 100;
}

/**
 * Whether the twelve-month inflation takes in an estimated month (one of the twelve months up to
 * the latest; the month before them is only its base), or null when there is no such figure.
 */
export function trailingYearEstimated(series: InflationSeries): boolean | null {
  if (trailingYearPercent(series) === null) return null;
  const last = monthNumber(series.last as string);
  for (let month = last - 11; month <= last; month++)
    if (series.estimatedMonths.has(monthFromNumber(month))) return true;
  return false;
}

/** A factor as a plain decimal string, never in exponent notation. */
export const formatFactor = (factor: number) => factor.toFixed(10);
