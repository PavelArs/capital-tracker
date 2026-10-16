import { describe, expect, it } from 'vitest';
import { compareDecimals } from './real-cost';

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
