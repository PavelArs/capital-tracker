import type { PriceSource } from '@api/portfolio-assets.api';
import type { AccountingCurrency, AssetValuation } from '@api/portfolio-valuation.api';

// Display only: exact decimal strings are rounded here and nowhere else (PV-5).
const number = (value: string, minimum: number, maximum: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
  }).format(Math.abs(Number(value)));

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

/** $1,234.56, €920.00 or ₽104,500.00; signed adds "+" to gains. Missing is a dash, never 0. */
export function money(value: string | null, currency: AccountingCurrency, signed = false): string {
  if (value === null) return DASH;
  const shown = number(value, 2, 2);
  return `${sign(value, signed, shown)}${currencySymbols[currency]}${shown}`;
}

/** Prices below 1 keep up to six decimals. */
export function price(value: string | null, currency: AccountingCurrency): string {
  if (value === null) return DASH;
  return `${currencySymbols[currency]}${number(value, 2, Math.abs(Number(value)) < 1 ? 6 : 2)}`;
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
};

export const sourceLabels: Record<PriceSource, string> = {
  market: 'Market price',
  manual: 'Manual',
  fixed: 'Fixed',
};

/** The asset's price source and, for market prices, their age ("Market price · 30 min ago"). */
export function priceNote(asset: AssetValuation, now: Date): string {
  const label = sourceLabels[asset.priceSource];
  const current = asset.price;
  if (!current?.observedAt || asset.priceSource !== 'market') return label;
  const when = age(current.observedAt, now);
  return current.status === 'stale' ? `${label} · stale, ${when}` : `${label} · ${when}`;
}

export function sourceName(source: string): string {
  return sourceNames[source] ?? source;
}

export function missingLabel(asset: AssetValuation): string {
  return asset.missingPrice === 'no-rate' ? 'No rate' : 'No price';
}
