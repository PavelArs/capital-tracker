import { BadRequestException } from '@nestjs/common';
import {
  parseAccount,
  parseAccountChange,
  parseAsOf,
  parseDecimal,
  parseHistoryQuery,
  parseInstrument,
  parseListQuery,
  parseOpening,
  parseUuid,
} from './input';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const known = {
  instrumentId,
  quantity: '1',
  costStatus: 'known',
  totalCostUsd: '0',
};
const opening = {
  requestId,
  expectedRevision: 0,
  asOf: '2026-01-01T00:00:00Z',
  positions: [known],
};
const wrongTypes: unknown[] = [null, true, 42, [], ['x'], {}, { toString: 'synthetic' }];

function rejects(run: () => unknown): void {
  expect(run).toThrow(BadRequestException);
}

describe('OPEN-002 exact decimal boundary', () => {
  it.each([
    ['0001.2300', '1.23'],
    ['000', '0'],
    ['0.000000000000000000000000000001', '0.000000000000000000000000000001'],
    ['9007199254740993.000000000000000001', '9007199254740993.000000000000000001'],
    [`${'9'.repeat(48)}.${'9'.repeat(30)}`, `${'9'.repeat(48)}.${'9'.repeat(30)}`],
  ])('canonicalizes %s without floating-point loss', (input, expected) => {
    expect(parseDecimal(input, false)).toBe(expected);
  });

  it.each([
    ...wrongTypes,
    '',
    ' 1',
    '1 ',
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
    '1\n',
    '9'.repeat(49),
    `0.${'1'.repeat(31)}`,
    `1.${'0'.repeat(31)}`,
    '0'.repeat(257),
  ])('rejects invalid decimal %#', (input) => rejects(() => parseDecimal(input, false)));

  it('distinguishes positive quantity from nonnegative known cost', () => {
    expect(parseDecimal('000.000', false)).toBe('0');
    rejects(() => parseDecimal('000.000', true));
    expect(parseDecimal('0.000000000000000001', true)).toBe('0.000000000000000001');
  });
  it('accepts the full raw text boundary without counting leading zeros as precision', () => {
    expect(parseDecimal(`${'0'.repeat(255)}1`, true)).toBe('1');
  });
});

describe('OPEN-002 explicit calendar and offset boundary', () => {
  it.each([
    ['2024-02-29T23:00:01.1+02:00', '2024-02-29T21:00:01.100Z'],
    ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00.000Z'],
    ['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z'],
    ['2026-01-01T14:00:00+14:00', '2026-01-01T00:00:00.000Z'],
    ['2026-01-01T00:00:00.12-01:30', '2026-01-01T01:30:00.120Z'],
  ])('normalizes %s to an explicit UTC instant', (input, expected) => {
    expect(parseAsOf(input)).toBe(expected);
  });
  it.each([
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
  ])('rejects invalid instant %# without rollover', (input) => rejects(() => parseAsOf(input)));
});

