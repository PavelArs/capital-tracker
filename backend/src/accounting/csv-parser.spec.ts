import { HttpException } from '@nestjs/common';
import { normalizeCsvRows, parseCsvSource } from './csv-parser';

const instrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherInstrumentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const headers = ['asset', 'side', 'at', 'order', 'quantity', 'gross', 'fee', 'currency', 'note'];

function settings() {
  return {
    format: {
      delimiter: ';' as const,
      decimalSeparator: '.' as const,
      timestampMode: 'offset' as const,
    },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
        currency: 7,
      },
      instruments: [{ source: 'BTC', instrumentId }],
      sides: [{ source: 'B', side: 'buy' as 'buy' | 'sell' }],
    },
    assertUsd: true as const,
  };
}

function row(): string[] {
  return ['BTC', 'B', '2026-01-01T00:00:00Z', '0', '1', '100', '0', 'USD', '=1+1'];
}

function document(cells: string[][]) {
  return {
    valid: true as const,
    headers: [...headers],
    rows: cells.map((values, index) => ({
      ordinal: index + 1,
      startLine: index + 2,
      cells: values,
    })),
    error: null,
  };
}

function execution() {
  return {
    instrumentId,
    side: 'buy',
    occurredAt: '2026-01-01T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '100',
    feeUsd: '0',
  };
}

function rejectsBytes(source: Buffer, status: number): void {
  try {
    parseCsvSource(source, ',');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    return;
  }
  throw new Error('Expected the parser boundary to refuse invalid source bytes');
}

function structuralFailure(source: string, code: string, delimiter: ',' | ';' = ','): void {
  const result = parseCsvSource(Buffer.from(source), delimiter);
  expect(result.valid).toBe(false);
  if (result.valid) throw new Error('Expected one structural failure without a parsed prefix');
  expect(result).toEqual({
    valid: false,
    headers: [],
    rows: [],
    error: { code, line: result.error.line, column: result.error.column },
  });
  for (const location of [result.error.line, result.error.column]) {
    if (location !== null) {
      expect(Number.isSafeInteger(location)).toBe(true);
      expect(location).toBeGreaterThan(0);
    }
  }
  expect(JSON.stringify(result)).not.toContain('PRIVATE_CSV_CANARY');
}

function freezeTree(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
}

describe('CSV-002-A real parser literal records and physical byte-derived starts', () => {
  it('preserves BOM original, multibyte cells, doubled quotes and mixed quoted/record newlines', () => {
    const source = Buffer.from(
      '\uFEFFНаименование;"комментарий\r\nзаголовка";note\r\n"BTC;\nX";"Он сказал ""да""";=1+1\nETH;"строка\r\nещё";"<img src=x>"\r\nSOL;без;конца',
    );
    const before = Buffer.from(source);
    expect(parseCsvSource(source, ';')).toEqual({
      valid: true,
      headers: ['Наименование', 'комментарий\r\nзаголовка', 'note'],
      rows: [
        { ordinal: 1, startLine: 3, cells: ['BTC;\nX', 'Он сказал "да"', '=1+1'] },
        { ordinal: 2, startLine: 5, cells: ['ETH', 'строка\r\nещё', '<img src=x>'] },
        { ordinal: 3, startLine: 7, cells: ['SOL', 'без', 'конца'] },
      ],
      error: null,
    });
    expect(source.equals(before)).toBe(true);
  });

  it('honors explicit delimiter, empty cells, literal numeric-looking strings and comments', () => {
    expect(
      parseCsvSource(Buffer.from('a,b,c\n"left,right",001,""\r\n#text,true,1e3\n'), ','),
    ).toEqual({
      valid: true,
      headers: ['a', 'b', 'c'],
      rows: [
        { ordinal: 1, startLine: 2, cells: ['left,right', '001', ''] },
        { ordinal: 2, startLine: 3, cells: ['#text', 'true', '1e3'] },
      ],
      error: null,
    });
    expect(parseCsvSource(Buffer.from('a;b\n1,25;false'), ';')).toEqual({
      valid: true,
      headers: ['a', 'b'],
      rows: [{ ordinal: 1, startLine: 2, cells: ['1,25', 'false'] }],
      error: null,
    });
    expect(parseCsvSource(Buffer.from(' name ,name\n ,x\n'), ',')).toEqual({
      valid: true,
      headers: [' name ', 'name'],
      rows: [{ ordinal: 1, startLine: 2, cells: [' ', 'x'] }],
      error: null,
    });
  });

  it('repeats source-level validation independently of the upload caller', () => {
    for (const source of [
      Buffer.alloc(0),
      Buffer.from([0xc0, 0xaf]),
      Buffer.from('a\0b'),
      Buffer.from('h\n"x\ry"'),
    ])
      rejectsBytes(source, 400);
    rejectsBytes(Buffer.alloc(262145, 0x61), 413);
  });

  it('retains identical-looking source records as separate ordinals', () => {
    expect(parseCsvSource(Buffer.from('h\n001\n001\n'), ',')).toEqual({
      valid: true,
      headers: ['h'],
      rows: [
        { ordinal: 1, startLine: 2, cells: ['001'] },
        { ordinal: 2, startLine: 3, cells: ['001'] },
      ],
      error: null,
    });
  });
});

