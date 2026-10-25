import type { PriceSource } from '@api/portfolio-assets.api';
import type { AccountingCurrency, AssetValuation } from '@api/portfolio-valuation.api';

// Display only: exact decimal strings are rounded here and nowhere else (PV-5), and always down,
// so a figure is never shown above the real one and a loss never smaller. The sign is added apart.
const number = (value: string, minimum: number, maximum: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
    roundingMode: 'floor',
    signDisplay: 'never',
  }).format(value as Intl.StringNumericLiteral);

/**
 * The sign of a figure as shown: one that rounds to zero at the digits shown ("0.00") has none,
 * so a sub-cent loss is not "-$0.00" (portfolio-12).
 */
const sign = (value: string, signed: boolean, shown: string) => {
  if (!/[1-9]/.test(shown)) return '';
  return value.startsWith('-') ? '-' : signed ? '+' : '';
};

export const DASH = '—';

export const currencySymbols: Record<AccountingCurrency, string> = {
  USD: '$',
  EUR: '€',
  RUB: '₽',
};

/**
 * How a ruble sum is rounded (owner decision, 2026-10-15: whole rubles):
 * what the owner has rounds down, what is lost or missing rounds up, and an entered amount
 * is shown as entered, with its kopecks when it has any.
 */
export type Rounding = 'down' | 'up' | 'exact';

/** A formatted number with its currency sign before it: "-$1,234.56", "-₽1,234". */
export const withSymbol = (mark: string, shown: string, currency: AccountingCurrency) =>
  `${mark}${currencySymbols[currency]}${shown}`;

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+$)/g, ',');

/**
 * A ruble sum from its exact decimal string, without a floating-point number: whole rubles
 * rounded as asked, and kopecks under one ruble so that a sum never reads as nothing.
 */
export function rubles(value: string, signed: boolean, rounding: Rounding): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const negative = match[1] === '-';
  const fraction = match[3] ?? '';
  const kopecks = BigInt(match[2] + fraction.padEnd(2, '0').slice(0, 2));
  const finer = /[1-9]/.test(fraction.slice(2));
  // Rounding a negative sum down makes it larger, so the direction flips with the sign. An entered
  // amount is cut past the kopeck like what the owner has: never rounded up.
  const outward = rounding === 'up' ? !negative : negative;
  const step = (units: bigint, rest: boolean) => (outward && rest ? units + 1n : units);
  const cents = step(kopecks, finer);
  const whole = rounding === 'exact' || cents < 100n ? cents % 100n === 0n : true;
  let shown: string;
  // A sum that rounds to under one kopeck is shown as nothing, without a sign; a sub-kopeck loss
  // is a kopeck (portfolio-12).
  if (cents === 0n) shown = '0';
  else if (!whole)
    shown = `${group((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, '0')}`;
  else shown = group(step(kopecks / 100n, kopecks % 100n !== 0n || finer).toString());
  return withSymbol(sign(match[1] + shown, signed, shown), shown, 'RUB');
}

/**
 * $1,234.56, €920.00 or ₽104,500; signed adds "+" to gains. Missing is a dash, never 0.
 * Rubles are whole and rounded as `rounding` says; dollars and euros keep their cents.
 */
export function money(
  value: string | null,
  currency: AccountingCurrency,
  signed = false,
  rounding: Rounding = 'down',
): string {
  if (value === null) return DASH;
  if (currency === 'RUB') {
    const whole = rubles(value, signed, rounding);
    if (whole !== null) return whole;
  }
  // A figure that is not a plain decimal (scientific notation) goes through the number format.
  const shown = number(value, 2, 2);
  return withSymbol(sign(value, signed, shown), shown, currency);
}

/** Prices below 1 keep up to six decimals; a ruble price keeps its kopecks. */
export function price(value: string | null, currency: AccountingCurrency): string {
  if (value === null) return DASH;
  const shown = number(value, 2, Math.abs(Number(value)) < 1 ? 6 : 2);
  return withSymbol('', shown, currency);
}

/** "1 USD = 95.00 RUB" from a Bank of Russia rate. */
export function rateText(currency: string, rubPerUnit: string): string {
  return `1 ${currency} = ${number(rubPerUnit, 2, 4)} RUB`;
}

const SMALLEST_QUANTITY = 0.00000001;

/** Up to 8 decimals; a held amount too small to show is never displayed as 0. */
export function quantity(value: string): string {
  const amount = Number(value);
  if (amount !== 0 && Math.abs(amount) < SMALLEST_QUANTITY) return '<0.00000001';
  // A negative quantity (more left than the history explains) keeps its minus.
  const shown = number(value, 0, 8);
  return `${sign(value, false, shown)}${shown}`;
}

export function percent(value: string | null, signed = true): string {
  if (value === null) return DASH;
  const shown = number(value, 2, 2);
  return `${sign(value, signed, shown)}${shown}%`;
}

/** The gain or loss colour of an amount or percentage shown with two decimals; none for 0.00. */
export function tone(value: string | null): 'pos' | 'neg' | undefined {
  if (value === null || !/[1-9]/.test(number(value, 2, 2))) return undefined;
  return value.startsWith('-') ? 'neg' : 'pos';
}

export function age(observedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(observedAt)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const sourceNames: Record<string, string> = {
  kraken: 'Kraken',
  coingecko: 'CoinGecko',
  bybit: 'Bybit',
  tbank: 'T-Bank',
};

export const sourceLabels: Record<PriceSource, string> = {
  market: 'Market price',
  manual: 'Manual',
  fixed: 'Fixed',
};

/**
 * BPR-3: whether the price moves on its own (a market price, or a broker's for an asset priced by
 * hand), so it has an age, may be stale and has a daily change, unlike a hand value.
 */
export function quoted(asset: AssetValuation): boolean {
  return (
    asset.priceSource === 'market' ||
    asset.price?.status === 'fresh' ||
    asset.price?.status === 'stale'
  );
}

/** The asset's price source and, for a quoted price, its age ("Market price · 30 min ago"). */
export function priceNote(asset: AssetValuation, now: Date): string {
  const current = asset.price;
  const label =
    asset.priceSource !== 'market' && quoted(asset) && current
      ? sourceName(current.source)
      : sourceLabels[asset.priceSource];
  if (!current?.observedAt || !quoted(asset)) return label;
  const when = age(current.observedAt, now);
  return current.status === 'stale' ? `${label} · stale, ${when}` : `${label} · ${when}`;
}

export function sourceName(source: string): string {
  return sourceNames[source] ?? source;
}

export function missingLabel(asset: AssetValuation): string {
  return asset.missingPrice === 'no-rate' ? 'No rate' : 'No price';
}
