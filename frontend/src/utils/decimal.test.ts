import { describe, expect, it } from 'vitest';
import { sumDecimals } from './decimal';

describe('sumDecimals', () => {
  it('adds decimal strings exactly, past 2^53 and with signs', () => {
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimals(['9007199254740993', '0.01'])).toBe('9007199254740993.01');
    expect(sumDecimals(['-1.5', '+0.25'])).toBe('-1.25');
    expect(sumDecimals(['-0.5', '0.5'])).toBe('0');
    expect(sumDecimals([])).toBe('0');
  });
});