describe('CSV-002-B complete structural validation without an accepted prefix', () => {
  it.each([
    ['a,b\n1,2\nPRIVATE_CSV_CANARY,"unfinished', 'csv-syntax'],
    ['a,b\n1,2\nPRIVATE_CSV_CANARY,un"quoted', 'csv-syntax'],
    ['a,b\n1,2\n"closed"suffix,PRIVATE_CSV_CANARY', 'csv-syntax'],
    ['a,b\n1,2\nPRIVATE_CSV_CANARY', 'row-width'],
    ['a,b\n1,2\nPRIVATE_CSV_CANARY,3,4', 'row-width'],
    ['a,b\n1,2\n,\n', 'blank-row'],
    ['a\n1\n\n', 'blank-row'],
    ['a, \nx,y', 'empty-header'],
    ['a,a\nx,y', 'duplicate-header'],
    ['a\n', 'no-data'],
    ['\uFEFF', 'header-required'],
  ])('refuses a malformed complete source %#', (source, code) => structuralFailure(source, code));

  it('accepts 100 complete rows and rejects a 101st instead of truncating', () => {
    const accepted = `h\n${Array.from({ length: 100 }, (_, index) => `${index + 1}`).join('\n')}\n`;
    const result = parseCsvSource(Buffer.from(accepted), ',');
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected the inclusive 100-row boundary');
    expect(result.rows).toHaveLength(100);
    expect(result.rows[99]).toEqual({ ordinal: 100, startLine: 101, cells: ['100'] });
    structuralFailure(`${accepted}101\n`, 'row-limit');
  });

  it('accepts 32 columns and refuses delimiter-heavy first or final records at column 33', () => {
    const names = Array.from({ length: 32 }, (_, index) => `h${index}`);
    const source = `${names.join(',')}\n${Array(32).fill('x').join(',')}`;
    const result = parseCsvSource(Buffer.from(source), ',');
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected the inclusive 32-column boundary');
    expect(result.headers).toEqual(names);
    expect(result.rows[0].cells).toEqual(Array(32).fill('x'));
    structuralFailure(`${names.join(',')},extra\n${Array(33).fill('x').join(',')}`, 'column-limit');
    structuralFailure(`${source}\n${Array(33).fill('x').join(',')}`, 'column-limit');
    structuralFailure(','.repeat(100000), 'column-limit');
  });

  it('measures decoded cells in UTF-8 bytes including header/unmapped cells', () => {
    const exact = 'é'.repeat(2048);
    const result = parseCsvSource(Buffer.from(`${exact},note\n${exact},""`), ',');
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected a 4096-byte multibyte header and data cell');
    expect(result.headers[0]).toBe(exact);
    expect(result.rows[0].cells).toEqual([exact, '']);
    structuralFailure(`${exact}a\nx`, 'cell-limit');
    structuralFailure(`h,note\n1,ok\n2,${exact}a`, 'cell-limit');
    const quoted = `"${'""'.repeat(4096)}"`;
    expect(parseCsvSource(Buffer.from(`h\n${quoted}`), ',')).toEqual({
      valid: true,
      headers: ['h'],
      rows: [{ ordinal: 1, startLine: 2, cells: ['"'.repeat(4096)] }],
      error: null,
    });
  });

  it('accepts a full 32-by-4096-byte record despite the secondary parser record guard', () => {
    const names = Array.from({ length: 32 }, (_, index) => `h${index}`);
    const cells = Array(32).fill('x'.repeat(4096));
    const result = parseCsvSource(Buffer.from(`${names.join(',')}\n${cells.join(',')}`), ',');
    expect(result).toEqual({
      valid: true,
      headers: names,
      rows: [{ ordinal: 1, startLine: 2, cells }],
      error: null,
    });
  });

  it('accepts an actual valid 262144-byte CSV and refuses the same grammar one byte over', () => {
    const names = Array.from({ length: 32 }, (_, index) => `h${index}`);
    const first = Array(32).fill('a'.repeat(4096));
    const prefix = `${names.join(',')}\n${first.join(',')}\n`;
    let remaining = 262144 - Buffer.byteLength(prefix) - 31;
    const second = Array.from({ length: 32 }, () => {
      const length = Math.min(4096, remaining);
      remaining -= length;
      return 'b'.repeat(length);
    });
    const source = Buffer.from(prefix + second.join(','));
    expect(source.length).toBe(262144);
    expect(remaining).toBe(0);
    expect(parseCsvSource(source, ',')).toEqual({
      valid: true,
      headers: names,
      rows: [
        { ordinal: 1, startLine: 2, cells: first },
        { ordinal: 2, startLine: 3, cells: second },
      ],
      error: null,
    });
    rejectsBytes(Buffer.concat([source, Buffer.from('b')]), 413);
  });
});

