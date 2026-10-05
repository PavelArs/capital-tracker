import { canonicalDecimalToAtoms } from '../accounting/money';

// Owner decision Q1: accounting in USD, EUR and RUB, each at the Bank of Russia rate of
// the operation's date. Adding a currency needs only its rate series.
export const accountingCurrencies = ['USD', 'EUR', 'RUB'] as const;
export type AccountingCurrency = (typeof accountingCurrencies)[number];
/** Currencies with a published Bank of Russia rate; RUB is the rates' own unit. */
export const ratedCurrencies = ['USD', 'EUR'] as const;
export type RatedCurrency = (typeof ratedCurrencies)[number];

/** One official rate: rubles per one unit of the currency, effective on a Moscow date. */
export interface FxRate {
  date: string;
  rubPerUnit: string;
}
/** Each series ascending by date. */
export type FxRates = Readonly<Record<RatedCurrency, readonly FxRate[]>>;

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
    const rate = rateOn(this.rates[currency], date);
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

  /** The effective rates used for one date, for display next to converted values. */
  ratesOn(date: string): { currency: RatedCurrency; date: string; rubPerUnit: string }[] {
    return ratedCurrencies.flatMap((currency) => {
      const rate = rateOn(this.rates[currency], date);
      return rate ? [{ currency, ...rate }] : [];
    });
  }
}
