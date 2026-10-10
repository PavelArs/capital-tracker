import { canonicalDecimalToAtoms } from '../accounting/money';

// Owner decision Q1: accounting in USD, EUR and RUB, each at the Bank of Russia rate of
// the operation's date. Adding a currency needs only its rate series (CUR-MORE).
/** The three currencies every screen offers and every snapshot is stored in. */
export const baseCurrencies = ['USD', 'EUR', 'RUB'] as const;
/** Other Bank of Russia currencies; the owner may pick one as the main currency (CUR-MORE). */
export const extraCurrencies = ['GBP', 'CHF', 'CNY', 'JPY', 'KZT', 'TRY', 'AED'] as const;
/** Currencies with a published Bank of Russia rate; RUB is the rates' own unit. */
export const ratedCurrencies = ['USD', 'EUR', ...extraCurrencies] as const;
export type RatedCurrency = (typeof ratedCurrencies)[number];
export const accountingCurrencies = [...baseCurrencies, ...extraCurrencies] as const;
export type AccountingCurrency = (typeof accountingCurrencies)[number];

/**
 * The currencies whose rates are collected and whose snapshots are stored: the three base ones
 * and the extra ones some owner chose as the main currency, so an unused series costs nothing.
 */
export function trackedCurrencies(mains: Iterable<AccountingCurrency>): AccountingCurrency[] {
  const chosen = new Set(mains);
  return accountingCurrencies.filter(
    (currency) => (baseCurrencies as readonly string[]).includes(currency) || chosen.has(currency),
  );
}

/** Whether a read may ask for `asked` when the owner's main currency is `main`. */
export const isTrackedFor = (asked: AccountingCurrency, main: AccountingCurrency) =>
  trackedCurrencies([main]).includes(asked);

/** One official rate: rubles per one unit of the currency, effective on a Moscow date. */
export interface FxRate {
  date: string;
  rubPerUnit: string;
}
/** Each series ascending by date; a currency without a stored rate has no series. */
export type FxRates = Readonly<Partial<Record<RatedCurrency, readonly FxRate[]>>>;

const ATOM_SCALE = 10n ** 30n;
const MOSCOW_OFFSET_MS = 3 * 3_600_000;

export const isAccountingCurrency = (value: unknown): value is AccountingCurrency =>
  typeof value === 'string' && (accountingCurrencies as readonly string[]).includes(value);

/** Bank of Russia rates are set per Moscow calendar date (UTC+3 all year since 2014). */
export function moscowDate(instant: string | Date): string {
  const time = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  return new Date(time + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

/** The latest rate effective on or before the date; weekends and holidays reuse it. */
export function rateOn(series: readonly FxRate[], date: string): FxRate | null {
  let low = 0;
  let high = series.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (series[middle].date <= date) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? null : series[low - 1];
}

/** Longest stretch of days without a Bank of Russia rate (holidays) that a trade may reuse. */
export const MAX_RATE_AGE_DAYS = 15;

/**
 * Like `rateOn`, but null when the latest rate is older than `MAX_RATE_AGE_DAYS`, so a stopped
 * rate collection cannot fix a trade's amount at a weeks-old rate.
 */
export function freshRateOn(series: readonly FxRate[], date: string): FxRate | null {
  const rate = rateOn(series, date);
  if (!rate) return null;
  const age = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${rate.date}T00:00:00Z`)) / 86_400_000;
  return age > MAX_RATE_AGE_DAYS ? null : rate;
}

/** Signed quotient, half away from zero. */
function divide(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/** Converts exact amounts into one accounting currency at the rates of given dates. */
export class FxConverter {
  constructor(
    private readonly rates: FxRates,
    readonly currency: AccountingCurrency,
  ) {}

  /** Rubles per unit at a Moscow date, as scale-30 atoms; RUB is exactly one. */
  private rubPer(currency: AccountingCurrency, date: string): bigint | null {
    if (currency === 'RUB') return ATOM_SCALE;
    const rate = rateOn(this.rates[currency] ?? [], date);
    return rate ? canonicalDecimalToAtoms(rate.rubPerUnit) : null;
  }

  /** Whether an amount in `from` on that date can be stated in this currency. */
  available(from: AccountingCurrency, date: string): boolean {
    return (
      from === this.currency ||
      (this.rubPer(from, date) !== null && this.rubPer(this.currency, date) !== null)
    );
  }

  /** Any fixed-scale amount keeps its scale; the same currency is never rounded. */
  convert(amount: bigint, from: AccountingCurrency, date: string): bigint | null {
    if (from === this.currency) return amount;
    const source = this.rubPer(from, date);
    const target = this.rubPer(this.currency, date);
    if (source === null || target === null) return null;
    return divide(amount * source, target);
  }

  /**
   * The effective rates used for one date, for display next to converted values: USD and EUR
   * always, and the converter's own currency when it is another one.
   */
  ratesOn(date: string): { currency: RatedCurrency; date: string; rubPerUnit: string }[] {
    return ratedCurrencies.flatMap((currency) => {
      if (currency !== 'USD' && currency !== 'EUR' && currency !== this.currency) return [];
      const rate = rateOn(this.rates[currency] ?? [], date);
      return rate ? [{ currency, ...rate }] : [];
    });
  }
}
