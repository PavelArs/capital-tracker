import { describe, expect, it } from 'vitest';
import { inflationAdjustment } from './real-cost';

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
