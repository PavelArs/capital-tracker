// BROKER-SYNC: what each T-Bank operation type means for the owner's records, from the public
// OperationType list of the T-Invest contract. A type not listed here is shown as unsupported,
// never guessed.

/** What an operation would become in the records; `unsupported` is listed, not recorded. */
export type OperationKind =
  | 'buy'
  | 'sell'
  | 'repayment'
  | 'income'
  | 'fee'
  | 'tax'
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'unsupported';

const types: Record<Exclude<OperationKind, 'unsupported'>, string[]> = {
  buy: ['BUY', 'BUY_CARD', 'BUY_MARGIN', 'DELIVERY_BUY'],
  sell: ['SELL', 'SELL_CARD', 'SELL_MARGIN', 'DELIVERY_SELL'],
  // A bond paid back at its face value, in part or in full.
  repayment: ['BOND_REPAYMENT', 'BOND_REPAYMENT_FULL'],
  income: ['DIVIDEND', 'COUPON', 'DIV_EXT', 'OVERNIGHT', 'OVER_INCOME'],
  fee: [
    'BROKER_FEE',
    'SERVICE_FEE',
    'MARGIN_FEE',
    'SUCCESS_FEE',
    'TRACK_MFEE',
    'TRACK_PFEE',
    'CASH_FEE',
    'OUT_FEE',
    'OUT_STAMP_DUTY',
    'OUTPUT_PENALTY',
    'ADVICE_FEE',
    'OVER_COM',
  ],
  // Withheld or refunded tax; a refund or correction carries a positive payment.
  tax: [
    'TAX',
    'BOND_TAX',
    'DIVIDEND_TAX',
    'BENEFIT_TAX',
    'TAX_CORRECTION',
    'TAX_CORRECTION_COUPON',
    'TAX_PROGRESSIVE',
    'BOND_TAX_PROGRESSIVE',
    'DIVIDEND_TAX_PROGRESSIVE',
    'BENEFIT_TAX_PROGRESSIVE',
    'TAX_CORRECTION_PROGRESSIVE',
    'TAX_REPO',
    'TAX_REPO_HOLD',
    'TAX_REPO_REFUND',
    'TAX_REPO_PROGRESSIVE',
    'TAX_REPO_HOLD_PROGRESSIVE',
    'TAX_REPO_REFUND_PROGRESSIVE',
  ],
  deposit: ['INPUT', 'INPUT_SWIFT', 'INPUT_ACQUIRING', 'INP_MULTI'],
  withdrawal: ['OUTPUT', 'OUTPUT_SWIFT', 'OUTPUT_ACQUIRING', 'OUT_MULTI'],
  // Securities moved in or out without a sale: their cost comes from elsewhere.
  transfer: ['INPUT_SECURITIES', 'OUTPUT_SECURITIES', 'TRANS_IIS_BS', 'TRANS_BS_BS'],
};

const byType = new Map<string, OperationKind>(
  Object.entries(types).flatMap(([kind, names]) =>
    names.map((name) => [`OPERATION_TYPE_${name}`, kind as OperationKind] as const),
  ),
);

export const operationKind = (type: string): OperationKind => byType.get(type) ?? 'unsupported';
