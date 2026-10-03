import { BadRequestException } from '@nestjs/common';
import { CsvError, parse } from 'csv-parse/sync';
import {
  type CsvColumnField,
  type CsvDelimiter,
  type CsvSettings,
  validateCsvSource,
} from './csv-input';
import type { Execution } from './fifo';
import { parseAsOf, parseDecimal } from './input';
import { MAX_INPUT_ATOMS, canonicalDecimalToAtoms } from './money';

export type CsvStructuralCode =
  | 'csv-syntax'
  | 'header-required'
  | 'column-limit'
  | 'cell-limit'
  | 'empty-header'
  | 'duplicate-header'
  | 'row-width'
  | 'blank-row'
  | 'row-limit'
  | 'no-data';
export interface CsvIssue {
  code:
    | CsvStructuralCode
    | 'column-out-of-range'
    | 'unused-instrument-key'
    | 'unused-side-key'
    | 'before-coverage'
    | 'duplicate-chronology'
    | 'active-trade-cap'
    | 'version-cap'
    | 'insufficient-holdings'
    | 'connected-history'
    | 'connected-capacity';
  line: number | null;
  column: number | null;
}
export interface CsvSourceRow {
  ordinal: number;
  startLine: number;
  cells: string[];
}
export type CsvInspection =
  | { valid: true; headers: string[]; rows: CsvSourceRow[]; error: null }
  | { valid: false; headers: []; rows: []; error: CsvIssue };
export interface CsvRowError {
  ordinal: number;
  field: CsvColumnField;
  code:
    | 'instrument-key-unmapped'
    | 'side-key-unmapped'
    | 'invalid-time'
    | 'invalid-order'
    | 'invalid-quantity'
    | 'invalid-gross'
    | 'invalid-fee'
    | 'buy-cost-overflow'
    | 'currency-not-usd'
    | 'matches-existing-trade';
}
export interface CsvNormalization {
  rows: { ordinal: number; startLine: number; execution: Execution | null }[];
  rowErrors: CsvRowError[];
  batchErrors: CsvIssue[];
  ignoredColumns: { index: number; header: string }[];
}
class StructuralError extends Error {
  constructor(
    readonly code: CsvStructuralCode,
    readonly line: number | null = null,
    readonly column: number | null = null,
  ) {
    super('Invalid CSV structure');
  }
}

export function parseCsvSource(bytes: Buffer, delimiter: CsvDelimiter): CsvInspection {
  validateCsvSource(bytes);
  const source = bytes.subarray(
    bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0,
  );
  let headers: string[] | undefined;
  const rows: CsvSourceRow[] = [];
  let previousEnd = 0;
  let startLine = 1;
  try {
    parse(source, {
      columns: false,
      delimiter,
      record_delimiter: ['\r\n', '\n'],
      quote: '"',
      escape: '"',
      bom: false,
      encoding: 'utf8',
      cast_date: false,
      trim: false,
      ltrim: false,
      rtrim: false,
      relax_quotes: false,
      relax_column_count: false,
      skip_empty_lines: false,
      skip_records_with_error: false,
      skip_records_with_empty_values: false,
      max_record_size: 131072,
      cast(value, context) {
        if (typeof context.column !== 'number' || context.column >= 32)
          throw new StructuralError('column-limit', startLine);
        if (Buffer.byteLength(value, 'utf8') > 4096)
          throw new StructuralError('cell-limit', startLine, context.column + 1);
        return value;
      },
      on_record(record: string[], context) {
        const line = startLine;
        for (let index = previousEnd; index < context.bytes; index++)
          if (source[index] === 10) startLine++;
        previousEnd = context.bytes;
        if (!headers) {
          const empty = record.findIndex((cell) => cell.trim().length === 0);
          if (empty !== -1) throw new StructuralError('empty-header', line, empty + 1);
          if (new Set(record).size !== record.length)
            throw new StructuralError('duplicate-header', line);
          headers = record;
        } else {
          if (record.length !== headers.length) throw new StructuralError('row-width', line);
          if (record.every((cell) => cell === '')) throw new StructuralError('blank-row', line);
          if (rows.length === 100) throw new StructuralError('row-limit', line);
          rows.push({ ordinal: rows.length + 1, startLine: line, cells: record });
        }
        return record;
      },
    });
    if (!headers) throw new StructuralError('header-required');
    if (rows.length === 0) throw new StructuralError('no-data');
    return { valid: true, headers, rows, error: null };
  } catch (error) {
    if (error instanceof StructuralError)
      return {
        valid: false,
        headers: [],
        rows: [],
        error: { code: error.code, line: error.line, column: error.column },
      };
    if (!(error instanceof CsvError)) throw error;
    const code: CsvStructuralCode =
      error.code === 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH'
        ? 'row-width'
        : error.code === 'CSV_MAX_RECORD_SIZE'
          ? 'cell-limit'
          : 'csv-syntax';
    // Library messages and context may contain private source cells. Expose only our vocabulary.
    return { valid: false, headers: [], rows: [], error: { code, line: startLine, column: null } };
  }
}