describe('CSV-002-A exact economic normalization with no FIFO or persistence side effects', () => {
  it('returns only normalized executions/errors/ignored columns and does not mutate either input', () => {
    const parsed = document([row()]);
    const options = settings();
    const before = JSON.stringify({ parsed, options });
    freezeTree(parsed);
    freezeTree(options);
    expect(normalizeCsvRows(parsed, options)).toEqual({
      rows: [{ ordinal: 1, startLine: 2, execution: execution() }],
      rowErrors: [],
      batchErrors: [],
      ignoredColumns: [{ index: 8, header: 'note' }],
    });
    expect(JSON.stringify({ parsed, options })).toBe(before);
  });

  it('normalizes explicit decimal comma and fixed offset through a leap-day crossing', () => {
    const cells = row();
    cells[2] = '2024-03-01T00:15:00.1';
    cells[4] = '0001,5000';
    cells[5] = '000450,00';
    cells[6] = '0002,50';
    const options = {
      ...settings(),
      format: {
        delimiter: ';' as const,
        decimalSeparator: ',' as const,
        timestampMode: 'fixed-offset' as const,
        fixedOffset: '+01:30',
      },
    };
    expect(normalizeCsvRows(document([cells]), options)).toEqual({
      rows: [
        {
          ordinal: 1,
          startLine: 2,
          execution: {
            ...execution(),
            occurredAt: '2024-02-29T22:45:00.100Z',
            quantity: '1.5',
            grossUsd: '450',
            feeUsd: '2.5',
          },
        },
      ],
      rowErrors: [],
      batchErrors: [],
      ignoredColumns: [{ index: 8, header: 'note' }],
    });
  });

  it('applies a negative fixed offset across the year boundary without machine-zone inference', () => {
    const cells = row();
    cells[2] = '2026-12-31T23:30:00.12';
    const options = {
      ...settings(),
      format: {
        ...settings().format,
        timestampMode: 'fixed-offset' as const,
        fixedOffset: '-02:00',
      },
    };
    expect(normalizeCsvRows(document([cells]), options).rows[0].execution).toEqual({
      ...execution(),
      occurredAt: '2027-01-01T01:30:00.120Z',
    });
  });

  it('preserves source order even when the sale appears before its earlier buys', () => {
    const options = settings();
    options.mapping.sides.push({ source: 'S', side: 'sell' });
    const sale = ['BTC', 'S', '2026-01-03T00:00:00Z', '0', '1.5', '450', '0', 'USD', 'sale first'];
    const buy1 = row();
    const buy2 = ['BTC', 'B', '2026-01-02T00:00:00Z', '0', '1', '200', '0', 'USD', 'buy second'];
    expect(normalizeCsvRows(document([sale, buy1, buy2]), options)).toEqual({
      rows: [
        {
          ordinal: 1,
          startLine: 2,
          execution: {
            ...execution(),
            side: 'sell',
            occurredAt: '2026-01-03T00:00:00.000Z',
            quantity: '1.5',
            grossUsd: '450',
          },
        },
        { ordinal: 2, startLine: 3, execution: execution() },
        {
          ordinal: 3,
          startLine: 4,
          execution: { ...execution(), occurredAt: '2026-01-02T00:00:00.000Z', grossUsd: '200' },
        },
      ],
      rowErrors: [],
      batchErrors: [],
      ignoredColumns: [{ index: 8, header: 'note' }],
    });
    options.mapping.sides = [{ source: 'S', side: 'sell' }];
    expect(normalizeCsvRows(document([sale]), options).batchErrors).toEqual([]);
  });

  it('uses exact source keys including prototype-like labels and independent UUID identity', () => {
    const options = settings();
    options.mapping.instruments = [
      { source: '__proto__', instrumentId },
      { source: 'constructor', instrumentId: otherInstrumentId },
    ];
    options.mapping.sides = [{ source: ' buy ', side: 'buy' }];
    const first = row();
    first[0] = '__proto__';
    first[1] = ' buy ';
    const second = row();
    second[0] = 'constructor';
    second[1] = ' buy ';
    expect(normalizeCsvRows(document([first, second]), options).rows).toEqual([
      { ordinal: 1, startLine: 2, execution: execution() },
      { ordinal: 2, startLine: 3, execution: { ...execution(), instrumentId: otherInstrumentId } },
    ]);
  });

  it('retains scale30 atoms, above-safe-integer decimals, exact maxima and zero fees', () => {
    const cells = row();
    cells[4] = atom;
    cells[5] = '9007199254740993.000000000000000001';
    cells[6] = '000.000';
    expect(normalizeCsvRows(document([cells]), settings()).rows[0].execution).toEqual({
      ...execution(),
      quantity: atom,
      grossUsd: '9007199254740993.000000000000000001',
    });
    cells[4] = maximum;
    cells[5] = maximum;
    expect(normalizeCsvRows(document([cells]), settings()).rows[0].execution).toEqual({
      ...execution(),
      quantity: maximum,
      grossUsd: maximum,
    });
    cells[4] = `${'0'.repeat(255)}1`;
    expect(normalizeCsvRows(document([cells]), settings()).rows[0].execution?.quantity).toBe('1');
  });
});

