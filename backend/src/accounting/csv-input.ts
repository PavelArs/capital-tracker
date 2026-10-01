import { isUtf8 } from 'node:buffer';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { parseUuid } from './input';

export type CsvBatchState = 'draft' | 'committed' | 'rolled-back';
export type CsvColumnField =
  | 'instrument'
  | 'side'
  | 'occurredAt'
  | 'order'
  | 'quantity'
  | 'grossUsd'
  | 'feeUsd'
  | 'currency';
export interface CsvFormat {
  delimiter: ',' | ';';
  decimalSeparator: '.' | ',';
  timestampMode: 'offset' | 'fixed-offset';
  fixedOffset?: string;
}
export interface CsvMapping {
  columns: Record<Exclude<CsvColumnField, 'currency'>, number> & { currency?: number };
  instruments: { source: string; instrumentId: string }[];
  sides: { source: string; side: 'buy' | 'sell' }[];
}
export interface CsvSettings {
  format: CsvFormat;
  mapping: CsvMapping;
  assertUsd: true;
}
export interface CsvConfirmInput extends CsvSettings {
  requestId: string;
  expectedJournalRevision: number;
  parserVersion: string;
  previewHash: string;
}
export interface CsvRollbackInput {
  requestId: string;
  expectedJournalRevision: number;
}
export interface CsvListQuery {
  cursor?: string;
  limit: number;
}
export interface CsvRowsQuery {
  afterOrdinal: number;
  limit: number;
  batchState?: CsvBatchState;
}

const columnFields = [
  'instrument',
  'side',
  'occurredAt',
  'order',
  'quantity',
  'grossUsd',
  'feeUsd',
  'currency',
] as const;
const has = (row: object, key: string): boolean => Object.prototype.hasOwnProperty.call(row, key);
function bad(): never {
  throw new BadRequestException('Invalid CSV input');
}
function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !keys.includes(key)))
    return bad();
  return raw as Record<string, unknown>;
}
function integer(raw: unknown, maximum: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > maximum)
    return bad();
  return raw === 0 ? 0 : raw;
}
function queryInteger(raw: unknown, minimum: number, maximum: number): number {
  if (typeof raw !== 'string' || raw.length > 3 || !/^(0|[1-9][0-9]*)$/.test(raw) || /\s/.test(raw))
    return bad();
  const value = Number(raw);
  return value < minimum || value > maximum ? bad() : value;
}
function uuid(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length !== 36) return bad();
  return parseUuid(raw);
}
function sourceKey(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > 240 ||
    Array.from(raw).length > 120 ||
    /\p{Cc}/u.test(raw) ||
    Buffer.from(raw).toString('utf8') !== raw
  )
    return bad();
  return raw;
}
export function validateDisplayName(raw: unknown): string {
  const value = sourceKey(raw);
  if (value.includes('/') || value.includes('\\')) return bad();
  return value;
}
export function decodeDisplayName(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    raw.length < 1 ||
    raw.length > 640 ||
    !/^[A-Za-z0-9_-]+$/.test(raw) ||
    /\s/.test(raw)
  )
    return bad();
  const bytes = Buffer.from(raw, 'base64url');
  if (
    bytes.length < 1 ||
    bytes.length > 480 ||
    !isUtf8(bytes) ||
    bytes.toString('base64url') !== raw
  )
    return bad();
  return validateDisplayName(bytes.toString('utf8'));
}
export function validateCsvSource(raw: unknown): Buffer {
  if (!Buffer.isBuffer(raw)) return bad();
  if (raw.length > 262144) throw new PayloadTooLargeException('CSV source is too large');
  if (raw.length === 0 || !isUtf8(raw)) return bad();
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === 0 || (raw[index] === 13 && raw[index + 1] !== 10)) return bad();
  }
  return raw;
}
function delimiter(raw: unknown): ',' | ';' {
  return raw === ',' || raw === ';' ? raw : bad();
}
function format(raw: unknown): CsvFormat {
  const row = object(raw, ['delimiter', 'decimalSeparator', 'timestampMode', 'fixedOffset']);
  if (row.decimalSeparator !== '.' && row.decimalSeparator !== ',') return bad();
  if (row.timestampMode !== 'offset' && row.timestampMode !== 'fixed-offset') return bad();
  let fixedOffset: string | undefined;
  if (row.timestampMode === 'offset') {
    if (has(row, 'fixedOffset')) return bad();
  } else {
    const value = row.fixedOffset;
    if (typeof value !== 'string' || value.length !== 6 || !/^[+-][0-9]{2}:[0-9]{2}$/.test(value))
      return bad();
    const hour = Number(value.slice(1, 3));
    const minute = Number(value.slice(4));
    if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) return bad();
    fixedOffset = hour === 0 && minute === 0 ? '+00:00' : value;
  }
  return {
    delimiter: delimiter(row.delimiter),
    decimalSeparator: row.decimalSeparator,
    timestampMode: row.timestampMode,
    ...(fixedOffset === undefined ? {} : { fixedOffset }),
  };
}
function entries<T extends { source: string }>(
  raw: unknown,
  maximum: number,
  parse: (entry: unknown) => T,
): T[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maximum) return bad();
  const values = raw.map(parse);
  if (new Set(values.map((entry) => entry.source)).size !== values.length) return bad();
  return values.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}