describe('OPEN-001/003 canonical typed creation input', () => {
  it('normalizes UUID case and trims labels without conflating symbols', () => {
    expect(parseUuid(requestId.toUpperCase())).toBe(requestId);
    expect(parseAccount({ requestId, name: '  Ручной счёт  ' })).toEqual({
      requestId,
      name: 'Ручной счёт',
    });
    expect(parseInstrument({ requestId, name: 'Token', symbol: ' usd ' })).toEqual({
      requestId,
      name: 'Token',
      symbol: 'usd',
    });
    expect(parseInstrument({ requestId, name: 'Token' })).toEqual({
      requestId,
      name: 'Token',
      symbol: null,
    });
  });
  it.each([...wrongTypes, '', '123', 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'])(
    'rejects invalid UUID %#',
    (value) => rejects(() => parseUuid(value)),
  );
  it.each(['', '   ', 'x'.repeat(121), 'control\u0000', 'control\n'])(
    'rejects invalid name %#',
    (name) => rejects(() => parseAccount({ requestId, name })),
  );
  it.each([null, '', ' ', 'x'.repeat(33), 'control\t'])(
    'rejects invalid supplied symbol %#',
    (symbol) => rejects(() => parseInstrument({ requestId, name: 'Name', symbol })),
  );
  it.each(['name', 'requestId', 'symbol'])('preserves raw type of %s', (field) => {
    for (const value of wrongTypes)
      rejects(() =>
        parseInstrument({
          requestId,
          name: 'Name',
          symbol: 'T',
          [field]: value,
        }),
      );
  });
  it('rejects unknown fields and does not mutate the source', () => {
    rejects(() => parseAccount({ requestId, name: 'Name', ownerId: requestId }));
    const input = { requestId: requestId.toUpperCase(), name: ' Name ' };
    parseAccount(input);
    expect(input).toEqual({
      requestId: requestId.toUpperCase(),
      name: ' Name ',
    });
  });
});

describe('OPEN-003 complete opening canonicalization', () => {
  it('makes reordered, zero-padded and UTC-equivalent retries identical', () => {
    const first = parseOpening({
      ...opening,
      positions: [{ ...known, instrumentId: secondId, quantity: '0002.00' }, known],
    });
    const equivalent = parseOpening({
      ...opening,
      requestId: requestId.toUpperCase(),
      asOf: '2026-01-01T01:00:00+01:00',
      positions: [
        {
          ...known,
          instrumentId: instrumentId.toUpperCase(),
          totalCostUsd: '00.0',
        },
        { ...known, instrumentId: secondId, quantity: '2' },
      ],
    });
    expect(first).toEqual(equivalent);
    expect(first.positions.map((position) => position.instrumentId)).toEqual([
      instrumentId,
      secondId,
    ]);
  });
  it('keeps unknown/null separate from known zero', () => {
    expect(
      parseOpening({
        ...opening,
        positions: [{ ...known, costStatus: 'unknown', totalCostUsd: null }],
      }).positions[0].totalCostUsd,
    ).toBeNull();
    expect(parseOpening(opening).positions[0].totalCostUsd).toBe('0');
    for (const position of [
      { ...known, totalCostUsd: null },
      { ...known, costStatus: null },
      { ...known, costStatus: 'unknown', totalCostUsd: '0' },
      { ...known, costStatus: 'unknown', totalCostUsd: undefined },
    ])
      rejects(() => parseOpening({ ...opening, positions: [position] }));
  });
  it('rejects duplicate canonical instrument identities and projected fields', () => {
    rejects(() =>
      parseOpening({
        ...opening,
        positions: [known, { ...known, instrumentId: instrumentId.toUpperCase() }],
      }),
    );
    rejects(() =>
      parseOpening({
        ...opening,
        positions: [{ ...known, instrumentName: 'Injected' }],
      }),
    );
    rejects(() => parseOpening({ ...opening, ownerId: requestId }));
  });
  it.each<unknown>(['0', true, [], {}, { toString: '0' }, -1, 0.1, 2147483647, null])(
    'rejects raw invalid revision %#',
    (expectedRevision) => rejects(() => parseOpening({ ...opening, expectedRevision })),
  );
  it.each(['requestId', 'asOf'])('rejects malformed raw %s', (field) => {
    for (const value of wrongTypes) rejects(() => parseOpening({ ...opening, [field]: value }));
  });
  it.each(['instrumentId', 'quantity', 'costStatus', 'totalCostUsd'])(
    'rejects malformed position %s',
    (field) => {
      for (const value of wrongTypes)
        rejects(() =>
          parseOpening({
            ...opening,
            positions: [{ ...known, [field]: value }],
          }),
        );
    },
  );
  it('requires one through one hundred real position objects', () => {
    for (const positions of [null, {}, [], [null]])
      rejects(() => parseOpening({ ...opening, positions }));
    const positions = Array.from({ length: 101 }, (_, index) => ({
      ...known,
      instrumentId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    }));
    expect(parseOpening({ ...opening, positions: positions.slice(0, 100) }).positions).toHaveLength(
      100,
    );
    rejects(() => parseOpening({ ...opening, positions }));
  });
});

describe('OPEN-001/003 strict bounded query input', () => {
  it('supplies bounded defaults and canonical cursors', () => {
    expect(parseListQuery({})).toEqual({ limit: 50 });
    expect(parseListQuery({ cursor: requestId.toUpperCase(), limit: '100' })).toEqual({
      cursor: requestId,
      limit: 100,
    });
    expect(parseHistoryQuery({})).toEqual({ limit: 10 });
    expect(parseHistoryQuery({ beforeRevision: '2', limit: '20' })).toEqual({
      beforeRevision: 2,
      limit: 20,
    });
  });
  it.each(['0', '101', '1.0', '1e1', '+1', ' 1', '01', ['1'], true, 1])(
    'rejects noncanonical query limit %#',
    (limit) => rejects(() => parseListQuery({ limit })),
  );
  it('rejects unbounded history, invalid cursors and extra fields', () => {
    rejects(() => parseHistoryQuery({ limit: '21' }));
    rejects(() => parseHistoryQuery({ beforeRevision: '0' }));
    rejects(() => parseListQuery({ cursor: [] }));
    rejects(() => parseListQuery({ ownerId: requestId }));
  });
});

describe('WAL-RENAME, W1 account change input', () => {
  it('trims the new name and accepts nothing else', () => {
    expect(parseAccountChange({ name: '  Cold storage  ' })).toEqual({ name: 'Cold storage' });
    expect(parseAccountChange({ name: 'x'.repeat(120) })).toEqual({ name: 'x'.repeat(120) });
  });
  it('takes a kind alone or with the name, and null to take the choice back', () => {
    expect(parseAccountChange({ kind: 'hardware' })).toEqual({ kind: 'hardware' });
    expect(parseAccountChange({ name: ' Ledger ', kind: 'software' })).toEqual({
      name: 'Ledger',
      kind: 'software',
    });
    expect(parseAccountChange({ kind: null })).toEqual({ kind: null });
    expect(parseAccountChange({ kind: 'exchange' })).toEqual({ kind: 'exchange' });
  });
  it('names a kind of a new account only when sent', () => {
    expect(parseAccount({ requestId, name: 'Ledger' })).toEqual({ requestId, name: 'Ledger' });
    expect(parseAccount({ requestId, name: 'Ledger', kind: 'hardware' })).toEqual({
      requestId,
      name: 'Ledger',
      kind: 'hardware',
    });
    rejects(() => parseAccount({ requestId, name: 'Ledger', kind: null }));
    rejects(() => parseAccount({ requestId, name: 'Ledger', kind: 'bank' }));
  });
  it.each([
    undefined,
    null,
    [],
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(121) },
    { name: 'Line\nbreak' },
    { name: 7 },
    { name: 'Ledger', requestId },
    { kind: 'bank' },
    { kind: 'Software' },
    { kind: 7 },
    { name: 'Ledger', kind: undefined, extra: 1 },
  ])('refuses %p', (input) => {
    expect(() => parseAccountChange(input)).toThrow(BadRequestException);
  });
});