describe('CSV-002-B every invalid economic row remains represented without a partial execution', () => {
  it('orders one safe error per field without returning a valid-subset candidate', () => {
    const bad = [
      'PRIVATE_CSV_CANARY',
      'unknown',
      '2023-02-29T00:00:00Z',
      '01',
      '0',
      '1e3',
      '',
      'usd',
      'private ignored',
    ];
    const result = normalizeCsvRows(document([row(), bad]), settings());
    expect(result).toEqual({
      rows: [
        { ordinal: 1, startLine: 2, execution: execution() },
        { ordinal: 2, startLine: 3, execution: null },
      ],
      rowErrors: [
        { ordinal: 2, field: 'instrument', code: 'instrument-key-unmapped' },
        { ordinal: 2, field: 'side', code: 'side-key-unmapped' },
        { ordinal: 2, field: 'occurredAt', code: 'invalid-time' },
        { ordinal: 2, field: 'order', code: 'invalid-order' },
        { ordinal: 2, field: 'quantity', code: 'invalid-quantity' },
        { ordinal: 2, field: 'grossUsd', code: 'invalid-gross' },
        { ordinal: 2, field: 'feeUsd', code: 'invalid-fee' },
        { ordinal: 2, field: 'currency', code: 'invalid-currency' },
      ],
      batchErrors: [],
      ignoredColumns: [{ index: 8, header: 'note' }],
    });
    expect(JSON.stringify(result.rowErrors)).not.toContain('PRIVATE_CSV_CANARY');
    expect(result).not.toHaveProperty('candidateSummary');
    expect(result).not.toHaveProperty('previewHash');
  });

  it.each([
    ['quantity', 4, 'invalid-quantity'],
    ['grossUsd', 5, 'invalid-gross'],
    ['feeUsd', 6, 'invalid-fee'],
  ] as const)('rejects undeclared/malformed decimals in %s', (field, index, code) => {
    for (const value of [
      '',
      ' 1',
      '1 ',
      '+1',
      '-1',
      '-0',
      '.1',
      '1.',
      '1e2',
      '1E-2',
      '1,5',
      '1,000.00',
      '1_000',
      'NaN',
      'Infinity',
      '１２',
      '9'.repeat(49),
      `0.${'1'.repeat(31)}`,
      `1.${'0'.repeat(31)}`,
      `${'0'.repeat(256)}1`,
    ]) {
      const bad = row();
      bad[index] = value;
      const result = normalizeCsvRows(document([row(), bad]), settings());
      expect(result.rows[1].execution).toBeNull();
      expect(result.rowErrors).toEqual([{ ordinal: 2, field, code }]);
      expect(result.batchErrors).toEqual([]);
    }
    if (field !== 'feeUsd') {
      for (const value of ['0', '000', '0.000']) {
        const bad = row();
        bad[index] = value;
        expect(normalizeCsvRows(document([bad]), settings()).rowErrors).toEqual([
          { ordinal: 1, field, code },
        ]);
      }
    }
  });

  it('decimal comma never accepts grouped/mixed notation or a dot as a fallback', () => {
    const options = {
      ...settings(),
      format: { ...settings().format, decimalSeparator: ',' as const },
    };
    for (const value of ['1.5', '1.000,50', '1,000,50', '1 000,5', ',5', '1,']) {
      const bad = row();
      bad[4] = value;
      expect(normalizeCsvRows(document([bad]), options).rowErrors).toEqual([
        { ordinal: 1, field: 'quantity', code: 'invalid-quantity' },
      ]);
    }
  });

  it('reports buy-cost overflow only after two individually valid values and permits negative sale net', () => {
    const cells = row();
    cells[5] = maximum;
    cells[6] = atom;
    expect(normalizeCsvRows(document([cells]), settings()).rowErrors).toEqual([
      { ordinal: 1, field: 'grossUsd', code: 'buy-cost-overflow' },
    ]);
    cells[5] = `${'9'.repeat(48)}.${'9'.repeat(29)}8`;
    expect(normalizeCsvRows(document([cells]), settings()).rowErrors).toEqual([]);
    const sellOptions = settings();
    sellOptions.mapping.sides[0].side = 'sell';
    cells[5] = '1';
    cells[6] = '15';
    expect(normalizeCsvRows(document([cells]), sellOptions).rows[0].execution).toEqual({
      ...execution(),
      side: 'sell',
      grossUsd: '1',
      feeUsd: '15',
    });
    cells[5] = 'bad';
    cells[6] = 'bad';
    expect(normalizeCsvRows(document([cells]), settings()).rowErrors).toEqual([
      { ordinal: 1, field: 'grossUsd', code: 'invalid-gross' },
      { ordinal: 1, field: 'feeUsd', code: 'invalid-fee' },
    ]);
  });

  it('requires canonical integer cell text and an explicit currency without missing-value defaults', () => {
    for (const value of [
      '',
      '00',
      '01',
      '-0',
      '-1',
      '+1',
      '1.0',
      '1e2',
      ' 1',
      '1 ',
      '2147483648',
      '９',
    ]) {
      const bad = row();
      bad[3] = value;
      expect(normalizeCsvRows(document([bad]), settings()).rowErrors).toEqual([
        { ordinal: 1, field: 'order', code: 'invalid-order' },
      ]);
    }
    for (const value of ['0', '2147483647']) {
      const cells = row();
      cells[3] = value;
      expect(
        normalizeCsvRows(document([cells]), settings()).rows[0].execution?.orderWithinTimestamp,
      ).toBe(value === '0' ? 0 : 2147483647);
    }
    for (const value of ['', 'usd', ' USD', 'USD ', 'US']) {
      const bad = row();
      bad[7] = value;
      expect(normalizeCsvRows(document([bad]), settings()).rowErrors).toEqual([
        { ordinal: 1, field: 'currency', code: 'invalid-currency' },
      ]);
    }
    // PCUR-2: a non-USD currency needs a rate; only USDT/USDC default to 1.
    const euro = row();
    euro[7] = 'EUR';
    expect(normalizeCsvRows(document([euro]), settings()).rowErrors).toEqual([
      { ordinal: 1, field: 'rate', code: 'missing-rate' },
    ]);
    const tether = row();
    tether[7] = 'USDT';
    expect(normalizeCsvRows(document([tether]), settings()).rows[0]).toEqual({
      ordinal: 1,
      startLine: 2,
      execution: execution(),
      payment: { currency: 'USDT', gross: '100', fee: '0', perUsd: '1' },
    });
  });

  it('normalizes explicit offsets/fractions with independently calculated UTC expectations', () => {
    for (const [value, expected] of [
      ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00.000Z'],
      ['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z'],
      ['2024-02-29T23:00:01.1+02:00', '2024-02-29T21:00:01.100Z'],
      ['2026-01-01T00:00:00.12-01:30', '2026-01-01T01:30:00.120Z'],
      ['2026-01-01T14:00:00+14:00', '2026-01-01T00:00:00.000Z'],
    ]) {
      const cells = row();
      cells[2] = value;
      expect(normalizeCsvRows(document([cells]), settings()).rows[0].execution?.occurredAt).toBe(
        expected,
      );
    }
  });

  it('refuses date rollover, missing/extra offset, excessive precision and normalized range escape', () => {
    for (const value of [
      '',
      '2026-01-01',
      '2026-01-01T00:00:00',
      '2026-01-01 00:00:00Z',
      '2023-02-29T00:00:00Z',
      '2100-02-29T00:00:00Z',
      '2024-04-31T00:00:00Z',
      '2026-00-01T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00.0000Z',
      '2026-01-01T00:00:00+14:01',
      '2026-01-01T00:00:00+15:00',
      '2026-01-01T00:00:00+00:60',
      '1970-01-01T00:00:00+01:00',
      '9999-12-31T23:59:59-01:00',
      ' 2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z\n',
    ]) {
      const bad = row();
      bad[2] = value;
      expect(normalizeCsvRows(document([bad]), settings()).rowErrors).toEqual([
        { ordinal: 1, field: 'occurredAt', code: 'invalid-time' },
      ]);
    }
    const options = {
      ...settings(),
      format: {
        ...settings().format,
        timestampMode: 'fixed-offset' as const,
        fixedOffset: '+01:00',
      },
    };
    for (const value of [
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00+01:00',
      '1970-01-01T00:00:00',
      '2023-02-29T00:00:00',
    ]) {
      const bad = row();
      bad[2] = value;
      expect(normalizeCsvRows(document([bad]), options).rowErrors).toEqual([
        { ordinal: 1, field: 'occurredAt', code: 'invalid-time' },
      ]);
    }
  });
});

