import type { TradePayment } from '@api/trades.api';

export const paymentCurrencies = ['USD', 'USDT', 'USDC', 'RUB', 'EUR'] as const;

export function paymentText(payment: TradePayment): string {
  return `Оплачено ${payment.gross} ${payment.currency}, комиссия ${payment.fee} ${payment.currency}, курс ${payment.perUsd} ${payment.currency} за 1 USD`;
}
