import { operationKind } from './tbank-operation-kinds';

describe('BROKER-SYNC: what each T-Bank operation type would become', () => {
  it('names trades, income, fees, taxes and cash movements', () => {
    expect(
      [
        'BUY',
        'BUY_CARD',
        'SELL',
        'BOND_REPAYMENT_FULL',
        'DIVIDEND',
        'COUPON',
        'BROKER_FEE',
        'TRACK_MFEE',
        'DIVIDEND_TAX',
        'TAX',
        'INPUT',
        'INP_MULTI',
        'OUTPUT',
        'OUT_MULTI',
        'INPUT_SECURITIES',
      ].map((name) => operationKind(`OPERATION_TYPE_${name}`)),
    ).toEqual([
      'buy',
      'buy',
      'sell',
      'repayment',
      'income',
      'income',
      'fee',
      'fee',
      'tax',
      'tax',
      'deposit',
      'deposit',
      'withdrawal',
      'withdrawal',
      'transfer',
    ]);
  });

  it('leaves a type it does not know unsupported instead of guessing', () => {
    expect(operationKind('OPERATION_TYPE_UNSPECIFIED')).toBe('unsupported');
    expect(operationKind('OPERATION_TYPE_SOMETHING_NEW')).toBe('unsupported');
    expect(operationKind('BUY')).toBe('unsupported');
    expect(operationKind('unknown')).toBe('unsupported');
  });
});
