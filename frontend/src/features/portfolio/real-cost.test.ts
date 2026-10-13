import { describe, expect, it } from 'vitest';
import { compareDecimals, inflationAdjustment } from './real-cost';

describe('inflationAdjustment (PF-REAL-EXACT)', () => {
  it('is the exact difference of two cost strings', () => {
    expect(inflationAdjustment('79100', '70000')).toBe('9100');
    expect(inflationAdjustment('100.5', '100.25')).toBe('0.25');
  });

  it('keeps every digit of amounts a float cannot hold', () => {
    const paid = '123456789012345678901234567890123456789012345678';
    const real = '123456789012345678901234567890123456789012345679.5';
    expect(inflationAdjustment(real, paid)).toBe('1.5');
  });

  it('is negative when prices fell, and zero when nothing changed', () => {
    expect(inflationAdjustment('90', '100')).toBe('-10');
    expect(inflationAdjustment('100.00', '100')).toBe('0');
  });
});

describe('compareDecimals (PF-REAL-SORT-EXACT)', () => {
  it('orders signed decimal strings exactly', () => {
    expect(compareDecimals('9007199254740992', '9007199254740993')).toBeLessThan(0);
    expect(compareDecimals('-9007199254740993', '-9007199254740992')).toBeLessThan(0);
    expect(compareDecimals('1.50', '1.5')).toBe(0);
    expect(compareDecimals('-0.1', '0.05')).toBeLessThan(0);
    expect(compareDecimals('10', '9.99')).toBeGreaterThan(0);
  });

  it('still orders anything that is not a plain decimal as numbers', () => {
    expect(compareDecimals('1e3', '999')).toBeGreaterThan(0);
  });
});
