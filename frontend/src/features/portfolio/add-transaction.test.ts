import { describe, expect, it } from 'vitest';
import { ambiguousComma, decimal, numberProblem } from './add-transaction';

describe('NUM-COMMA a comma is a decimal point unless it could be a thousands separator', () => {
  it('reads a comma followed by one, two or four digits as a decimal point', () => {
    expect(decimal('1,5')).toBe('1.5');
    expect(decimal('0,25')).toBe('0.25');
    expect(decimal('1 000,50')).toBe('1000.50');
    expect(decimal('1,2345')).toBe('1.2345');
  });

  it('keeps reading a leading zero before a comma and three digits as a decimal', () => {
    expect(decimal('0,125')).toBe('0.125');
  });

  it('refuses "1,500" instead of saving 1.5', () => {
    for (const text of ['1,500', '12,345', '999,999', ' 1,500 ']) {
      expect(ambiguousComma(text)).toBe(true);
      expect(decimal(text)).toBeNull();
    }
  });

  it('leaves plain numbers and the other separators as they were', () => {
    expect(decimal('1500')).toBe('1500');
    expect(decimal('1.500')).toBe('1.500');
    expect(decimal('1,500.25')).toBeNull();
    expect(decimal('')).toBeNull();
  });

  it('words the refusal for the comma case only', () => {
    expect(numberProblem('1,500', 'Enter an amount greater than 0')).toBe(
      'Write it without a comma between thousands: 1500, or 1.5',
    );
    expect(numberProblem('abc', 'Enter an amount greater than 0')).toBe(
      'Enter an amount greater than 0',
    );
  });
});