function validValue<T>(run: () => T): T | null {
  try {
    return run();
  } catch (error) {
    if (error instanceof BadRequestException) return null;
    throw error;
  }
}
function amount(raw: string, separator: '.' | ',', positive: boolean): string | null {
  if (/\s/.test(raw) || (separator === ',' && raw.includes('.'))) return null;
  return validValue(() => parseDecimal(separator === ',' ? raw.replace(',', '.') : raw, positive));
}
function timestamp(raw: string, format: CsvSettings['format']): string | null {
  if (/\s/.test(raw)) return null;
  if (format.timestampMode === 'day-month-year-utc') {
    // SHEET-1: a sheet date without time is the start of that calendar date in UTC.
    const date = /^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$/.exec(raw);
    if (!date) return null;
    return validValue(() => parseAsOf(`${date[3]}-${date[2]}-${date[1]}T00:00:00Z`));
  }
  return validValue(() =>
    parseAsOf(format.timestampMode === 'fixed-offset' ? `${raw}${format.fixedOffset}` : raw),
  );
}
function order(raw: string): number | null {
  if (raw.length > 10 || !/^(0|[1-9][0-9]*)$/.test(raw) || /\s/.test(raw)) return null;
  const value = Number(raw);
  return value <= 2147483647 ? value : null;
}

const sameExecution = (a: Execution, b: Execution) =>
  a.instrumentId === b.instrumentId &&
  a.side === b.side &&
  a.occurredAt === b.occurredAt &&
  a.quantity === b.quantity &&
  a.grossUsd === b.grossUsd &&
  a.feeUsd === b.feeUsd;

type Slot = Pick<Execution, 'occurredAt' | 'orderWithinTimestamp'>;
/**
 * `active` holds the account's current trades; `occupied` every chronology slot of the
 * account (trades, rewards, swaps and both sides of transfers), defaulting to `active`.
 * Without an order column (date mode only), rows of one instant follow its largest
 * occupied order in file order; date-mode rows that repeat an active trade are SHEET-2
 * duplicates.
 */
