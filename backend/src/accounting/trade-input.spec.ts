import { BadRequestException } from '@nestjs/common';
import {
  parseJournalInitialization,
  parseTradeCorrection,
  parseTradeCreate,
  parseTradeHistoryQuery,
  parseTradePageQuery,
  parseTradeVoid,
} from './trade-input';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instant = '2026-01-01T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const initialization = { requestId, coverageFrom: instant, assertEmpty: true };
const execution = {
  requestId,
  expectedJournalRevision: 0,
  instrumentId,
  side: 'buy',
  occurredAt: instant,
  orderWithinTimestamp: 0,
  quantity: '1',
  grossUsd: '100',
  feeUsd: '0',
};
const voidInput = { requestId, expectedJournalRevision: 0 };
const wrongTypes: unknown[] = [undefined, null, true, false, 42, [], ['1'], {}, { toString: '1' }];
const parsers = [
  ['initialization', parseJournalInitialization, initialization],
  ['creation', parseTradeCreate, execution],
  ['correction', parseTradeCorrection, execution],
  ['void', parseTradeVoid, voidInput],
] as const;
const executionParsers = [
  ['creation', parseTradeCreate],
  ['correction', parseTradeCorrection],
] as const;

function rejects(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    return;
  }
  throw new Error('Expected raw accounting input to be refused with HTTP 400');
}

describe('TRADE-001 literal empty-origin attestation', () => {
  it('normalizes the explicit coverage and request ID without inventing an opening or revision', () => {
    expect(
      parseJournalInitialization({
        requestId: requestId.toUpperCase(),
        coverageFrom: '2026-01-01T01:00:00+01:00',
        assertEmpty: true,
      }),
    ).toEqual(initialization);
  });

  it.each<unknown>([undefined, null, false, 'true', 'false', 1, 0, [], {}, { valueOf: true }])(
    'refuses nonliteral-true attestation %#',
    (assertEmpty) => rejects(() => parseJournalInitialization({ ...initialization, assertEmpty })),
  );
});

describe('TRADE-002 command shape and raw identity boundaries', () => {
  it.each(parsers)('%s rejects all absent mandatory fields', (_name, parse, valid) => {
    for (const field of Object.keys(valid)) {
      const incomplete: Record<string, unknown> = { ...valid };
      delete incomplete[field];
      rejects(() => parse(incomplete));
    }
  });

  it.each(parsers)(
    '%s rejects primitive/array roots and mass assignment',
    (_name, parse, valid) => {
      for (const raw of wrongTypes) rejects(() => parse(raw));
      for (const field of [
        'ownerId',
        'accountId',
        'tradeId',
        'version',
        'journalRevision',
        'createdAt',
        'kind',
        'feeCurrency',
        'currency',
        'priceUsd',
        'canonicalPayload',
        'summary',
        'constructor',
      ])
        rejects(() => parse({ ...valid, [field]: requestId }));
      const prototypeField = JSON.parse('{"__proto__":{"ownerId":"synthetic"}}');
      rejects(() => parse({ ...valid, ...prototypeField }));
    },
  );

  it.each(parsers)('%s rejects malformed raw request IDs', (_name, parse, valid) => {
    for (const value of [
      ...wrongTypes,
      '',
      '123',
      ` ${requestId}`,
      `${requestId}\n`,
      'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa',
      'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
    ])
      rejects(() => parse({ ...valid, requestId: value }));
  });

  it.each(executionParsers)(
    '%s normalizes all execution fields without mutating input',
    (_name, parse) => {
      const raw = Object.freeze({
        ...execution,
        requestId: requestId.toUpperCase(),
        instrumentId: instrumentId.toUpperCase(),
        occurredAt: '2026-01-01T01:00:00.0+01:00',
        quantity: '0001.000',
        grossUsd: '00100.00',
        feeUsd: '000.00',
      });
      const before = JSON.stringify(raw);
      expect(parse(raw)).toEqual(execution);
      expect(JSON.stringify(raw)).toBe(before);
    },
  );

  it.each(executionParsers)(
    '%s requires UUID instrument identity and exact side',
    (_name, parse) => {
      for (const value of [...wrongTypes, 'USD', requestId.replace('-4aaa-', '-1aaa-')])
        rejects(() => parse({ ...execution, instrumentId: value }));
      for (const value of [...wrongTypes, 'BUY', 'Sell', ' buy', 'sell ', 'swap', 'transfer'])
        rejects(() => parse({ ...execution, side: value }));
      expect(parse({ ...execution, side: 'sell' }).side).toBe('sell');
    },
  );

  it('void has only normalized request identity and revision, not an editable execution', () => {
    expect(
      parseTradeVoid({ requestId: requestId.toUpperCase(), expectedJournalRevision: 10000 }),
    ).toEqual({
      requestId,
      expectedJournalRevision: 10000,
    });
    rejects(() => parseTradeVoid({ ...voidInput, quantity: '1' }));
    rejects(() => parseTradeVoid({ ...voidInput, side: 'sell' }));
  });
});

