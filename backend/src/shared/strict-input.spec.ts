import { strictInteger, strictRecord } from './strict-input';

describe('INPUT-STRICT-HELPER: strictRecord', () => {
  it('returns the same object when every key is allowed and required keys are defined', () => {
    const body = { a: 1 };
    expect(strictRecord(body, ['a', 'b'], ['a'])).toBe(body);
  });

  it('treats a required key set to undefined as missing', () => {
    expect(strictRecord({ a: undefined }, ['a'], ['a'])).toBeUndefined();
  });

  it.each([
    ['a string', 'a'],
    ['a number', 1],
    ['a date', new Date(0)],
    ['a map', new Map()],
  ])('rejects %s', (_, raw) => {
    expect(strictRecord(raw, ['a'])).toBeUndefined();
  });
});

describe('INPUT-STRICT-HELPER: strictInteger', () => {
  it('reads -0 as 0 and keeps both bounds inclusive', () => {
    expect(Object.is(strictInteger(-0, 0, 10), 0)).toBe(true);
    expect(strictInteger(10, 0, 10)).toBe(10);
  });

  it.each([
    ['below the minimum', -1],
    ['above the maximum', 11],
    ['a fraction', 1.5],
    ['a numeric string', '1'],
    ['NaN', Number.NaN],
  ])('rejects %s', (_, raw) => {
    expect(strictInteger(raw, 0, 10)).toBeUndefined();
  });

  it('rejects an unsafe integer even within the bounds', () => {
    expect(strictInteger(2 ** 53, 0, Number.MAX_VALUE)).toBeUndefined();
  });
});
