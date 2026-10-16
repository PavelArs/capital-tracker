import { describe, expect, it } from 'vitest';
import { money, percent, tone } from './format';

describe('portfolio-12 a figure that rounds to zero has no sign and no gain or loss colour', () => {
  it('portfolio-12 shows a sub-cent profit or loss as $0.00, uncoloured', () => {
    for (const value of ['0', '-0', '-0.004', '0.004', '-0.000000000000000000000000000001']) {
      expect(money(value, 'USD', true)).toBe('$0.00');
      expect(money(value, 'RUB')).toBe('₽0.00');
      expect(tone(value)).toBeUndefined();
    }
  });

  it('portfolio-12 shows a percentage that rounds to zero as 0.00%, uncoloured', () => {
    expect(percent('-0.004')).toBe('0.00%');
    expect(percent('0.004')).toBe('0.00%');
  });

  it('portfolio-12 keeps the sign and colour of anything that shows a cent', () => {
    expect(money('-0.01', 'USD', true)).toBe('-$0.01');
    expect(tone('-0.01')).toBe('neg');
    expect(money('0.01', 'USD', true)).toBe('+$0.01');
    expect(tone('0.01')).toBe('pos');
    expect(money('-1234.5', 'EUR')).toBe('-€1,234.50');
    expect(percent('-1.40')).toBe('-1.40%');
    expect(tone(null)).toBeUndefined();
  });
});
