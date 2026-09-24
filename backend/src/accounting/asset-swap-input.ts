import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { canonicalDecimalToAtoms } from './money';
import { parseTradeHistoryQuery, parseTradePageQuery } from './trade-input';

export type SwapFeeSource = 'held' | 'incoming' | null;

interface SwapFields {
  assertExecuted: true;
  outgoingInstrumentId: string;
  incomingInstrumentId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationUsd: string | null;
  feeSource: SwapFeeSource;
  feeInstrumentId: string | null;
  feeQuantity: string;
}
interface SwapPins {
  requestId: string;
  expectedJournalRevision: number;
}
export interface SwapCreateInput extends SwapFields, SwapPins {}
export interface SwapCorrectionInput extends SwapFields, SwapPins {
  expectedVersion: number;
}
export interface SwapVoidInput extends SwapPins {
  expectedVersion: number;
}
export interface SwapAllocationQuery {
  journalRevision?: number;
  expectedVersion?: number;
  offset: number;
  limit: number;
}

const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !keys.includes(key)))
    return bad();
  return raw as Record<string, unknown>;
}
function integer(raw: unknown, minimum: number, maximum: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < minimum || raw > maximum)
    return bad();
  return raw === 0 ? 0 : raw;
}
function queryInteger(raw: unknown, minimum: number, maximum: number): number {
  if (typeof raw !== 'string' || raw.length > 5 || !/^(0|[1-9][0-9]*)$/.test(raw)) return bad();
  const value = Number(raw);
  if (value < minimum || value > maximum) return bad();
  return value;
}
function pins(row: Record<string, unknown>): SwapPins {
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 0, 10000),
  };
}
function fields(row: Record<string, unknown>): SwapFields {
  if (row.assertExecuted !== true) return bad();
  const outgoingInstrumentId = parseUuid(row.outgoingInstrumentId);
  const incomingInstrumentId = parseUuid(row.incomingInstrumentId);
  if (outgoingInstrumentId === incomingInstrumentId) return bad();

  const feeQuantity = parseDecimal(row.feeQuantity, false);
  const incomingQuantity = parseDecimal(row.incomingQuantity, true);
  const feeSource = row.feeSource;
  const feeInstrumentId = row.feeInstrumentId === null ? null : parseUuid(row.feeInstrumentId);
  if (feeQuantity === '0') {
    if (feeSource !== null || feeInstrumentId !== null) return bad();
  } else {
    if (feeSource !== 'held' && feeSource !== 'incoming') return bad();
    if (feeInstrumentId === null) return bad();
    if (feeSource === 'incoming' && feeInstrumentId !== incomingInstrumentId) return bad();
  }

  if (
    feeSource === 'incoming' &&
    canonicalDecimalToAtoms(feeQuantity) > canonicalDecimalToAtoms(incomingQuantity)
  )
    return bad();

  return {
    assertExecuted: true,
    outgoingInstrumentId,
    incomingInstrumentId,
    occurredAt: parseAsOf(row.occurredAt),
    orderWithinTimestamp: integer(row.orderWithinTimestamp, 0, 2147483647),
    outgoingQuantity: parseDecimal(row.outgoingQuantity, true),
    incomingQuantity,
    considerationUsd:
      row.considerationUsd === null ? null : parseDecimal(row.considerationUsd, false),
    feeSource: feeSource as SwapFeeSource,
    feeInstrumentId,
    feeQuantity,
  };
}
const pinKeys = ['requestId', 'expectedJournalRevision'] as const;
const fieldKeys = [
  'assertExecuted',
  'outgoingInstrumentId',
  'incomingInstrumentId',
  'occurredAt',
  'orderWithinTimestamp',
  'outgoingQuantity',
  'incomingQuantity',
  'considerationUsd',
  'feeSource',
  'feeInstrumentId',
  'feeQuantity',
] as const;

export function parseSwapCreate(raw: unknown): SwapCreateInput {
  const row = object(raw, [...pinKeys, ...fieldKeys]);
  return { ...pins(row), ...fields(row) };
}
export function parseSwapCorrection(raw: unknown): SwapCorrectionInput {
  const row = object(raw, [...pinKeys, 'expectedVersion', ...fieldKeys]);
  return {
    ...pins(row),
    expectedVersion: integer(row.expectedVersion, 1, 10000),
    ...fields(row),
  };
}
export function parseSwapVoid(raw: unknown): SwapVoidInput {
  const row = object(raw, [...pinKeys, 'expectedVersion']);
  return {
    ...pins(row),
    expectedVersion: integer(row.expectedVersion, 1, 10000),
  };
}
export function parseSwapListQuery(raw: unknown) {
  return parseTradePageQuery(object(raw, ['journalRevision', 'offset', 'limit']));
}
export function parseSwapHistoryQuery(raw: unknown) {
  return parseTradeHistoryQuery(object(raw, ['beforeVersion', 'limit']));
}
export function parseSwapAllocationQuery(raw: unknown): SwapAllocationQuery {
  const row = object(raw, ['journalRevision', 'expectedVersion', 'offset', 'limit']);
  if ((row.journalRevision === undefined) !== (row.expectedVersion === undefined)) return bad();
  const pins =
    row.journalRevision === undefined
      ? {}
      : {
          journalRevision: queryInteger(row.journalRevision, 0, 10000),
          expectedVersion: queryInteger(row.expectedVersion, 1, 10000),
        };
  const offset = row.offset === undefined ? 0 : queryInteger(row.offset, 0, 99999);
  if (offset !== 0 && row.journalRevision === undefined) return bad();
  return {
    ...pins,
    offset,
    limit: row.limit === undefined ? 50 : queryInteger(row.limit, 1, 100),
  };
}

/** Fixed property order captures target, pins, and normalized economics, but not the request key. */
export function swapPayload(
  kind: 'create' | 'correct' | 'void',
  input: SwapCreateInput | SwapCorrectionInput | SwapVoidInput,
  swapId?: string,
): string {
  if (kind === 'create') {
    if (!('assertExecuted' in input)) return bad();
  } else if (
    !('expectedVersion' in input) ||
    !swapId ||
    (kind === 'correct') !== 'assertExecuted' in input
  ) {
    return bad();
  }
  const target =
    kind === 'create'
      ? {}
      : {
          swapId: parseUuid(swapId),
          expectedVersion: 'expectedVersion' in input ? input.expectedVersion : bad(),
        };
  return JSON.stringify({
    kind,
    ...target,
    expectedJournalRevision: input.expectedJournalRevision,
    ...('assertExecuted' in input
      ? {
          assertExecuted: true,
          outgoingInstrumentId: input.outgoingInstrumentId,
          incomingInstrumentId: input.incomingInstrumentId,
          occurredAt: input.occurredAt,
          orderWithinTimestamp: input.orderWithinTimestamp,
          outgoingQuantity: input.outgoingQuantity,
          incomingQuantity: input.incomingQuantity,
          considerationUsd: input.considerationUsd,
          feeSource: input.feeSource,
          feeInstrumentId: input.feeInstrumentId,
          feeQuantity: input.feeQuantity,
        }
      : {}),
  });
}
