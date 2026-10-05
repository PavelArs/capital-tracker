import { BadRequestException } from '@nestjs/common';
import type { Execution } from './fifo';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { canonicalDecimalToAtoms, MAX_INPUT_ATOMS } from './money';
import { isPaidCurrency, type TradePaymentInput } from './paid-currency';

export interface JournalInitializationInput {
  requestId: string;
  coverageFrom: string;
  assertEmpty: true;
}

type TradeFields = Omit<Execution, 'grossUsd' | 'feeUsd' | 'paid' | 'orderWithinTimestamp'> & {
  requestId: string;
  expectedJournalRevision: number;
  /** null: place after every event already at this instant (OPS-SAME-DAY). */
  orderWithinTimestamp: number | null;
  /** The owner's note, trimmed; absent when none was given (OPS-COMMENT). */
  comment?: string;
};
/** USD amounts, or the amounts as paid in RUB or EUR (CUR-PAID-RUB), never both. */
export type TradeCreateInput = TradeFields &
  (
    | { grossUsd: string; feeUsd: string; paid?: undefined }
    | { paid: TradePaymentInput; grossUsd?: undefined; feeUsd?: undefined }
  );

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
    'paid',
    'comment',
  ]);
  if (row.side !== 'buy' && row.side !== 'sell') return bad();
  const quantity = parseDecimal(row.quantity, true);
  const amounts =
    row.paid === undefined
      ? { grossUsd: parseDecimal(row.grossUsd, true), feeUsd: parseDecimal(row.feeUsd, false) }
      : { paid: parsePaid(row.paid, row.grossUsd, row.feeUsd) };
  const [gross, fee] = amounts.paid
    ? [amounts.paid.gross, amounts.paid.fee]
    : [amounts.grossUsd, amounts.feeUsd];
  if (
    row.side === 'buy' &&
    canonicalDecimalToAtoms(gross) + canonicalDecimalToAtoms(fee) > MAX_INPUT_ATOMS
  )
    return bad();
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 10000),
    instrumentId: parseUuid(row.instrumentId),
    side: row.side,
    occurredAt: parseAsOf(row.occurredAt),
    orderWithinTimestamp:
      'orderWithinTimestamp' in row ? integer(row.orderWithinTimestamp, 2147483647) : null,
    quantity,
    ...amounts,
    ...parseComment(row.comment),
  };
}

export const MAX_COMMENT_LENGTH = 500;

const allowedControls = new Set(['\t', '\n', '\r']);
const control = (character: string) => {
  const code = character.charCodeAt(0);
  return (code < 0x20 || code === 0x7f) && !allowedControls.has(character);
};

/** A note of at most 500 characters; tabs and line breaks are its only control characters. */
function parseComment(value: unknown): { comment?: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string') return bad();
  const comment = value.trim();
  if (comment === '') return {};
  const characters = [...comment];
  if (characters.length > MAX_COMMENT_LENGTH || characters.some(control)) return bad();
  return { comment };
}

function parsePaid(value: unknown, grossUsd: unknown, feeUsd: unknown): TradePaymentInput {
  if (grossUsd !== undefined || feeUsd !== undefined) return bad();
  const paid = object(value, ['currency', 'gross', 'fee', 'perUsd']);
  if (!isPaidCurrency(paid.currency)) return bad();
  return {
    currency: paid.currency,
    gross: parseDecimal(paid.gross, true),
    fee: parseDecimal(paid.fee, false),
    ...(paid.perUsd === undefined ? {} : { perUsd: parseDecimal(paid.perUsd, true) }),
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

export interface AvailableQuery {
  instrumentId: string;
  at: string;
  excludeTradeId?: string;
}

export function parseAvailableQuery(input: unknown): AvailableQuery {
  const row = object(input, ['instrumentId', 'at', 'excludeTradeId']);
  return {
    instrumentId: parseUuid(row.instrumentId),
    at: parseAsOf(row.at),
    ...(row.excludeTradeId === undefined ? {} : { excludeTradeId: parseUuid(row.excludeTradeId) }),
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
