import { BadRequestException } from '@nestjs/common';
import type { Execution } from './fifo';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { MAX_INPUT_ATOMS, canonicalDecimalToAtoms } from './money';

export interface JournalInitializationInput {
  requestId: string;
  coverageFrom: string;
  assertEmpty: true;
}

export interface TradeCreateInput extends Execution {
  requestId: string;
  expectedJournalRevision: number;
}

export type TradeCorrectionInput = TradeCreateInput;

export interface TradeVoidInput {
  requestId: string;
  expectedJournalRevision: number;
}

export interface TradePageQuery {
  journalRevision?: number;
  offset: number;
  limit: number;
}

export interface TradeHistoryQuery {
  beforeVersion?: number;
  limit: number;
}

function bad(): never {
  throw new BadRequestException('Invalid accounting input');
}

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Object.keys(input).some((key) => !keys.includes(key))) return bad();
  return input as Record<string, unknown>;
}

function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    return bad();
  return value === 0 ? 0 : value;
}

function queryInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'string' || value.length > 5 || !/^(0|[1-9][0-9]*)$/.test(value))
    return bad();
  const number = Number(value);
  if (number < minimum || number > maximum) return bad();
  return number;
}

export function parseJournalInitialization(input: unknown): JournalInitializationInput {
  const row = object(input, ['requestId', 'coverageFrom', 'assertEmpty']);
  if (row.assertEmpty !== true) return bad();
  return {
    requestId: parseUuid(row.requestId),
    coverageFrom: parseAsOf(row.coverageFrom),
    assertEmpty: true,
  };
}

export function parseTradeCreate(input: unknown): TradeCreateInput {
  const row = object(input, [
    'requestId',
    'expectedJournalRevision',
    'instrumentId',
    'side',
    'occurredAt',
    'orderWithinTimestamp',
    'quantity',
    'grossUsd',
    'feeUsd',
  ]);
  if (row.side !== 'buy' && row.side !== 'sell') return bad();
  const quantity = parseDecimal(row.quantity, true);
  const grossUsd = parseDecimal(row.grossUsd, true);
  const feeUsd = parseDecimal(row.feeUsd, false);
  if (
    row.side === 'buy' &&
    canonicalDecimalToAtoms(grossUsd) + canonicalDecimalToAtoms(feeUsd) > MAX_INPUT_ATOMS
  )
    return bad();
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 10000),
    instrumentId: parseUuid(row.instrumentId),
    side: row.side,
    occurredAt: parseAsOf(row.occurredAt),
    orderWithinTimestamp: integer(row.orderWithinTimestamp, 2147483647),
    quantity,
    grossUsd,
    feeUsd,
  };
}

export function parseTradeCorrection(input: unknown): TradeCorrectionInput {
  return parseTradeCreate(input);
}

export function parseTradeVoid(input: unknown): TradeVoidInput {
  const row = object(input, ['requestId', 'expectedJournalRevision']);
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 10000),
  };
}

export function parseTradePageQuery(input: unknown): TradePageQuery {
  return parsePage(input, 9999);
}

export function parseDerivedTradePageQuery(input: unknown): TradePageQuery {
  return parsePage(input, 99999);
}

function parsePage(input: unknown, maxOffset: number): TradePageQuery {
  const row = object(input, ['journalRevision', 'offset', 'limit']);
  const journalRevision =
    row.journalRevision === undefined ? undefined : queryInteger(row.journalRevision, 0, 10000);
  const offset = row.offset === undefined ? 0 : queryInteger(row.offset, 0, maxOffset);
  if (offset !== 0 && journalRevision === undefined) return bad();
  return {
    ...(journalRevision === undefined ? {} : { journalRevision }),
    offset,
    limit: row.limit === undefined ? 50 : queryInteger(row.limit, 1, 100),
  };
}

export function parseTradeHistoryQuery(input: unknown): TradeHistoryQuery {
  const row = object(input, ['beforeVersion', 'limit']);
  return {
    ...(row.beforeVersion === undefined
      ? {}
      : { beforeVersion: queryInteger(row.beforeVersion, 1, 10001) }),
    limit: row.limit === undefined ? 10 : queryInteger(row.limit, 1, 20),
  };
}