describe('TRADE-002 exact amounts before any persistence or typmod rounding', () => {
  it.each(executionParsers)(
    '%s retains scale30, above-2^53 values and full48/30 extrema',
    (_name, parse) => {
      const large = '9007199254740993.000000000000000001';
      expect(parse({ ...execution, quantity: atom, grossUsd: large })).toMatchObject({
        quantity: atom,
        grossUsd: large,
        feeUsd: '0',
      });
      expect(parse({ ...execution, quantity: maximum, grossUsd: maximum })).toMatchObject({
        quantity: maximum,
        grossUsd: maximum,
      });
      expect(parse({ ...execution, quantity: `${'0'.repeat(255)}1` }).quantity).toBe('1');
    },
  );

  it.each(executionParsers)(
    '%s rejects malformed amounts in every monetary/quantity field',
    (_name, parse) => {
      const invalid = [
        ...wrongTypes,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        '',
        ' 1',
        '1 ',
        '1\n',
        '+1',
        '-1',
        '-0',
        '.1',
        '1.',
        '1e2',
        '1E-3',
        '1,000',
        '1,5',
        'NaN',
        'Infinity',
        '-Infinity',
        '１２',
        '9'.repeat(49),
        `0.${'1'.repeat(31)}`,
        `1.${'0'.repeat(31)}`,
        `${'0'.repeat(256)}1`,
      ];
      for (const field of ['quantity', 'grossUsd', 'feeUsd'])
        for (const value of invalid) rejects(() => parse({ ...execution, [field]: value }));
    },
  );

  it.each(executionParsers)(
    '%s distinguishes positive quantity/gross from a legitimate zero fee',
    (_name, parse) => {
      for (const value of ['0', '000', '00.000']) {
        rejects(() => parse({ ...execution, quantity: value }));
        rejects(() => parse({ ...execution, grossUsd: value }));
        expect(parse({ ...execution, feeUsd: value }).feeUsd).toBe('0');
      }
      expect(parse({ ...execution, grossUsd: atom, feeUsd: atom })).toMatchObject({
        grossUsd: atom,
        feeUsd: atom,
      });
    },
  );

  it.each(executionParsers)(
    '%s rejects buy-basis overflow but permits negative sale net',
    (_name, parse) => {
      rejects(() => parse({ ...execution, grossUsd: maximum, feeUsd: atom }));
      const oneBelowMaximum = `${'9'.repeat(48)}.${'9'.repeat(29)}8`;
      expect(parse({ ...execution, grossUsd: oneBelowMaximum, feeUsd: atom })).toMatchObject({
        grossUsd: oneBelowMaximum,
        feeUsd: atom,
      });
      expect(
        parse({ ...execution, side: 'sell', grossUsd: maximum, feeUsd: maximum }),
      ).toMatchObject({
        grossUsd: maximum,
        feeUsd: maximum,
      });
      expect(parse({ ...execution, side: 'sell', grossUsd: atom, feeUsd: maximum })).toMatchObject({
        grossUsd: atom,
        feeUsd: maximum,
      });
    },
  );
});

