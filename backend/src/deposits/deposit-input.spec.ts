import { BadRequestException } from '@nestjs/common';
import { parseDeposit, parseDepositPreview } from './deposit-input';

const requestId = '6f0c2a4e-8a3b-4d6e-9f11-2b7c9d0e1f23';
const term = {
  requestId,
  name: 'Deposit',
  bank: 'Synthetic Bank',
  currency: 'RUB',
  startDate: '2026-07-01',
  endDate: '2027-07-01',
  payout: 'monthly',
  capitalized: true,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ratePercent: '16',
  amount: '100000',
};
const account = {
  ...term,
  kind: 'account',
  endDate: null,
  payout: 'monthly',
  earlyClose: 'keeps-interest',
  ratePercent: null,
};

describe('DEP-ACCOUNT: a savings or current account is entered without a term', () => {
  it('accepts an account with no end date and no rate, which earns nothing', () => {
    expect(parseDeposit(account)).toEqual({
      requestId,
      name: 'Deposit',
      bank: 'Synthetic Bank',
      currency: 'RUB',
      startDate: '2026-07-01',
      endDate: null,
      payout: 'monthly',
      capitalized: true,
      dayBasis: 'actual-365',
      earlyClose: 'keeps-interest',
      kind: 'account',
      ratePercent: null,
      amount: '100000.00',
    });
  });

  it('keeps the rate of an account when one is given, and an account may leave it out', () => {
    expect(parseDeposit({ ...account, ratePercent: '5.25' }).ratePercent).toBe('5.25');
    const { ratePercent: _omitted, ...withoutRate } = account;
    expect(parseDeposit(withoutRate).ratePercent).toBeNull();
  });

  it('reads a deposit without a kind as a term deposit, as before', () => {
    expect(parseDeposit(term).kind).toBe('term-deposit');
  });

  it('refuses an account with an end date, since that makes it a term', () => {
    expect(() => parseDeposit({ ...account, endDate: '2027-07-01' })).toThrow(BadRequestException);
  });

  it('refuses an account that pays out at the end of a term, or quarterly', () => {
    expect(() => parseDeposit({ ...account, payout: 'at-end' })).toThrow(BadRequestException);
    expect(() => parseDeposit({ ...account, payout: 'quarterly' })).toThrow(BadRequestException);
    expect(() => parseDeposit({ ...account, payout: 'daily' })).not.toThrow();
  });

  it('still needs a rate for a term deposit', () => {
    expect(() => parseDeposit({ ...term, ratePercent: null })).toThrow(BadRequestException);
    const { ratePercent: _omitted, ...withoutRate } = term;
    expect(() => parseDeposit(withoutRate)).toThrow(BadRequestException);
  });

  it('applies the same rules to a preview of an account', () => {
    const { requestId: _id, ...preview } = account;
    expect(parseDepositPreview(preview).kind).toBe('account');
    expect(() => parseDepositPreview({ ...preview, endDate: '2027-07-01' })).toThrow(
      BadRequestException,
    );
  });
});
