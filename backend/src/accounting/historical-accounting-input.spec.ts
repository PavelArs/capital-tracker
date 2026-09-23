import { BadRequestException } from '@nestjs/common';
import { parseHistoricalQuery } from './historical-accounting-input';

const at = '2025-01-01T00:00:00.000Z';

describe('HIST-003/004 historical query boundary', () => {
  it('normalizes an explicit time zone and reuses bounded page defaults', () => {
    expect(parseHistoricalQuery({ at: '2025-01-01T03:00:00+03:00' })).toEqual({
      at,
      offset: 0,
      limit: 50,
    });
    expect(
      parseHistoricalQuery({ at, offset: '9999', limit: '100', journalRevision: '10000' }),
    ).toEqual({ at, offset: 9999, limit: 100, journalRevision: 10000 });
    expect(parseHistoricalQuery({ at, offset: '1', limit: '1', journalRevision: '0' })).toEqual({
      at,
      offset: 1,
      limit: 1,
      journalRevision: 0,
    });
    expect(parseHistoricalQuery(Object.assign(Object.create(null), { at }))).toEqual({
      at,
      offset: 0,
      limit: 50,
    });
  });

  it.each<unknown>([
    null,
    undefined,
    [],
    'date',
    {},
    { at: [at] },
    { at: null },
    { at: 1735689600000 },
    { at: '2025-01-01' },
    { at: '2025-01-01T00:00:00' },
    { at: '2025-02-30T00:00:00Z' },
    { at: '2025-01-01T00:00:00.0001Z' },
    { at: '2025-01-01T00:00:00+14:01' },
    { at: '1969-12-31T23:59:59Z' },
    { at, unknown: '1' },
    { at, ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { at, offset: '1' },
    { at, offset: '10000', journalRevision: '1' },
    { at, limit: '0' },
    { at, limit: '101' },
    { at, limit: 1 },
    { at, limit: ['1'] },
    { at, journalRevision: '-1' },
    { at, journalRevision: '10001' },
    { at, journalRevision: '01' },
    { at, offset: '0.0' },
  ])('rejects malformed or unexpected raw input %# without coercion', (input) => {
    expect(() => parseHistoricalQuery(input)).toThrow(BadRequestException);
  });

  it('refuses custom prototypes and never invokes untrusted coercion hooks', () => {
    const poison = { toString: jest.fn(() => at), valueOf: jest.fn(() => at) };
    expect(() => parseHistoricalQuery({ at: poison })).toThrow(BadRequestException);
    expect(() =>
      parseHistoricalQuery(Object.assign(Object.create({ extra: '1' }), { at })),
    ).toThrow(BadRequestException);
    expect(poison.toString).not.toHaveBeenCalled();
    expect(poison.valueOf).not.toHaveBeenCalled();
  });
});
