import { canonicalDecimalToAtoms, formatAtoms } from './money';

/** What a non-USD trade actually paid; amounts are canonical decimals. */
export interface TradePayment {
  currency: string;
  gross: string;
  fee: string;
  /** Units of the paid currency per 1 USD. */
  perUsd: string;
}

const CURRENCY = /^[A-Z][A-Z0-9]{2,9}$/;
const USD_PEGGED = new Set(['USDT', 'USDC']);
const USD_ROUNDING = 10n ** 22n; // 30 - 8 fractional digits

export function isPaidCurrencyCode(value: string): boolean {
  return CURRENCY.test(value);
}

export function peggedRate(currency: string): string | null {
  return USD_PEGGED.has(currency) ? '1' : null;
}

/** paid / perUsd, half up at 8 fractional digits; exact when the rate is 1. */
export function convertPaidToUsd(paid: string, perUsd: string): string {
  const amount = canonicalDecimalToAtoms(paid);
  const rate = canonicalDecimalToAtoms(perUsd);
  if (rate === canonicalDecimalToAtoms('1')) return formatAtoms(amount);
  const eighths = (amount * 10n ** 8n * 2n + rate) / (rate * 2n);
  return formatAtoms(eighths * USD_ROUNDING);
}
