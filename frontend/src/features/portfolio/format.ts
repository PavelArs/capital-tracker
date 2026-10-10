import type { PriceSource } from '@api/portfolio-assets.api';
import type { AccountingCurrency, AssetValuation } from '@api/portfolio-valuation.api';

// Display only: exact decimal strings are rounded here and nowhere else (PV-5).
const number = (value: string, minimum: number, maximum: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
  }).format(Math.abs(Number(value)));

const sign = (value: string, signed: boolean) => {
  const negative = value.startsWith('-') && Number(value) !== 0;
  return negative ? '-' : signed && Number(value) > 0 ? '+' : '';
};

export const DASH = '—';

export const currencySymbols: Record<AccountingCurrency, string> = {
  USD: '$',
  EUR: '€',
  RUB: '₽',
  GBP: '£',
  CHF: 'CHF ',
  CNY: 'CN¥',
  JPY: 'JP¥',
  KZT: '₸',
  TRY: '₺',
  AED: 'AED ',
};

/** $1,234.56, €920.00, ₽104,500.00 or £88.10; signed adds "+" to gains. Missing is a dash, never 0. */
export function money(value: string | null, currency: AccountingCurrency, signed = false): string {
  if (value === null) return DASH;
  return `${sign(value, signed)}${currencySymbols[currency]}${number(value, 2, 2)}`;
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
  return `${sign(value, false)}${number(value, 0, 8)}`;
}

export function percent(value: string | null, signed = true): string {
  if (value === null) return DASH;
  return `${sign(value, signed)}${number(value, 2, 2)}%`;
}

export function tone(value: string | null): 'pos' | 'neg' | undefined {
  if (value === null || Number(value) === 0) return undefined;
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
