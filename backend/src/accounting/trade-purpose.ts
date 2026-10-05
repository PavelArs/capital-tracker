/**
 * What a trade-journal entry stands for when it is not a purchase or sale (M9, PR-OPS-2). The
 * journal keeps the asset side as a buy or a sale; the purpose names it and fixes its money:
 * - income and gift-received bring the asset in at its value, a deposit;
 * - expense and gift-sent take it out at its value, a withdrawal;
 * - fee spends it for nothing, so its value is all fee and no money leaves (PR-OPS-6).
 */
export const tradePurposes = ['income', 'expense', 'gift-received', 'gift-sent', 'fee'] as const;
export type TradePurpose = (typeof tradePurposes)[number];

export const purposeSide: Record<TradePurpose, 'buy' | 'sell'> = {
  income: 'buy',
  'gift-received': 'buy',
  expense: 'sell',
  'gift-sent': 'sell',
  fee: 'sell',
};

export function isTradePurpose(value: unknown): value is TradePurpose {
  return tradePurposes.some((purpose) => purpose === value);
}
