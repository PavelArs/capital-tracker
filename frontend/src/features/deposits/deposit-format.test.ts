import type { Deposit } from '@api/deposits.api';
import { describe, expect, it } from 'vitest';
import { attention, dateText, daysBetween, termText } from './deposit-format';

const deposit = (change: Partial<Deposit> = {}): Deposit => ({
  id: 'd1',
  name: 'Savings A',
  bank: 'Synthetic Bank',
  currency: 'RUB',
  startDate: '2026-07-01',
  endDate: '2026-12-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ratePercent: '12',
  status: 'active',
  closedOn: null,
  principal: '100000.00',
  accrued: '0.00',
  due: '0.00',
  balance: '100000.00',
  values: { USD: null, EUR: null, RUB: '100000.00' },
  nextPayout: null,
  atMaturity: null,
  lastCheck: { checkedOn: '2026-10-01', bankBalance: '1', calculated: '1', difference: '0.00' },
  ...change,
});

describe('deposit text', () => {
  it('writes a calendar date without moving it across time zones', () => {
    expect(dateText('2026-10-01')).toBe('1 Oct 2026');
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
  });

  it('describes the terms in one line', () => {
    expect(termText(deposit())).toBe('12% · interest paid monthly · until 1 Dec 2026');
    expect(
      termText(deposit({ capitalized: true, payout: 'at-end', endDate: null, ratePercent: '4.5' })),
    ).toBe('4.5% · interest added at the end of the term · no end date');
  });
});

describe('attention', () => {
  it('stays quiet for a deposit that is fine', () => {
    expect(attention(deposit(), '2026-10-11')).toBeNull();
    expect(attention(deposit({ status: 'closed' }), '2026-10-11')).toBeNull();
  });

  it('points at a term that is about to end or has ended', () => {
    expect(attention(deposit({ endDate: '2026-10-14' }), '2026-10-11')).toBe('Ends in 3 days');
    expect(attention(deposit({ endDate: '2026-10-11' }), '2026-10-11')).toBe('Ends today');
    expect(attention(deposit({ status: 'matured' }), '2026-12-02')).toMatch(/term has ended/);
  });

  it('asks for a check that was never made or is old', () => {
    expect(attention(deposit({ lastCheck: null }), '2026-10-11')).toBe(
      'Not checked against the bank yet',
    );
    expect(attention(deposit(), '2026-11-15')).toBe('Not checked against the bank for 45 days');
  });
});
