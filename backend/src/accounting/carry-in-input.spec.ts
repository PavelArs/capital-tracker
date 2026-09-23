import { BadRequestException } from '@nestjs/common';
import {
  parseCarryInInitialization,
  parseCarryInLotsQuery,
  parseCarryInPreview,
} from './carry-in-input';

const instrumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instant = '2025-01-01T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const lot = {
  instrumentId,
  acquiredAt: instant,
  orderWithinTimestamp: 0,
  originalQuantity: '4',
  originalCostUsd: '2',
  remainingQuantity: '3',
};
const preview = { expectedOpeningRevision: 1, lots: [lot] };
const initialize = { ...preview, requestId, assertReviewed: true };
const wrongTypes: unknown[] = [undefined, null, true, false, 1, [], ['1'], {}, { toString: '1' }];

function rejects(run: () => unknown): void {
  expect(run).toThrow(BadRequestException);
}

describe('CARRY input: raw envelopes and canonical reviewed command', () => {
  it('normalizes UUID, offset, decimal zeros and reordered lots without inventing derived fields', () => {
    const raw = {
      requestId: requestId.toUpperCase(),
      expectedOpeningRevision: 1,
      assertReviewed: true,
      lots: [
        { ...lot, orderWithinTimestamp: 2 },
        {
          ...lot,
          instrumentId: instrumentId.toUpperCase(),
          acquiredAt: '2025-01-01T03:00:00+03:00',
          orderWithinTimestamp: -0,
          originalQuantity: '004.00',
          originalCostUsd: '002.000',
          remainingQuantity: '003.0',
        },
      ],
    };
    const before = JSON.stringify(raw);
    expect(parseCarryInInitialization(raw)).toEqual({
      ...initialize,
      lots: [lot, { ...lot, orderWithinTimestamp: 2 }],
    });
    expect(JSON.stringify(raw)).toBe(before);
    expect(parseCarryInPreview(preview)).toEqual(preview);
  });

  it.each<unknown>([null, undefined, [], true, 1, 'body', { toString: 'body' }])(
    'rejects a malformed complete body %#',
    (raw) => {
      rejects(() => parseCarryInPreview(raw));
      rejects(() => parseCarryInInitialization(raw));
    },
  );

  it('refuses inherited custom prototypes and never invokes raw coercion hooks', () => {
    const poison = {
      toString: jest.fn(() => {
        throw new Error('Coercion must not run');
      }),
    };
    rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, originalCostUsd: poison }] }));
    expect(poison.toString).not.toHaveBeenCalled();
    rejects(() => parseCarryInPreview(Object.assign(Object.create({ inherited: true }), preview)));
    rejects(() =>
      parseCarryInPreview({
        ...preview,
        lots: [Object.assign(Object.create({ inherited: true }), lot)],
      }),
    );
  });

  it('requires each field and refuses unknown/server fields at every level', () => {
    for (const field of Object.keys(initialize)) {
      const raw: Record<string, unknown> = { ...initialize };
      delete raw[field];
      rejects(() => parseCarryInInitialization(raw));
    }
    for (const field of Object.keys(lot)) {
      const raw: Record<string, unknown> = { ...lot };
      delete raw[field];
      rejects(() => parseCarryInPreview({ ...preview, lots: [raw] }));
    }
    for (const field of ['ownerId', 'coverageFrom', 'previewHash', 'openingRevision']) {
      rejects(() => parseCarryInPreview({ ...preview, [field]: 'unexpected' }));
      rejects(() => parseCarryInInitialization({ ...initialize, [field]: 'unexpected' }));
    }
    for (const field of ['lotId', 'ordinal', 'carriedCostUsd', 'priorAllocatedCostUsd', 'feeUsd'])
      rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, [field]: '0' }] }));
    rejects(() => parseCarryInPreview(initialize));
  });

  it.each<unknown>([undefined, null, false, 'true', 1, [], {}, { valueOf: true }])(
    'requires literal review true %#',
    (assertReviewed) =>
      rejects(() => parseCarryInInitialization({ ...initialize, assertReviewed })),
  );

  it('rejects coercion of every declared string field', () => {
    for (const field of [
      'instrumentId',
      'acquiredAt',
      'originalQuantity',
      'originalCostUsd',
      'remainingQuantity',
    ])
      for (const value of wrongTypes)
        rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, [field]: value }] }));
    for (const requestId of wrongTypes)
      rejects(() => parseCarryInInitialization({ ...initialize, requestId }));
  });

  it('enforces raw safe integer revision and order bounds', () => {
    for (const expectedOpeningRevision of [
      0,
      -1,
      2147483648,
      1.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      true,
      [],
      {},
    ])
      rejects(() => parseCarryInPreview({ ...preview, expectedOpeningRevision }));
    for (const orderWithinTimestamp of [
      -1,
      2147483648,
      0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '0',
      false,
      [],
      {},
    ])
      rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, orderWithinTimestamp }] }));
    expect(
      parseCarryInPreview({
        expectedOpeningRevision: 2147483647,
        lots: [{ ...lot, orderWithinTimestamp: 2147483647 }],
      }),
    ).toEqual({
      expectedOpeningRevision: 2147483647,
      lots: [{ ...lot, orderWithinTimestamp: 2147483647 }],
    });
  });

  it('requires UUIDv4 identities rather than valid-looking arbitrary UUID versions', () => {
    for (const value of [
      '',
      instrumentId.replace('-4aaa-', '-1aaa-'),
      `${instrumentId} `,
      'not-an-id',
    ]) {
      rejects(() => parseCarryInInitialization({ ...initialize, requestId: value }));
      rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, instrumentId: value }] }));
    }
  });
});

