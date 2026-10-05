import { BadRequestException } from '@nestjs/common';
import { FxConverter, type FxRates, moscowDate, rateOn } from '../fx-rates/fx-conversion';
import { canonicalDecimalToAtoms, formatAtoms, MAX_INPUT_ATOMS } from './money';

// CUR-PAID-RUB: a trade paid in rubles or euros keeps the amounts as paid. Its USD amounts
// are derived once, at the Bank of Russia rates of the trade's Moscow date, and stored.
export const paidCurrencies = ['RUB', 'EUR'] as const;
export type PaidCurrency = (typeof paidCurrencies)[number];

/** Amounts as the owner paid or received them; gross is positive, fee nonnegative. */
export interface TradePaymentInput {
  currency: PaidCurrency;
  gross: string;
  fee: string;
}
/** The paid amounts and the rates that gave the trade's stored USD amounts. */
export interface TradePayment extends TradePaymentInput {
  /** The trade's Moscow date; each rate is the latest stored on or before it. */
  rateDate: string;
  rubPerUsd: string;
  /** Rubles per unit of the paid currency; one for RUB. */
  rubPerUnit: string;
}

export const isPaidCurrency = (value: unknown): value is PaidCurrency =>
  typeof value === 'string' && (paidCurrencies as readonly string[]).includes(value);

function bad(): never {
  throw new BadRequestException('Invalid accounting input');
}

/** USD amounts of a paid trade, or null while a needed rate is not stored. */
export function derivePaidAmounts(
  paid: TradePaymentInput,
  rates: FxRates,
  occurredAt: string,
): { grossUsd: string; feeUsd: string; paid: TradePayment } | null {
  const date = moscowDate(occurredAt);
  const usd = rateOn(rates.USD, date);
  const unit = paid.currency === 'RUB' ? { rubPerUnit: '1' } : rateOn(rates[paid.currency], date);
  if (!usd || !unit) return null;
  const fx = new FxConverter(rates, 'USD');
  const gross = fx.convert(canonicalDecimalToAtoms(paid.gross), paid.currency, date)!;
  const fee = fx.convert(canonicalDecimalToAtoms(paid.fee), paid.currency, date)!;
  if (gross <= 0n || gross + fee > MAX_INPUT_ATOMS) return bad();
  return {
    grossUsd: formatAtoms(gross),
    feeUsd: formatAtoms(fee),
    paid: {
      currency: paid.currency,
      gross: paid.gross,
      fee: paid.fee,
      rateDate: date,
      rubPerUsd: usd.rubPerUnit,
      rubPerUnit: unit.rubPerUnit,
    },
  };
}