describe('TRADE-001/002 strict Gregorian instants and integer boundaries', () => {
  const instantParsers = [
    [
      'coverage',
      (value: unknown) =>
        parseJournalInitialization({ ...initialization, coverageFrom: value }).coverageFrom,
    ],
    [
      'creation',
      (value: unknown) => parseTradeCreate({ ...execution, occurredAt: value }).occurredAt,
    ],
    [
      'correction',
      (value: unknown) => parseTradeCorrection({ ...execution, occurredAt: value }).occurredAt,
    ],
  ] as const;

  it.each(instantParsers)(
    '%s normalizes valid offsets, leap dates and exact UTC endpoints',
    (_name, parse) => {
      for (const [raw, expected] of [
        ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00.000Z'],
        ['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z'],
        ['2024-02-29T23:00:01.1+02:00', '2024-02-29T21:00:01.100Z'],
        ['2026-01-01T14:00:00+14:00', instant],
        ['2026-01-01T00:00:00.12-01:30', '2026-01-01T01:30:00.120Z'],
      ])
        expect(parse(raw)).toBe(expected);
    },
  );

  it.each(instantParsers)(
    '%s rejects raw non-instants, calendar rollover and normalized out-of-range dates',
    (_name, parse) => {
      for (const raw of [
        ...wrongTypes,
        '2026-01-01',
        '2026-01-01T00:00:00',
        '2026-01-01 00:00:00Z',
        '2023-02-29T00:00:00Z',
        '2100-02-29T00:00:00Z',
        '2024-04-31T00:00:00Z',
        '2026-00-01T00:00:00Z',
        '2026-13-01T00:00:00Z',
        '2026-01-00T00:00:00Z',
        '2026-01-01T24:00:00Z',
        '2026-01-01T00:60:00Z',
        '2026-01-01T00:00:60Z',
        '2026-01-01T00:00:00.0000Z',
        '2026-01-01T00:00:00+14:01',
        '2026-01-01T00:00:00+15:00',
        '2026-01-01T00:00:00+00:60',
        '1969-12-31T23:00:00-01:00',
        '1970-01-01T00:00:00+01:00',
        '9999-12-31T23:59:59-01:00',
        ' 2026-01-01T00:00:00Z',
        '2026-01-01T00:00:00Z\n',
        'infinity',
      ])
        rejects(() => parse(raw));
    },
  );

  it.each(executionParsers)('%s accepts raw integer endpoints', (_name, parse) => {
    expect(parse(execution)).toMatchObject({ expectedJournalRevision: 0, orderWithinTimestamp: 0 });
    expect(
      parse({ ...execution, expectedJournalRevision: 10000, orderWithinTimestamp: 2147483647 }),
    ).toMatchObject({
      expectedJournalRevision: 10000,
      orderWithinTimestamp: 2147483647,
    });
  });

  it.each(executionParsers)(
    '%s rejects coercible, fractional, unsafe and excessive integers',
    (_name, parse) => {
      for (const field of ['expectedJournalRevision', 'orderWithinTimestamp'])
        for (const value of [
          ...wrongTypes.filter((value) => value !== 42),
          '0',
          '1',
          -1,
          0.1,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER + 1,
        ])
          rejects(() => parse({ ...execution, [field]: value }));
      rejects(() => parse({ ...execution, expectedJournalRevision: 10001 }));
      rejects(() => parse({ ...execution, orderWithinTimestamp: 2147483648 }));
    },
  );

  it('enforces the same revision boundary on void rather than coercing it', () => {
    for (const value of [
      ...wrongTypes.filter((value) => value !== 42),
      '0',
      -1,
      0.5,
      10001,
      Number.NaN,
    ])
      rejects(() => parseTradeVoid({ requestId, expectedJournalRevision: value }));
  });
});

describe('TRADE-005 bounded revision-pinned page and immutable-history query syntax', () => {
  it('applies defaults without inventing a live revision or history cursor', () => {
    expect(parseTradePageQuery({})).toEqual({ offset: 0, limit: 50 });
    expect(parseTradePageQuery({ offset: '0' })).toEqual({ offset: 0, limit: 50 });
    expect(parseTradeHistoryQuery({})).toEqual({ limit: 10 });
  });

  it('accepts canonical exact endpoints and requires a revision for continuation', () => {
    expect(parseTradePageQuery({ journalRevision: '0', offset: '1', limit: '1' })).toEqual({
      journalRevision: 0,
      offset: 1,
      limit: 1,
    });
    expect(parseTradePageQuery({ journalRevision: '10000', offset: '9999', limit: '100' })).toEqual(
      {
        journalRevision: 10000,
        offset: 9999,
        limit: 100,
      },
    );
    expect(parseTradeHistoryQuery({ beforeVersion: '1', limit: '1' })).toEqual({
      beforeVersion: 1,
      limit: 1,
    });
    expect(parseTradeHistoryQuery({ beforeVersion: '10001', limit: '20' })).toEqual({
      beforeVersion: 10001,
      limit: 20,
    });
    rejects(() => parseTradePageQuery({ offset: '1' }));
    rejects(() => parseTradePageQuery({ offset: '9999' }));
  });

  it('rejects noncanonical query integers without converting JSON numbers or repeated values', () => {
    const invalid = [
      null,
      true,
      1,
      [],
      ['1'],
      {},
      '',
      '01',
      '00',
      '+1',
      '-0',
      '-1',
      '1.0',
      '1e1',
      ' 1',
      '1 ',
      '1\n',
      '９',
      '9007199254740993',
    ];
    for (const field of ['journalRevision', 'offset', 'limit'])
      for (const value of invalid)
        rejects(() => parseTradePageQuery({ journalRevision: '1', [field]: value }));
    for (const field of ['beforeVersion', 'limit'])
      for (const value of invalid) rejects(() => parseTradeHistoryQuery({ [field]: value }));
  });

  it('rejects each out-of-bounds page/history field and unrelated query controls', () => {
    for (const raw of [
      { limit: '0' },
      { limit: '101' },
      { journalRevision: '10001' },
      { journalRevision: '1', offset: '10000' },
      { ownerId: requestId },
      { beforeVersion: '1' },
      { cursor: requestId },
    ])
      rejects(() => parseTradePageQuery(raw));
    for (const raw of [
      { limit: '0' },
      { limit: '21' },
      { beforeVersion: '0' },
      { beforeVersion: '10002' },
      { journalRevision: '1' },
      { offset: '0' },
      { ownerId: requestId },
    ])
      rejects(() => parseTradeHistoryQuery(raw));
    for (const raw of [null, true, 1, [], ['1']]) {
      rejects(() => parseTradePageQuery(raw));
      rejects(() => parseTradeHistoryQuery(raw));
    }
  });
});
