import { describe, expect, it } from 'vitest';
import { money, percent, price, tone } from './format';

describe('portfolio-12 a figure that rounds to zero has no sign and no gain or loss colour', () => {
  it('portfolio-12 shows a sub-cent profit or loss as $0.00, uncoloured', () => {
    for (const value of ['0', '-0', '-0.004', '0.004', '-0.000000000000000000000000000001']) {
      expect(money(value, 'USD', true)).toBe('$0.00');
      expect(money(value, 'RUB')).toBe('₽0');
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

// Owner decision (2026-10-15): rubles are whole, rounded down, with ₽ before the number as the
// other currencies have it, so the figures line up when the currency switches; entered amounts
// are shown as entered.
const rub = (text: string) => text.replace(/^([+-]?)/, '$1₽');

describe('RUB-WHOLE rubles are whole, with the sign before the currency mark', () => {
  it('RUB-WHOLE rounds what the owner has down to the ruble', () => {
    expect(money('3522777.99', 'RUB')).toBe(rub('3,522,777'));
    expect(money('100999999999998.99', 'RUB')).toBe(rub('100,999,999,999,998'));
    expect(money('1234.5', 'RUB', true)).toBe(rub('+1,234'));
    // A loss rounds down too, so it never reads smaller than it is.
    expect(money('-1234.01', 'RUB', true)).toBe(rub('-1,235'));
    expect(money('-1234', 'RUB')).toBe(rub('-1,234'));
    expect(money(null, 'RUB')).toBe('—');
  });

  it('RUB-WHOLE keeps kopecks under one ruble, so a sum never reads as nothing', () => {
    expect(money('0.43', 'RUB')).toBe(rub('0.43'));
    expect(money('0.439', 'RUB')).toBe(rub('0.43'));
    expect(money('-0.431', 'RUB', true)).toBe(rub('-0.44'));
  });

  it('RUB-WHOLE rounds what is lost or missing up', () => {
    expect(money('1234.01', 'RUB', false, 'up')).toBe(rub('1,235'));
    expect(money('1234', 'RUB', false, 'up')).toBe(rub('1,234'));
    expect(money('0.431', 'RUB', false, 'up')).toBe(rub('0.44'));
  });

  it('RUB-WHOLE shows an entered amount as entered', () => {
    expect(money('30000.00', 'RUB', false, 'exact')).toBe(rub('30,000'));
    expect(money('30000.5', 'RUB', false, 'exact')).toBe(rub('30,000.50'));
    expect(money('-0.07', 'RUB', true, 'exact')).toBe(rub('-0.07'));
    expect(money('19.999', 'RUB', false, 'exact')).toBe(rub('20'));
    expect(money('0.999', 'RUB', false, 'up')).toBe(rub('1'));
  });

  it('RUB-WHOLE leaves dollars and euros as they were', () => {
    expect(money('1234.5', 'USD', false, 'exact')).toBe('$1,234.50');
    expect(money('1234.567', 'EUR', false, 'up')).toBe('€1,234.57');
  });

  it('RUB-WHOLE writes a price per unit with kopecks and the sign after', () => {
    expect(price('285.4', 'RUB')).toBe(rub('285.40'));
    expect(price('0.5', 'RUB')).toBe(rub('0.50'));
    expect(price('285.4', 'USD')).toBe('$285.40');
  });
});
