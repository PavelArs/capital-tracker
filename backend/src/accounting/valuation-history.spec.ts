import { BadRequestException } from '@nestjs/common';
import { projectValuationSeries } from './valuation-history';
import { parseValuationHistoryQuery } from './valuation-history-input';

const from = '2025-01-01T00:00:00.000Z';
const day2 = '2025-01-02T00:00:00.000Z';
const day3 = '2025-01-03T00:00:00.000Z';
const to = '2025-01-04T00:00:00.000Z';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const position = (quantity: string, instrumentId = id) => ({
  instrumentId,
  instrumentName: 'Same',
  instrumentSymbol: 'SAME',
  quantity,
  costUsd: '100',
});
const price = (observedAt: string, priceUsd: string, instrumentId = id) => ({
  instrumentId,
  observedAt,
  priceUsd,
  revision: 1,
});

describe('VCH-RANGE strict bounded elapsed-time sampling', () => {
  it('normalizes offsets and includes start, every24 hours and exact end once', () => {
    expect(parseValuationHistoryQuery({ from: '2025-01-01T03:00:00+03:00', to })).toEqual({
      from,
      to,
      instants: [from, day2, day3, to],
    });
    expect(parseValuationHistoryQuery({ from, to: '2025-01-02T12:00:00Z' }).instants).toEqual([
      from,
      day2,
      '2025-01-02T12:00:00.000Z',
    ]);
    expect(parseValuationHistoryQuery({ from, to: from }).instants).toEqual([from]);
    expect(parseValuationHistoryQuery(Object.assign(Object.create(null), { from, to })).from).toBe(
      from,
    );
  });

  it('accepts exactly30 days and off-grid near30 days with at most31 points', () => {
    const maximum = parseValuationHistoryQuery({ from, to: '2025-01-31T00:00:00Z' });
    expect(maximum.instants).toHaveLength(31);
    expect(new Set(maximum.instants).size).toBe(31);
    expect(maximum.instants.at(-1)).toBe('2025-01-31T00:00:00.000Z');
    const nearMaximum = parseValuationHistoryQuery({ from, to: '2025-01-30T23:59:59.999Z' });
    expect(nearMaximum.instants).toHaveLength(31);
    expect(nearMaximum.instants.at(-1)).toBe('2025-01-30T23:59:59.999Z');
  });

  it('uses elapsed24h across DST offsets and handles maximum UTC year', () => {
    expect(
      parseValuationHistoryQuery({
        from: '2025-03-29T12:00:00+01:00',
        to: '2025-03-31T12:00:00+02:00',
      }).instants,
    ).toEqual(['2025-03-29T11:00:00.000Z', '2025-03-30T11:00:00.000Z', '2025-03-31T10:00:00.000Z']);
    expect(
      parseValuationHistoryQuery({
        from: '9999-12-30T23:59:59.999Z',
        to: '9999-12-31T23:59:59.999Z',
      }).instants,
    ).toEqual(['9999-12-30T23:59:59.999Z', '9999-12-31T23:59:59.999Z']);
  });

  it.each<unknown>([
    null,
    undefined,
    [],
    'range',
    {},
    { from },
    { to },
    { from: [from], to },
    { from, to: [to, to] },
    { from: 1735689600000, to },
    { from: '2025-01-01', to },
    { from: '2025-01-01T00:00:00', to },
    { from: '2025-02-30T00:00:00Z', to },
    { from: '1969-12-31T23:59:59Z', to },
    { from, to: '2025-01-31T00:00:00.001Z' },
    { from: to, to: from },
    { from, to, limit: '31' },
    { from, to, at: from },
    { from, to, ownerId: id },
    { from, to, sampling: 'hourly' },
    Object.assign(Object.create({ extra: true }), { from, to }),
  ])('rejects malformed or out-of-range input %# without coercion', (input) => {
    expect(() => parseValuationHistoryQuery(input)).toThrow(BadRequestException);
  });
});

describe('VCH-TIMELINE exact point summary projection', () => {
  const states = [
    { at: from, positions: [] },
    { at: day2, positions: [position('1')] },
    { at: day3, positions: [position('2')] },
    { at: to, positions: [position('0.5')] },
  ];
  const known = [price(day2, '100'), price(to, '300')];
  it('keeps empty, complete and missing points in ascending order', () => {
    const before = JSON.stringify({ states, known });
    expect(projectValuationSeries(states, known)).toEqual([
      {
        at: from,
        completeness: 'complete',
        missingPriceCount: 0,
        pricedSubtotalUsd: '0',
        totalValueUsd: '0',
      },
      {
        at: day2,
        completeness: 'complete',
        missingPriceCount: 0,
        pricedSubtotalUsd: '100',
        totalValueUsd: '100',
      },
      {
        at: day3,
        completeness: 'incomplete',
        missingPriceCount: 1,
        pricedSubtotalUsd: '0',
        totalValueUsd: null,
      },
      {
        at: to,
        completeness: 'complete',
        missingPriceCount: 0,
        pricedSubtotalUsd: '150',
        totalValueUsd: '150',
      },
    ]);
    expect(JSON.stringify({ states, known })).toBe(before);
  });
  it('accepts zero but never borrows prices from an adjacent time or same-symbol UUID', () => {
    expect(projectValuationSeries(states, [...known, price(day3, '0')])[2]).toEqual({
      at: day3,
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '0',
      totalValueUsd: '0',
    });
    expect(
      projectValuationSeries(states, [
        ...known,
        price(day3, '999', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      ])[2].totalValueUsd,
    ).toBeNull();
    expect(
      projectValuationSeries(states, [price(day2, '100'), price(to, '320')])[3].totalValueUsd,
    ).toBe('160');
  });
  it('retains a nonzero partial subtotal and scale60 nonzero amount', () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const partial = projectValuationSeries(
      [{ at: from, positions: [position('1'), position('2', other)] }],
      [price(from, '100')],
    )[0];
    expect(partial).toEqual({
      at: from,
      completeness: 'incomplete',
      missingPriceCount: 1,
      pricedSubtotalUsd: '100',
      totalValueUsd: null,
    });
    const atom = '0.000000000000000000000000000001';
    expect(
      projectValuationSeries([{ at: from, positions: [position(atom)] }], [price(from, atom)])[0]
        .totalValueUsd,
    ).toBe(`0.${'0'.repeat(59)}1`);
  });
});