function mapping(raw: unknown): CsvMapping {
  const row = object(raw, ['columns', 'instruments', 'sides']);
  const columns = object(row.columns, columnFields);
  const normalized: CsvMapping['columns'] = {
    instrument: integer(columns.instrument, 31),
    side: integer(columns.side, 31),
    occurredAt: integer(columns.occurredAt, 31),
    order: integer(columns.order, 31),
    quantity: integer(columns.quantity, 31),
    grossUsd: integer(columns.grossUsd, 31),
    feeUsd: integer(columns.feeUsd, 31),
    ...(has(columns, 'currency') ? { currency: integer(columns.currency, 31) } : {}),
  };
  if (new Set(Object.values(normalized)).size !== Object.keys(normalized).length) return bad();
  return {
    columns: normalized,
    instruments: entries(row.instruments, 100, (rawEntry) => {
      const entry = object(rawEntry, ['source', 'instrumentId']);
      return { source: sourceKey(entry.source), instrumentId: uuid(entry.instrumentId) };
    }),
    sides: entries(row.sides, 2, (rawEntry) => {
      const entry = object(rawEntry, ['source', 'side']);
      if (entry.side !== 'buy' && entry.side !== 'sell') return bad();
      return { source: sourceKey(entry.source), side: entry.side };
    }),
  };
}
function settings(row: Record<string, unknown>): CsvSettings {
  if (row.assertUsd !== true) return bad();
  return { format: format(row.format), mapping: mapping(row.mapping), assertUsd: true };
}
export function parseCsvInspect(raw: unknown): { delimiter: ',' | ';' } {
  return { delimiter: delimiter(object(raw, ['delimiter']).delimiter) };
}
export function parseCsvPreview(raw: unknown): CsvSettings {
  return settings(object(raw, ['format', 'mapping', 'assertUsd']));
}
export function parseCsvConfirm(raw: unknown): CsvConfirmInput {
  const row = object(raw, [
    'requestId',
    'expectedJournalRevision',
    'parserVersion',
    'format',
    'mapping',
    'assertUsd',
    'previewHash',
  ]);
  if (
    typeof row.parserVersion !== 'string' ||
    row.parserVersion.length > 32 ||
    !/^[a-z0-9-]+$/.test(row.parserVersion) ||
    /\s/.test(row.parserVersion)
  )
    return bad();
  if (
    typeof row.previewHash !== 'string' ||
    row.previewHash.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(row.previewHash)
  )
    return bad();
  return {
    requestId: uuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 10000),
    parserVersion: row.parserVersion,
    ...settings(row),
    previewHash: row.previewHash,
  };
}
export function parseCsvRollback(raw: unknown): CsvRollbackInput {
  const row = object(raw, ['requestId', 'expectedJournalRevision']);
  return {
    requestId: uuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 10000),
  };
}
export function parseCsvListQuery(raw: unknown): CsvListQuery {
  const row = object(raw, ['cursor', 'limit']);
  return {
    ...(has(row, 'cursor') ? { cursor: uuid(row.cursor) } : {}),
    limit: has(row, 'limit') ? queryInteger(row.limit, 1, 50) : 20,
  };
}
export function parseCsvRowsQuery(raw: unknown): CsvRowsQuery {
  const row = object(raw, ['afterOrdinal', 'limit', 'batchState']);
  const afterOrdinal = has(row, 'afterOrdinal') ? queryInteger(row.afterOrdinal, 0, 100) : 0;
  if (
    (has(row, 'batchState') || afterOrdinal !== 0) &&
    row.batchState !== 'draft' &&
    row.batchState !== 'committed' &&
    row.batchState !== 'rolled-back'
  )
    return bad();
  return {
    afterOrdinal,
    limit: has(row, 'limit') ? queryInteger(row.limit, 1, 100) : 20,
    ...(has(row, 'batchState') ? { batchState: row.batchState as CsvBatchState } : {}),
  };
}