export function normalizeCsvRows(
  document: Extract<CsvInspection, { valid: true }>,
  settings: CsvSettings,
  context: { active: readonly Execution[]; occupied?: readonly Slot[] } = { active: [] },
): CsvNormalization {
  const { columns } = settings.mapping;
  const dateOnly = settings.format.timestampMode === 'day-month-year-utc';
  const nextOrder = new Map<string, number>();
  if (columns.order === undefined)
    for (const slot of context.occupied ?? context.active)
      nextOrder.set(
        slot.occurredAt,
        Math.max(nextOrder.get(slot.occurredAt) ?? 1, slot.orderWithinTimestamp + 1),
      );
  const mappedIndexes = new Set(Object.values(columns));
  const ignoredColumns = document.headers.flatMap((header, index) =>
    mappedIndexes.has(index) ? [] : [{ index, header }],
  );
  const result: CsvNormalization = { rows: [], rowErrors: [], batchErrors: [], ignoredColumns };
  if ([...mappedIndexes].some((index) => index >= document.headers.length)) {
    result.rows = document.rows.map(({ ordinal, startLine }) => ({
      ordinal,
      startLine,
      execution: null,
    }));
    result.batchErrors.push({ code: 'column-out-of-range', line: null, column: null });
    return result;
  }
  const instruments = new Map(
    settings.mapping.instruments.map((entry) => [entry.source, entry.instrumentId]),
  );
  const sides = new Map(settings.mapping.sides.map((entry) => [entry.source, entry.side]));
  const observedInstruments = new Set<string>();
  const observedSides = new Set<string>();
  for (const { ordinal, startLine, cells } of document.rows) {
    const beforeErrors = result.rowErrors.length;
    const issue = (field: CsvColumnField, code: CsvRowError['code']) =>
      result.rowErrors.push({ ordinal, field, code });
    observedInstruments.add(cells[columns.instrument]);
    if (columns.side !== undefined) observedSides.add(cells[columns.side]);
    const instrumentId = instruments.get(cells[columns.instrument]);
    const side =
      columns.side === undefined ? settings.mapping.allRowsSide : sides.get(cells[columns.side]);
    const occurredAt = timestamp(cells[columns.occurredAt], settings.format);
    let orderWithinTimestamp: number | null = null;
    if (columns.order !== undefined) orderWithinTimestamp = order(cells[columns.order]);
    else if (occurredAt !== null) {
      orderWithinTimestamp = nextOrder.get(occurredAt) ?? 1;
      nextOrder.set(occurredAt, orderWithinTimestamp + 1);
    }
    const quantity = amount(cells[columns.quantity], settings.format.decimalSeparator, true);
    const grossUsd = amount(cells[columns.grossUsd], settings.format.decimalSeparator, true);
    const feeUsd =
      columns.feeUsd === undefined
        ? '0'
        : amount(cells[columns.feeUsd], settings.format.decimalSeparator, false);
    if (instrumentId === undefined) issue('instrument', 'instrument-key-unmapped');
    if (side === undefined) issue('side', 'side-key-unmapped');
    if (occurredAt === null) issue('occurredAt', 'invalid-time');
    if (orderWithinTimestamp !== null && orderWithinTimestamp > 2147483647)
      orderWithinTimestamp = null;
    if (orderWithinTimestamp === null && (columns.order !== undefined || occurredAt !== null))
      issue('order', 'invalid-order');
    if (quantity === null) issue('quantity', 'invalid-quantity');
    if (grossUsd === null) issue('grossUsd', 'invalid-gross');
    else if (
      side === 'buy' &&
      feeUsd !== null &&
      canonicalDecimalToAtoms(grossUsd) + canonicalDecimalToAtoms(feeUsd) > MAX_INPUT_ATOMS
    )
      issue('grossUsd', 'buy-cost-overflow');
    if (feeUsd === null) issue('feeUsd', 'invalid-fee');
    if (columns.currency !== undefined && cells[columns.currency] !== 'USD')
      issue('currency', 'currency-not-usd');
    const candidate =
      result.rowErrors.length === beforeErrors &&
      instrumentId !== undefined &&
      side !== undefined &&
      occurredAt !== null &&
      orderWithinTimestamp !== null &&
      quantity !== null &&
      grossUsd !== null &&
      feeUsd !== null
        ? { instrumentId, side, occurredAt, orderWithinTimestamp, quantity, grossUsd, feeUsd }
        : null;
    const duplicate =
      dateOnly && candidate !== null && context.active.some((t) => sameExecution(t, candidate));
    if (duplicate) issue('occurredAt', 'matches-existing-trade');
    result.rows.push({ ordinal, startLine, execution: duplicate ? null : candidate });
  }
  if (settings.mapping.instruments.some((entry) => !observedInstruments.has(entry.source)))
    result.batchErrors.push({ code: 'unused-instrument-key', line: null, column: null });
  if (settings.mapping.sides.some((entry) => !observedSides.has(entry.source)))
    result.batchErrors.push({ code: 'unused-side-key', line: null, column: null });
  return result;
}
