import { BadRequestException, HttpException } from '@nestjs/common';
import {
  decodeDisplayName,
  parseCsvConfirm,
  parseCsvInspect,
  parseCsvListQuery,
  parseCsvPreview,
  parseCsvRollback,
  parseCsvRowsQuery,
  validateCsvSource,
  validateDisplayName,
} from './csv-input';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const previewHash = '0123456789abcdef'.repeat(4);
const wrongTypes: unknown[] = [undefined, null, true, false, 1, [], {}, ['value']];

function settings() {
  return {
    format: { delimiter: ';', decimalSeparator: ',', timestampMode: 'offset' },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
      },
      instruments: [{ source: 'BTC', instrumentId }],
      sides: [{ source: 'Покупка', side: 'buy' }],
    },
    assertUsd: true,
  };
}

function confirm() {
  return {
    ...settings(),
    requestId,
    expectedJournalRevision: 0,
    parserVersion: 'usd-csv-v1',
    previewHash,
  };
}

function encoded(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64url');
}

function rejects(run: () => unknown, status = 400): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    if (status === 400) expect(error).toBeInstanceOf(BadRequestException);
    return;
  }
  throw new Error(`Expected invalid CSV input to be refused with HTTP ${status}`);
}

describe('CSV-001-B original byte validation precedes private retention', () => {
  it('returns the identical Buffer without stripping BOM or changing CRLF/quoted LF', () => {
    const source = Buffer.from('\uFEFFИмя;Значение\r\n"строка\nвторая";😀\r\n');
    const before = Buffer.from(source);
    expect(validateCsvSource(source)).toBe(source);
    expect(source.equals(before)).toBe(true);
    expect(source.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('accepts inclusive raw byte endpoints without pretending upload validates CSV grammar', () => {
    for (const size of [1, 262144]) {
      const source = Buffer.alloc(size, 0x61);
      expect(validateCsvSource(source)).toBe(source);
    }
    rejects(() => validateCsvSource(Buffer.alloc(0)));
    rejects(() => validateCsvSource(Buffer.alloc(262145, 0x61)), 413);
  });

  it.each<unknown>([
    ...wrongTypes,
    'a,b\n1,2',
    new Uint8Array([97]),
    { type: 'Buffer', data: [97] },
  ])('refuses a non-Buffer source %#', (raw) => rejects(() => validateCsvSource(raw)));

  it.each([
    [0x80],
    [0xc0, 0xaf],
    [0xe2, 0x82],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xff, 0xfe, 0x61, 0],
    [0xfe, 0xff, 0, 0x61],
  ])('rejects malformed/UTF-16 bytes without replacement decoding %#', (...bytes) => {
    rejects(() => validateCsvSource(Buffer.from(bytes)));
  });

  it.each(['a\0b', 'a\rb', 'a\r', 'a\r\rb', 'a\n"b\rc"\n', '\uFEFFa\0'])(
    'rejects NUL or a bare CR including quoted content %#',
    (source) => rejects(() => validateCsvSource(Buffer.from(source))),
  );
});

describe('CSV-001-B explicit canonical UTF-8 filename metadata', () => {
  it('retains Cyrillic, astral Unicode, spaces and literal text without path interpretation', () => {
    for (const name of [
      'Сделки 😀.csv',
      '  имя.csv  ',
      '<img src=x>.csv',
      '__proto__.csv',
      'e\u0301.csv',
    ])
      expect(decodeDisplayName(encoded(name))).toBe(name);
    for (const name of ['Сделки 😀.csv', '  имя.csv  ', '😀'.repeat(120), 'e\u0301.csv'])
      expect(validateDisplayName(name)).toBe(name);
    expect(decodeDisplayName('YQ')).toBe('a');
    expect(decodeDisplayName(encoded('😀'.repeat(120)))).toBe('😀'.repeat(120));
    expect(encoded('😀'.repeat(120))).toHaveLength(640);
    rejects(() => decodeDisplayName(encoded('a'.repeat(121))));
    rejects(() => decodeDisplayName(encoded('😀'.repeat(121))));
  });

  it.each<unknown>([
    ...wrongTypes,
    '',
    'YQ=',
    'YQ==',
    'YR',
    'Y Q',
    'YQ\n',
    '+w',
    '/w',
    'A',
    '_w',
    'wK8',
    '7aCA',
    'a'.repeat(641),
  ])('rejects noncanonical base64url or invalid decoded Unicode %#', (raw) => {
    rejects(() => decodeDisplayName(raw));
  });

  it.each([
    '',
    '../trades.csv',
    'dir/file.csv',
    'dir\\file.csv',
    'a\0b',
    'a\nb',
    'a\rb',
    'a\tb',
    'a\x7fb',
    'a\x85b',
  ])('rejects empty/path/control labels without silently sanitizing them %#', (name) => {
    rejects(() => decodeDisplayName(encoded(name)));
    rejects(() => validateDisplayName(name));
  });

  it.each<unknown>([...wrongTypes, '\ud800', '\udfff', 'a'.repeat(121), '😀'.repeat(121)])(
    'rejects malformed direct-service display metadata %#',
    (raw) => rejects(() => validateDisplayName(raw)),
  );
});

describe('CSV-002-C strict nested settings before economic mapping', () => {
  const parsers = [
    ['preview', parseCsvPreview, settings],
    ['confirmation', parseCsvConfirm, confirm],
  ] as const;

  it.each(parsers)(
    '%s refuses raw root types, missing fields and server-owned fields',
    (_name, parse, valid) => {
      for (const raw of [...wrongTypes, new Date(), Object.create({ assertUsd: true })])
        rejects(() => parse(raw));
      for (const field of Object.keys(valid())) {
        const raw: Record<string, unknown> = { ...valid() };
        delete raw[field];
        rejects(() => parse(raw));
      }
      for (const field of [
        'ownerId',
        'accountId',
        'batchId',
        'rows',
        'state',
        'summary',
        'canonicalPayload',
        'constructor',
      ])
        rejects(() => parse({ ...valid(), [field]: requestId }));
      rejects(() => parse({ ...valid(), ...JSON.parse('{"__proto__":{"ownerId":"private"}}') }));
      for (const assertion of [...wrongTypes.filter((value) => value !== true), 'true', 'false', 0])
        rejects(() => parse({ ...valid(), assertUsd: assertion }));
    },
  );

  it('preserves optional-property shape and canonicalizes fixed zero offset', () => {
    expect(parseCsvPreview(settings())).toEqual(settings());
    for (const fixedOffset of ['-00:00', '+00:00']) {
      const raw = settings();
      const format = { ...raw.format, timestampMode: 'fixed-offset', fixedOffset };
      expect(parseCsvPreview({ ...raw, format })).toEqual({
        ...raw,
        format: { ...format, fixedOffset: '+00:00' },
      });
    }
    for (const fixedOffset of ['-14:00', '+14:00', '-03:30', '+00:59']) {
      const raw = {
        ...settings(),
        format: {
          delimiter: ',',
          decimalSeparator: '.',
          timestampMode: 'fixed-offset',
          fixedOffset,
        },
      };
      expect(parseCsvPreview(raw)).toEqual(raw);
    }
    const raw = settings();
    const mapping = { ...raw.mapping, columns: { ...raw.mapping.columns, currency: 31 } };
    expect(parseCsvPreview({ ...raw, mapping }).mapping.columns).toEqual(mapping.columns);
  });

  it('rejects format coercion, irrelevant properties and malformed offsets', () => {
    for (const format of [
      ...wrongTypes,
      { ...settings().format, unknown: true },
      { ...settings().format, fixedOffset: null },
      { ...settings().format, fixedOffset: '+00:00' },
    ])
      rejects(() => parseCsvPreview({ ...settings(), format }));
    for (const field of ['delimiter', 'decimalSeparator', 'timestampMode']) {
      for (const raw of [...wrongTypes, '', '\t', '|', 'auto', 'local'])
        rejects(() =>
          parseCsvPreview({ ...settings(), format: { ...settings().format, [field]: raw } }),
        );
      const format: Record<string, unknown> = { ...settings().format };
      delete format[field];
      rejects(() => parseCsvPreview({ ...settings(), format }));
    }
    for (const fixedOffset of [
      ...wrongTypes,
      '',
      'Z',
      '+0:00',
      '00:00',
      '+14:01',
      '-14:01',
      '+15:00',
      '+00:60',
      ' +01:00',
      '+01:00\n',
    ])
      rejects(() =>
        parseCsvPreview({
          ...settings(),
          format: { ...settings().format, timestampMode: 'fixed-offset', fixedOffset },
        }),
      );
    rejects(() =>
      parseCsvPreview({
        ...settings(),
        format: { ...settings().format, timestampMode: 'fixed-offset' },
      }),
    );
  });

  it('requires distinct raw integer column indexes and every economic field', () => {
    const valid = settings();
    for (const columns of [
      ...wrongTypes,
      { ...valid.mapping.columns, currency: null },
      { ...valid.mapping.columns, amount: 7 },
    ])
      rejects(() => parseCsvPreview({ ...valid, mapping: { ...valid.mapping, columns } }));
    for (const field of Object.keys(valid.mapping.columns)) {
      const columns: Record<string, unknown> = { ...valid.mapping.columns };
      delete columns[field];
      rejects(() => parseCsvPreview({ ...valid, mapping: { ...valid.mapping, columns } }));
      for (const index of [
        undefined,
        null,
        true,
        '7',
        [],
        {},
        -1,
        0.5,
        32,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ])
        rejects(() =>
          parseCsvPreview({
            ...valid,
            mapping: { ...valid.mapping, columns: { ...valid.mapping.columns, [field]: index } },
          }),
        );
    }
    rejects(() =>
      parseCsvPreview({
        ...valid,
        mapping: { ...valid.mapping, columns: { ...valid.mapping.columns, feeUsd: 5 } },
      }),
    );
    rejects(() =>
      parseCsvPreview({
        ...valid,
        mapping: { ...valid.mapping, columns: { ...valid.mapping.columns, currency: 0 } },
      }),
    );
    for (const mapping of [...wrongTypes, { ...valid.mapping, ignored: [] }])
      rejects(() => parseCsvPreview({ ...valid, mapping }));
  });

  it('normalizes UUID case/map order by code units without trimming or casefolding source keys', () => {
    const sources = ['😀', 'я', 'é', 'constructor', 'a', '__proto__', 'A', '2', '10'];
    const raw = settings();
    raw.mapping.instruments = sources.map((source) => ({
      source,
      instrumentId: instrumentId.toUpperCase(),
    }));
    raw.mapping.sides = [
      { source: 'sell', side: 'sell' },
      { source: ' buy ', side: 'buy' },
    ];
    const before = JSON.stringify(raw);
    expect(parseCsvPreview(raw)).toEqual({
      ...raw,
      mapping: {
        ...raw.mapping,
        instruments: ['10', '2', 'A', '__proto__', 'a', 'constructor', 'é', 'я', '😀'].map(
          (source) => ({ source, instrumentId }),
        ),
        sides: [
          { source: ' buy ', side: 'buy' },
          { source: 'sell', side: 'sell' },
        ],
      },
    });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('bounds raw map arrays/entries/Unicode and keeps identical target UUID aliases legal', () => {
    const raw = settings();
    raw.mapping.instruments = [
      { source: 'A', instrumentId },
      { source: 'a', instrumentId },
    ];
    expect(parseCsvPreview(raw)).toEqual(raw);
    raw.mapping.instruments = [{ source: '😀'.repeat(120), instrumentId }];
    expect(parseCsvPreview(raw)).toEqual(raw);
    for (const field of ['instruments', 'sides']) {
      for (const entries of [...wrongTypes, []])
        rejects(() =>
          parseCsvPreview({ ...settings(), mapping: { ...settings().mapping, [field]: entries } }),
        );
      const entry =
        field === 'instruments' ? { source: 'A', instrumentId } : { source: 'A', side: 'buy' };
      for (const source of [
        '',
        'x'.repeat(121),
        '😀'.repeat(121),
        '\ud800',
        '\udfff',
        'a\0b',
        'a\nb',
        'a\x85b',
      ])
        rejects(() =>
          parseCsvPreview({
            ...settings(),
            mapping: { ...settings().mapping, [field]: [{ ...entry, source }] },
          }),
        );
      for (const invalid of [...wrongTypes, { ...entry, extra: true }, { ...entry, source: 1 }])
        rejects(() =>
          parseCsvPreview({
            ...settings(),
            mapping: { ...settings().mapping, [field]: [invalid] },
          }),
        );
      rejects(() =>
        parseCsvPreview({
          ...settings(),
          mapping: { ...settings().mapping, [field]: [entry, entry] },
        }),
      );
    }
    for (const id of [
      ...wrongTypes,
      'BTC',
      'bbbbbbbb-bbbb-1bbb-8bbb-bbbbbbbbbbbb',
      `${instrumentId} `,
    ])
      rejects(() =>
        parseCsvPreview({
          ...settings(),
          mapping: { ...settings().mapping, instruments: [{ source: 'BTC', instrumentId: id }] },
        }),
      );
    for (const side of [...wrongTypes, 'BUY', 'Buy', 'buy ', 'swap'])
      rejects(() =>
        parseCsvPreview({
          ...settings(),
          mapping: { ...settings().mapping, sides: [{ source: 'A', side }] },
        }),
      );
    rejects(() =>
      parseCsvPreview({
        ...settings(),
        mapping: {
          ...settings().mapping,
          instruments: Array.from({ length: 101 }, (_, index) => ({
            source: `${index}`,
            instrumentId,
          })),
        },
      }),
    );
    rejects(() =>
      parseCsvPreview({
        ...settings(),
        mapping: {
          ...settings().mapping,
          sides: ['A', 'B', 'C'].map((source) => ({ source, side: 'buy' })),
        },
      }),
    );
  });

  it('accepts the maximum ordinary browser mapping below the unchanged JSON body ceiling', () => {
    const raw = settings();
    raw.mapping.instruments = Array.from({ length: 100 }, (_, index) => ({
      source: String.fromCodePoint(0x1f600 + index) + '😀'.repeat(119),
      instrumentId,
    }));
    raw.mapping.sides = [
      { source: '😀'.repeat(120), side: 'buy' },
      { source: '🚀'.repeat(120), side: 'sell' },
    ];
    const command = { ...confirm(), ...raw };
    expect(Buffer.byteLength(JSON.stringify(command), 'utf8')).toBeLessThan(102400);
    expect(parseCsvConfirm(command).mapping.instruments).toHaveLength(100);
    expect(parseCsvConfirm(command).mapping.sides).toHaveLength(2);
  });
});

describe('CSV-003-B command syntax stays independent of current parser support', () => {
  it('normalizes raw request identity and accepts bounded future-version syntax for replay', () => {
    expect(parseCsvConfirm({ ...confirm(), requestId: requestId.toUpperCase() })).toEqual(
      confirm(),
    );
    for (const parserVersion of ['usd-csv-v1', 'retired-v0', 'a', 'x'.repeat(32)])
      expect(parseCsvConfirm({ ...confirm(), parserVersion }).parserVersion).toBe(parserVersion);
    expect(
      parseCsvRollback({ requestId: requestId.toUpperCase(), expectedJournalRevision: 10000 }),
    ).toEqual({ requestId, expectedJournalRevision: 10000 });
    for (const expectedJournalRevision of [0, 10000])
      expect(
        parseCsvConfirm({ ...confirm(), expectedJournalRevision }).expectedJournalRevision,
      ).toBe(expectedJournalRevision);
  });

  it('rejects malformed versions, hashes and command identities without live parsing', () => {
    for (const parserVersion of [
      ...wrongTypes,
      '',
      'USD-CSV-V1',
      'usd_csv_v1',
      'usd.csv.v1',
      'x'.repeat(33),
      'v1\n',
      ' v1',
    ])
      rejects(() => parseCsvConfirm({ ...confirm(), parserVersion }));
    for (const hash of [
      ...wrongTypes,
      '',
      previewHash.toUpperCase(),
      '0'.repeat(63),
      '0'.repeat(65),
      'g'.repeat(64),
      `${previewHash}\n`,
    ])
      rejects(() => parseCsvConfirm({ ...confirm(), previewHash: hash }));
    for (const id of [
      ...wrongTypes,
      '',
      ` ${requestId}`,
      `${requestId}\n`,
      'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
    ]) {
      rejects(() => parseCsvConfirm({ ...confirm(), requestId: id }));
      rejects(() => parseCsvRollback({ requestId: id, expectedJournalRevision: 0 }));
    }
    for (const revision of [
      undefined,
      null,
      false,
      '0',
      [],
      {},
      -1,
      0.1,
      10001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      rejects(() => parseCsvConfirm({ ...confirm(), expectedJournalRevision: revision }));
      rejects(() => parseCsvRollback({ requestId, expectedJournalRevision: revision }));
    }
    for (const raw of [
      ...wrongTypes,
      { requestId },
      { expectedJournalRevision: 0 },
      { requestId, expectedJournalRevision: 0, kind: 'rollback' },
      confirm(),
    ])
      rejects(() => parseCsvRollback(raw));
  });
});

describe('CSV-002-A / CSV-005-B inspection and pinned provenance query envelopes', () => {
  it('requires only an explicit supported inspection delimiter', () => {
    expect(parseCsvInspect({ delimiter: ',' })).toEqual({ delimiter: ',' });
    expect(parseCsvInspect({ delimiter: ';' })).toEqual({ delimiter: ';' });
    for (const raw of [
      ...wrongTypes,
      {},
      { delimiter: '\t' },
      { delimiter: [','] },
      { delimiter: ',', rows: [] },
      { delimiter: ',', parserVersion: 'usd-csv-v1' },
    ])
      rejects(() => parseCsvInspect(raw));
  });

  it('normalizes bounded listing defaults/cursors without inventing a state pin', () => {
    expect(parseCsvListQuery({})).toEqual({ limit: 20 });
    expect(parseCsvListQuery({ cursor: requestId.toUpperCase(), limit: '50' })).toEqual({
      cursor: requestId,
      limit: 50,
    });
    expect(parseCsvRowsQuery({})).toEqual({ afterOrdinal: 0, limit: 20 });
    expect(parseCsvRowsQuery({ afterOrdinal: '0', limit: '1' })).toEqual({
      afterOrdinal: 0,
      limit: 1,
    });
    for (const batchState of ['draft', 'committed', 'rolled-back'])
      expect(parseCsvRowsQuery({ afterOrdinal: '100', limit: '100', batchState })).toEqual({
        afterOrdinal: 100,
        limit: 100,
        batchState,
      });
    rejects(() => parseCsvRowsQuery({ afterOrdinal: '1' }));
    rejects(() => parseCsvRowsQuery({ afterOrdinal: '100' }));
  });

  it('rejects query coercion, duplicate arrays and noncanonical integers', () => {
    const invalid: unknown[] = [
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
    for (const value of invalid) {
      rejects(() => parseCsvListQuery({ limit: value }));
      rejects(() => parseCsvRowsQuery({ limit: value }));
      rejects(() => parseCsvRowsQuery({ afterOrdinal: value, batchState: 'committed' }));
    }
    for (const raw of [
      null,
      true,
      false,
      1,
      [],
      ['value'],
      { limit: '0' },
      { limit: '51' },
      { cursor: null },
      { cursor: ['x'] },
      { cursor: 'x' },
      { offset: '0' },
      { ownerId: requestId },
      { batchState: 'draft' },
    ])
      rejects(() => parseCsvListQuery(raw));
    for (const raw of [
      null,
      true,
      false,
      1,
      [],
      ['value'],
      { limit: '0' },
      { limit: '101' },
      { afterOrdinal: '101', batchState: 'committed' },
      { batchState: 'COMMITTED' },
      { batchState: null },
      { batchState: ['draft'] },
      { journalRevision: '1' },
      { cursor: requestId },
      { ownerId: requestId },
    ])
      rejects(() => parseCsvRowsQuery(raw));
  });
});