describe('CSV-002-C observed source sets and mapping bounds remain explicit', () => {
  it('reports unused maps in fixed batch-error order rather than pruning them', () => {
    const options = settings();
    options.mapping.instruments.push({ source: 'UNUSED', instrumentId: otherInstrumentId });
    options.mapping.sides.push({ source: 'UNUSED', side: 'sell' });
    const result = normalizeCsvRows(document([row()]), options);
    expect(result.rows).toEqual([{ ordinal: 1, startLine: 2, execution: execution() }]);
    expect(result.rowErrors).toEqual([]);
    expect(result.batchErrors).toEqual([
      { code: 'unused-instrument-key', line: null, column: null },
      { code: 'unused-side-key', line: null, column: null },
    ]);
  });

  it('retains every row with null execution for an out-of-range mapped column', () => {
    const options = settings();
    options.mapping.columns.currency = 31;
    const result = normalizeCsvRows(document([row(), row()]), options);
    expect(result.rows).toEqual([
      { ordinal: 1, startLine: 2, execution: null },
      { ordinal: 2, startLine: 3, execution: null },
    ]);
    expect(result.batchErrors).toEqual([{ code: 'column-out-of-range', line: null, column: null }]);
    expect(result.rowErrors).toEqual([]);
  });

  it('does not trim, casefold or Unicode-normalize unknown observed source keys', () => {
    for (const value of ['btc', ' BTC', 'BTC ']) {
      const bad = row();
      bad[0] = value;
      const result = normalizeCsvRows(document([row(), bad]), settings());
      expect(result.rowErrors).toEqual([
        { ordinal: 2, field: 'instrument', code: 'instrument-key-unmapped' },
      ]);
      expect(result.rows[1].execution).toBeNull();
    }
    const options = settings();
    options.mapping.instruments = [{ source: 'é', instrumentId }];
    const mapped = row();
    mapped[0] = 'é';
    const other = row();
    other[0] = 'e\u0301';
    expect(normalizeCsvRows(document([mapped, other]), options).rowErrors).toEqual([
      { ordinal: 2, field: 'instrument', code: 'instrument-key-unmapped' },
    ]);
    const badSide = row();
    badSide[1] = 'b';
    expect(normalizeCsvRows(document([row(), badSide]), settings()).rowErrors).toEqual([
      { ordinal: 2, field: 'side', code: 'side-key-unmapped' },
    ]);
  });

  it('reports all unmapped columns in index order without inferring currency from ignored text', () => {
    const options = settings();
    const { currency: _currency, ...columns } = options.mapping.columns;
    const withoutCurrency = { ...options, mapping: { ...options.mapping, columns } };
    const cells = row();
    cells[7] = 'ignored EUR';
    expect(normalizeCsvRows(document([cells]), withoutCurrency)).toEqual({
      rows: [{ ordinal: 1, startLine: 2, execution: execution() }],
      rowErrors: [],
      batchErrors: [],
      ignoredColumns: [
        { index: 7, header: 'currency' },
        { index: 8, header: 'note' },
      ],
    });
  });
});
