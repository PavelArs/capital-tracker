import { describe, expect, it } from 'vitest';
import { exactProduct, productDown, sumDecimals } from './decimal';

describe('productDown', () => {
  it('multiplies exactly and cuts the product down to the decimals asked for', () => {
    expect(productDown('1.005', '85053.34', 2)).toBe('85478.6');
    // A float rounds this to …467.82; the exact product is …467.8146.
    expect(productDown('12345678.987654321', '85053.34', 2)).toBe('1050041232467.81');
    expect(productDown('0.00000001', '85053.34', 2)).toBe('0');
    expect(productDown('2', '0.0004', 18)).toBe('0.0008');
  });
});

describe('sumDecimals', () => {
  it('adds decimal strings exactly, past 2^53 and with signs', () => {
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimals(['9007199254740993', '0.01'])).toBe('9007199254740993.01');
    expect(sumDecimals(['-1.5', '+0.25'])).toBe('-1.25');
    expect(sumDecimals(['-0.5', '0.5'])).toBe('0');
    expect(sumDecimals([])).toBe('0');
  });
});

describe('exactProduct', () => {
  it('multiplies exactly and answers only when the product fits the decimals asked for', () => {
    expect(exactProduct('3', '1.11', 2)).toBe('3.33');
    expect(exactProduct('0.01', '100000', 2)).toBe('1000');
    expect(exactProduct('1000', '0.004', 2)).toBe('4');
    expect(exactProduct('9007199254740993', '1.01', 2)).toBe('9097271247288402.93');
    expect(exactProduct('3', '1.115', 2)).toBeNull();
    expect(exactProduct('1000', '0.000012', 2)).toBeNull();
    // Past 30 decimals the parser would cut digits, so it never claims an exact answer.
    expect(exactProduct(`1.${'0'.repeat(30)}1`, '1', 2)).toBeNull();
  });
});
