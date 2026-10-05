import { BadRequestException } from '@nestjs/common';
import { FxConverter, type FxRates, moscowDate, rateOn } from '../fx-rates/fx-conversion';
import { canonicalDecimalToAtoms, formatAtoms, MAX_INPUT_ATOMS } from './money';

// CUR-PAID-RUB: a trade paid in rubles or euros keeps the amounts as paid. Its USD amounts
// are derived once and stored: at the Bank of Russia rates of the trade's Moscow date, or at
// the rate the owner actually paid when they enter one.
export const paidCurrencies = ['RUB', 'EUR'] as const;
export type PaidCurrency = (typeof paidCurrencies)[number];

export const rateSources = ['bank-of-russia', 'owner'] as const;
export type RateSource = (typeof rateSources)[number];

/** Amounts as the owner paid or received them; gross is positive, fee nonnegative. */
export interface TradePaymentInput {
  currency: PaidCurrency;
  gross: string;
  fee: string;
  /** Units of the paid currency per 1 USD as actually paid; omitted means the Bank of Russia rate. */
  perUsd?: string;
}
/** The paid amounts and the rate that gave the trade's stored USD amounts. */
export interface TradePayment {
  currency: PaidCurrency;
  gross: string;
  fee: string;
  /** The trade's Moscow date; a Bank of Russia rate is the latest stored on or before it. */
  rateDate: string;
  /** Units of the paid currency per 1 USD; a Bank of Russia cross rate is rounded at 30 places. */
  perUsd: string;
  rateSource: RateSource;
}

export const isRateSource = (value: unknown): value is RateSource =>
  typeof value === 'string' && (rateSources as readonly string[]).includes(value);

export const isPaidCurrency = (value: unknown): value is PaidCurrency =>
  typeof value === 'string' && (paidCurrencies as readonly string[]).includes(value);

function bad(): never {
  throw new BadRequestException('Invalid accounting input');
}

const ATOM_SCALE = 10n ** 30n;
/** Positive quotient at scale 30, half away from zero. */
const quotient = (numerator: bigint, denominator: bigint) =>
  (numerator * ATOM_SCALE * 2n + denominator) / (denominator * 2n);

/** USD amounts of a paid trade, or null while a needed Bank of Russia rate is not stored. */
export function derivePaidAmounts(
  paid: TradePaymentInput,
  rates: FxRates,
  occurredAt: string,
): { grossUsd: string; feeUsd: string; paid: TradePayment } | null {
  const date = moscowDate(occurredAt);
  const grossPaid = canonicalDecimalToAtoms(paid.gross);
  const feePaid = canonicalDecimalToAtoms(paid.fee);
  let gross: bigint;
  let fee: bigint;
  let perUsd: string;
  if (paid.perUsd !== undefined) {
    // The owner's own rate: USD = paid / (paid units per USD).
    const rate = canonicalDecimalToAtoms(paid.perUsd);
    if (rate <= 0n) return bad();
    gross = quotient(grossPaid, rate);
    fee = quotient(feePaid, rate);
    perUsd = paid.perUsd;
  } else {
    const usd = rateOn(rates.USD, date);
    const unit = paid.currency === 'RUB' ? { rubPerUnit: '1' } : rateOn(rates[paid.currency], date);
    if (!usd || !unit) return null;
    const fx = new FxConverter(rates, 'USD');
    gross = fx.convert(grossPaid, paid.currency, date)!;
    fee = fx.convert(feePaid, paid.currency, date)!;
    perUsd = formatAtoms(
      quotient(canonicalDecimalToAtoms(usd.rubPerUnit), canonicalDecimalToAtoms(unit.rubPerUnit)),
    );
  }
  if (gross <= 0n || gross + fee > MAX_INPUT_ATOMS) return bad();
  return {
    grossUsd: formatAtoms(gross),
    feeUsd: formatAtoms(fee),
    paid: {
      currency: paid.currency,
      gross: paid.gross,
      fee: paid.fee,
      rateDate: date,
      perUsd,
      rateSource: paid.perUsd === undefined ? 'bank-of-russia' : 'owner',
    },
  };
}