describe('CARRY input: bounded complete lots, dates and exact amounts', () => {
  it('accepts exactly100 distinct lots but rejects101 without conflating cap with duplicate chronology', () => {
    const lots = Array.from({ length: 101 }, (_, orderWithinTimestamp) => ({
      ...lot,
      orderWithinTimestamp,
    }));
    expect(parseCarryInPreview({ ...preview, lots: lots.slice(0, 100) }).lots).toHaveLength(100);
    rejects(() => parseCarryInPreview({ ...preview, lots }));
    for (const lots of [[], null, {}, 'lots', [null], [[]]])
      rejects(() => parseCarryInPreview({ ...preview, lots }));
  });

  it('detects normalized duplicate global chronology even across different instruments', () => {
    rejects(() =>
      parseCarryInPreview({
        ...preview,
        lots: [lot, { ...lot, instrumentId: requestId, acquiredAt: '2025-01-01T01:00:00+01:00' }],
      }),
    );
    expect(
      parseCarryInPreview({ ...preview, lots: [{ ...lot, orderWithinTimestamp: 1 }, lot] }).lots,
    ).toEqual([lot, { ...lot, orderWithinTimestamp: 1 }]);
  });

  it('validates strict calendars/offsets but leaves source-opening eligibility to the service', () => {
    for (const acquiredAt of [
      '2025-02-29T00:00:00Z',
      '2024-04-31T00:00:00Z',
      '2025-01-01',
      '2025-01-01T00:00:00',
      '2025-01-01T24:00:00Z',
      '2025-01-01T00:00:60Z',
      '2025-01-01T00:00:00.0001Z',
      '1969-12-31T23:59:59Z',
      '10000-01-01T00:00:00Z',
    ])
      rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, acquiredAt }] }));
    for (const acquiredAt of [
      '1970-01-01T00:00:00.000Z',
      '2024-02-29T00:00:00.123Z',
      '9999-12-31T23:59:59.999Z',
    ])
      expect(
        parseCarryInPreview({ ...preview, lots: [{ ...lot, acquiredAt }] }).lots[0].acquiredAt,
      ).toBe(acquiredAt);
  });

  it('preserves atom/max/>2^53 values and zero original cost, refusing Q/R zero and R>Q', () => {
    for (const quantity of [atom, maximum, '9007199254740993']) {
      const value = {
        ...lot,
        originalQuantity: quantity,
        remainingQuantity: quantity,
        originalCostUsd: '0',
      };
      expect(parseCarryInPreview({ ...preview, lots: [value] }).lots).toEqual([value]);
    }
    expect(
      parseCarryInPreview({ ...preview, lots: [{ ...lot, originalCostUsd: maximum }] }).lots[0]
        .originalCostUsd,
    ).toBe(maximum);
    for (const value of [
      { originalQuantity: '0', remainingQuantity: '0' },
      { remainingQuantity: '0' },
      { remainingQuantity: '4.000000000000000000000000000001' },
    ])
      rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, ...value }] }));
  });

  it('rejects rounding, nonfinite, exponent, whitespace, comma, signs and excessive raw length', () => {
    const invalid = [
      '',
      ' 1',
      '1 ',
      '+1',
      '-1',
      '1e1',
      '1,0',
      'NaN',
      'Infinity',
      '1.0000000000000000000000000000000',
      '0.0000000000000000000000000000001',
      '1'.repeat(49),
      `${'0'.repeat(256)}1`,
    ];
    for (const field of ['originalQuantity', 'originalCostUsd', 'remainingQuantity'])
      for (const value of invalid)
        rejects(() => parseCarryInPreview({ ...preview, lots: [{ ...lot, [field]: value }] }));
    const padded = `${'0'.repeat(255)}1`;
    expect(
      parseCarryInPreview({
        ...preview,
        lots: [{ ...lot, originalQuantity: padded, remainingQuantity: '1' }],
      }).lots[0].originalQuantity,
    ).toBe('1');
  });
});

describe('CARRY retained lot pagination uses strict HTTP query strings', () => {
  it('normalizes defaults and accepts exact bounds', () => {
    expect(parseCarryInLotsQuery()).toEqual({ afterOrdinal: 0, limit: 50 });
    expect(parseCarryInLotsQuery({ afterOrdinal: '100', limit: '100' })).toEqual({
      afterOrdinal: 100,
      limit: 100,
    });
    expect(parseCarryInLotsQuery({ afterOrdinal: '0', limit: '1' })).toEqual({
      afterOrdinal: 0,
      limit: 1,
    });
  });
  it('refuses wrong types, extra keys and noncanonical integers', () => {
    for (const field of ['afterOrdinal', 'limit'])
      for (const value of [0, 1, true, null, [], {}, '01', '+1', '1.0', '1e0', ' 1', '101', '-1'])
        rejects(() => parseCarryInLotsQuery({ [field]: value }));
    rejects(() => parseCarryInLotsQuery({ limit: '0' }));
    rejects(() => parseCarryInLotsQuery({ journalRevision: '0' }));
  });
});
