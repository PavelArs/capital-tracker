import { BadRequestException, HttpException } from '@nestjs/common';
import { parseCsvConfirm, parseCsvInspect, parseCsvPreview } from './csv-input';
import { normalizeCsvRows, parseCsvSource } from './csv-parser';
import type { Execution } from './fifo';

const instrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const header =
  'Дата\tКупил\tКоличество\tКупил за\tЗа количество\tв USD\tКурс\tТекущий курс\tТекущая стоимость\tРазница\tДоход';
const sample =
  '13.06.2025\tBTC\t0,00918359\tUSDT\t1000\t1000\t108889,8786\t84945\t780,1000526\t-219,8999475\t-21,99%';

// The owner's purchase sheet: Дата, Купил, Количество, в USD; no side, fee or order column.
function sheetSettings(): Record<string, unknown> {
  return {
    format: { delimiter: '\t', decimalSeparator: ',', timestampMode: 'day-month-year-utc' },
    mapping: {
      columns: { instrument: 1, occurredAt: 0, quantity: 2, grossUsd: 5 },
      instruments: [{ source: 'BTC', instrumentId }],
      sides: [],
      allRowsSide: 'buy',
    },
    assertUsd: true,
    feeIncludedInGross: true,
  };
}

function rejects(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as HttpException).getStatus()).toBe(400);
    return;
  }
  throw new Error('Expected an explicit 400 refusal');
}

function sheet(rows: string[]) {
  const parsed = parseCsvSource(Buffer.from(`${[header, ...rows].join('\r\n')}\r\n`), '\t');
  if (!parsed.valid) throw new Error(`Expected a valid sheet, got ${parsed.error.code}`);
  return parsed;
}

function purchase(occurredAt: string, order: number, changes: Partial<Execution> = {}): Execution {
  return {
    instrumentId,
    side: 'buy',
    occurredAt,
    orderWithinTimestamp: order,
    quantity: '0.00918359',
    grossUsd: '1000',
    feeUsd: '0',
    ...changes,
  };
}

describe('SHEET-1 explicit purchase-sheet settings', () => {
  it('SHEET-SAMPLE accepts tab inspection and the explicit sheet companions', () => {
    expect(parseCsvInspect({ delimiter: '\t' })).toEqual({ delimiter: '\t' });
    expect(parseCsvPreview(sheetSettings())).toEqual({
      format: { delimiter: '\t', decimalSeparator: ',', timestampMode: 'day-month-year-utc' },
      mapping: {
        columns: { instrument: 1, occurredAt: 0, quantity: 2, grossUsd: 5 },
        instruments: [{ source: 'BTC', instrumentId }],
        sides: [],
        allRowsSide: 'buy',
      },
      assertUsd: true,
      feeIncludedInGross: true,
    });
    const confirm = parseCsvConfirm({
      ...sheetSettings(),
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedJournalRevision: 0,
      parserVersion: 'usd-csv-v1',
      previewHash: 'a'.repeat(64),
    });
    expect(confirm.feeIncludedInGross).toBe(true);
    expect(confirm.mapping.allRowsSide).toBe('buy');
  });

  it('SHEET-EXPLICIT refuses an omitted column without its companion and stray companions', () => {
    const base = sheetSettings();
    const mapping = base.mapping as Record<string, unknown>;
    const columns = mapping.columns as Record<string, number>;
    const variants: Record<string, unknown>[] = [
      // Side omitted without allRowsSide.
      { ...base, mapping: { ...mapping, allRowsSide: undefined } },
      { ...base, mapping: { columns, instruments: mapping.instruments, sides: [] } },
      // Fee omitted without the explicit statement.
      { format: base.format, mapping, assertUsd: true },
      { ...base, feeIncludedInGross: false },
      // Companions alongside a mapped column.
      {
        ...base,
        mapping: {
          ...mapping,
          columns: { ...columns, side: 3 },
          sides: [{ source: 'USDT', side: 'buy' }],
        },
      },
      { ...base, mapping: { ...mapping, columns: { ...columns, feeUsd: 4 } } },
      // Only purchases may be implied; sides must stay empty.
      { ...base, mapping: { ...mapping, allRowsSide: 'sell' } },
      { ...base, mapping: { ...mapping, sides: [{ source: 'BTC', side: 'buy' }] } },
      // Date mode carries no offset; order may be omitted only in date mode.
      { ...base, format: { ...(base.format as object), fixedOffset: '+03:00' } },
      { ...base, format: { ...(base.format as object), timestampMode: 'offset' } },
      { ...base, format: { ...(base.format as object), timestampMode: 'date' } },
    ];
    for (const variant of variants) rejects(() => parseCsvPreview(variant));
  });
});

