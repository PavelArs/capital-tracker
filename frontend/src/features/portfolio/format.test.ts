import { describe, expect, it } from 'vitest';
import { money, percent, price, quantity, rateText, tone } from './format';

describe('portfolio-12 a figure that rounds to zero has no sign and no gain or loss colour', () => {
  it('portfolio-12 shows a sub-cent profit as $0.00, uncoloured', () => {
    for (const value of ['0', '-0', '0.004', '0.000000000000000000000000000001']) {
      expect(money(value, 'USD', true)).toBe('$0.00');
      expect(money(value, 'RUB')).toBe('₽0.00');
      expect(tone(value)).toBeUndefined();
    }
  });

  // Rounded down, a sub-cent loss is a cent: never "$0.00", which is better than the real figure.
  it('portfolio-12 shows a sub-cent loss as a one-cent loss, coloured', () => {
    for (const value of ['-0.004', '-0.000000000000000000000000000001']) {
      expect(money(value, 'USD', true)).toBe('-$0.01');
      expect(money(value, 'RUB')).toBe('-₽0.01');
      expect(tone(value)).toBe('neg');
    }
  });

  it('portfolio-12 shows a percentage that rounds to zero as 0.00%, uncoloured', () => {
    expect(percent('0.004')).toBe('0.00%');
    expect(percent('-0.004')).toBe('-0.01%');
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

describe('a shown figure is never above the real one (AGENTS: round what the owner has down)', () => {
  it('rounds money, prices and rates down, not half up', () => {
    expect(money('999.996', 'USD')).toBe('$999.99');
    expect(money('1234.567', 'USD')).toBe('$1,234.56');
    expect(money('100.995', 'EUR', true)).toBe('+€100.99');
    expect(price('0.1234567', 'USD')).toBe('$0.123456');
    expect(price('80000.009', 'USD')).toBe('$80,000.00');
    expect(rateText('USD', '95.12349')).toBe('1 USD = 95.1234 RUB');
    expect(percent('45.4599')).toBe('+45.45%');
  });

  it('shows a loss no smaller than it is', () => {
    expect(money('-1234.561', 'USD', true)).toBe('-$1,234.57');
    expect(percent('-1.401')).toBe('-1.41%');
  });

  it('rounds quantities down from the exact decimal string, past float precision', () => {
    expect(quantity('0.123456789012345678')).toBe('0.12345678');
    expect(quantity('1000000000.123456789')).toBe('1,000,000,000.12345678');
    expect(quantity('9007199254740993')).toBe('9,007,199,254,740,993');
    expect(quantity('1.999999999')).toBe('1.99999999');
  });
});
