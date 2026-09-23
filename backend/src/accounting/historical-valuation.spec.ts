import { BadRequestException } from '@nestjs/common';
import type { HistoricalPosition } from './historical-accounting';
import { projectValuation } from './historical-valuation';
import { parseValuationQuery } from './historical-valuation-input';

const at = '2025-01-04T00:00:00.000Z';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const position = (instrumentId = first, quantity = '0.5'): HistoricalPosition => ({
  instrumentId,
  instrumentName: '<img src=x onerror=alert(1)>',
  instrumentSymbol: 'SAME',
  quantity,
  costUsd: '100',
});
const price = (instrumentId = first, priceUsd = '300', revision = 1) => ({
  instrumentId,
  priceUsd,
  observedAt: at,
  revision,
});

describe('VAL-EXACT/PRECISION/GAPS exact derived valuation', () => {
  it('values half a token and traces the exact price receipt without mutating input', () => {
    const positions = Object.freeze([Object.freeze(position())]);
    const prices = Object.freeze([Object.freeze(price())]);
    expect(projectValuation(positions, prices)).toEqual({
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '150',
      totalValueUsd: '150',
      items: [{ ...position(), price: { priceUsd: '300', observedAt: at, revision: 1 }, valueUsd: '150' }],
    });
    expect(projectValuation(positions, [price(first, '320', 2)]).totalValueUsd).toBe('160');
    expect(prices[0].priceUsd).toBe('300');
  });

  it('keeps same-symbol missing distinct from an explicit zero and never falls back to cost', () => {
    const positions = [position(), position(second, '2')];
    const missing = projectValuation(positions, [price()]);
    expect(missing).toEqual({
      completeness: 'incomplete', missingPriceCount: 1, pricedSubtotalUsd: '150', totalValueUsd: null,
      items: [
        { ...positions[0], price: { priceUsd: '300', observedAt: at, revision: 1 }, valueUsd: '150' },
        { ...positions[1], price: null, valueUsd: null },
      ],
    });
    const zero = projectValuation(positions, [price(), price(second, '0')]);
    expect(zero.completeness).toBe('complete');
    expect(zero.totalValueUsd).toBe('150');
    expect(zero.items[1].valueUsd).toBe('0');
    expect(projectValuation(positions, []).pricedSubtotalUsd).toBe('0');
    expect(projectValuation(positions, []).missingPriceCount).toBe(2);
  });

  it('distinguishes no positions from all prices missing and ignores unrelated price UUIDs', () => {
    expect(projectValuation([], [price()])).toEqual({
      completeness: 'complete', missingPriceCount: 0, pricedSubtotalUsd: '0', totalValueUsd: '0', items: [],
    });
    expect(projectValuation([position()], [price(second)]).totalValueUsd).toBeNull();
  });

  it.each([
    [atom, atom, `0.${'0'.repeat(59)}1`],
    ['0.1', '0.2', '0.02'],
    ['1.000000000000000000000000000001', '1.000000000000000000000000000001',
      '1.000000000000000000000000000002000000000000000000000000000001'],
    [maximum, maximum,
      '999999999999999999999999999999999999999999999999999999999999999999999999999998000000000000000000.000000000000000000000000000000000000000000000000000000000001'],
    ['1000000000000000000000000000000000000000000000000099.999999999999999999999999999', maximum,
      '1000000000000000000000000000000000000000000000000099999999999999999999999999997999999999999999999999.999999999999999999999999999900000000000000000000000000001'],
  ])('preserves exact product of %s and %s', (quantity, priceUsd, expected) => {
    // Extreme expected products independently checked using Python Decimal precision220.
    const result = projectValuation([position(first, quantity)], [price(first, priceUsd)]);
    expect(result.totalValueUsd).toBe(expected);
    expect(result.items[0].valueUsd).toBe(expected);
  });

  it('sums before any rounding and handles all1100 distinct positions', () => {
    const positions = Array.from({ length: 1100 }, (_, index) => position(String(index), atom));
    const prices = positions.map((row) => price(row.instrumentId, atom));
    const result = projectValuation(positions, prices);
    expect(result.items).toHaveLength(1100);
    expect(result.totalValueUsd).toBe(`0.${'0'.repeat(56)}11`);
    expect(result.missingPriceCount).toBe(0);
  });
});

describe('VAL-PRIVATE strict valuation query', () => {
  it('accepts only a real instant and normalizes its offset', () => {
    expect(parseValuationQuery({ at: '2025-01-04T03:00:00+03:00' })).toEqual({ at });
    expect(parseValuationQuery(Object.assign(Object.create(null), { at }))).toEqual({ at });
  });
  it.each<unknown>([
    null, undefined, [], 'date', {}, { at: [at, at] }, { at: null }, { at: 1735948800000 },
    { at: '2025-01-04' }, { at: '2025-01-04T00:00:00' }, { at: '2025-02-30T00:00:00Z' },
    { at: '2025-01-04T00:00:00.0001Z' }, { at: '2025-01-04T00:00:00+14:01' },
    { at: '1969-12-31T23:59:59Z' }, { at, offset: '0' }, { at, limit: '50' },
    { at, journalRevision: '0' }, { at, ownerId: first }, { at, pricePolicy: 'latest' },
    Object.assign(Object.create({ extra: '1' }), { at }),
  ])('rejects malformed or unallowlisted raw query %#', (input) => {
    expect(() => parseValuationQuery(input)).toThrow(BadRequestException);
  });
  it('does not coerce untrusted input', () => {
    const poison = { toString: jest.fn(() => at) };
    expect(() => parseValuationQuery({ at: poison })).toThrow(BadRequestException);
    expect(poison.toString).not.toHaveBeenCalled();
  });
});