describe('SHEET-1 / SHEET-2 sheet normalization', () => {
  it('SHEET-SAMPLE parses the tab-separated sample row into one midnight-UTC purchase', () => {
    const document = sheet([sample]);
    expect(document.headers).toEqual(header.split('\t'));
    expect(document.rows[0].cells[2]).toBe('0,00918359');
    const result = normalizeCsvRows(document, parseCsvPreview(sheetSettings()));
    expect(result.rowErrors).toEqual([]);
    expect(result.batchErrors).toEqual([]);
    expect(result.rows).toEqual([
      { ordinal: 1, startLine: 2, execution: purchase('2025-06-13T00:00:00.000Z', 1) },
    ]);
    expect(result.ignoredColumns.map((column) => column.header)).toEqual([
      'Купил за',
      'За количество',
      'Курс',
      'Текущий курс',
      'Текущая стоимость',
      'Разница',
      'Доход',
    ]);
  });

  it('SHEET-SAME-DAY keeps identical same-day rows and continues after existing orders', () => {
    const july = sample.replace('13.06.2025', '01.07.2025');
    const august = sample.replace('13.06.2025', '05.08.2025');
    const document = sheet([july, august, july]);
    const existing = purchase('2025-07-01T00:00:00.000Z', 4, { quantity: '2', grossUsd: '7' });
    const result = normalizeCsvRows(document, parseCsvPreview(sheetSettings()), {
      active: [existing],
    });
    expect(result.rowErrors).toEqual([]);
    expect(result.rows.map((row) => row.execution?.orderWithinTimestamp)).toEqual([5, 1, 6]);
    expect(result.rows.map((row) => row.execution?.occurredAt)).toEqual([
      '2025-07-01T00:00:00.000Z',
      '2025-08-05T00:00:00.000Z',
      '2025-07-01T00:00:00.000Z',
    ]);
  });

  it('SHEET-INVALID rejects non-calendar or timed dates and malformed amounts per row', () => {
    const cases: [string, string, string][] = [
      ['31.02.2025', 'occurredAt', 'invalid-time'],
      ['29.02.2025', 'occurredAt', 'invalid-time'],
      ['2025-06-13', 'occurredAt', 'invalid-time'],
      ['13.06.2025 10:00', 'occurredAt', 'invalid-time'],
      ['1.6.2025', 'occurredAt', 'invalid-time'],
      ['01.13.2025', 'occurredAt', 'invalid-time'],
      ['01.01.1969', 'occurredAt', 'invalid-time'],
      ['', 'occurredAt', 'invalid-time'],
    ];
    const rows = cases.map(([date]) => sample.replace('13.06.2025', date));
    rows.push(sample.replace('0,00918359', '1 000'));
    rows.push(sample.replace('0,00918359', '0.5'));
    rows.push(sample.replace('USDT\t1000\t1000', 'USDT\t1000\t0'));
    rows.push(sample.replace('13.06.2025', '29.02.2024'));
    const result = normalizeCsvRows(sheet(rows), parseCsvPreview(sheetSettings()));
    expect(result.rowErrors).toEqual([
      ...cases.map(([, field, code], index) => ({ ordinal: index + 1, field, code })),
      { ordinal: 9, field: 'quantity', code: 'invalid-quantity' },
      { ordinal: 10, field: 'quantity', code: 'invalid-quantity' },
      { ordinal: 11, field: 'grossUsd', code: 'invalid-gross' },
    ]);
    expect(result.rows).toHaveLength(12);
    expect(result.rows.slice(0, 11).every((row) => row.execution === null)).toBe(true);
    expect(result.rows[11].execution).toEqual(purchase('2024-02-29T00:00:00.000Z', 1));
  });

  it('SHEET-DUPLICATE flags rows identical to an active trade but not to each other', () => {
    const document = sheet([sample, sample.replace('0,00918359', '0,01')]);
    const result = normalizeCsvRows(document, parseCsvPreview(sheetSettings()), {
      active: [purchase('2025-06-13T00:00:00.000Z', 1)],
    });
    expect(result.rowErrors).toEqual([
      { ordinal: 1, field: 'occurredAt', code: 'matches-existing-trade' },
    ]);
    expect(result.rows[0].execution).toBeNull();
    expect(result.rows[1].execution).toEqual(
      // Every row with a readable date takes its rank, so the flagged row still holds order 2.
      purchase('2025-06-13T00:00:00.000Z', 3, { quantity: '0.01' }),
    );
  });
});
