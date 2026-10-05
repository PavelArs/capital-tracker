import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { parseTradePageQuery } from './trade-input';

export { parseTradeHistoryQuery as parseTransferHistoryQuery } from './trade-input';

export interface TransferMovement {
  instrumentId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  feeInstrumentId: string | null;
  feeQuantity: string;
}
/** A requested movement; a null order places it after every event already at its instant. */
export type RequestedMovement = Omit<TransferMovement, 'orderWithinTimestamp'> & {
  orderWithinTimestamp: number | null;
};
interface AccountPins {
  expectedFromJournalRevision: number;
  expectedToJournalRevision: number;
}
export interface TransferCreateInput extends RequestedMovement, AccountPins {
  requestId: string;
  fromAccountId: string;
  toAccountId: string;
  assertInternal: true;
}
export interface TransferCorrectionInput extends RequestedMovement, AccountPins {
  requestId: string;
  expectedVersion: number;
  assertInternal: true;
}
export interface TransferVoidInput extends AccountPins {
  requestId: string;
  expectedVersion: number;
}
export interface TransferAllocationQuery {
  fromJournalRevision?: number;
  toJournalRevision?: number;
  offset: number;
  limit: number;
}
const movementKeys = [
  'assertInternal',
  'instrumentId',
  'occurredAt',
  'orderWithinTimestamp',
  'quantity',
  'feeInstrumentId',
  'feeQuantity',
] as const;
const pinKeys = ['requestId', 'expectedFromJournalRevision', 'expectedToJournalRevision'] as const;
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
  return integer(Number(raw), minimum, maximum);
}
function pins(row: Record<string, unknown>) {
  return {
    requestId: parseUuid(row.requestId),
    expectedFromJournalRevision: integer(row.expectedFromJournalRevision, 0, 10000),
    expectedToJournalRevision: integer(row.expectedToJournalRevision, 0, 10000),
  };
}
function movement(row: Record<string, unknown>): RequestedMovement & { assertInternal: true } {
  if (row.assertInternal !== true) return bad();
  const feeQuantity = parseDecimal(row.feeQuantity, false);
  const feeInstrumentId = row.feeInstrumentId === null ? null : parseUuid(row.feeInstrumentId);
  if ((feeQuantity === '0') !== (feeInstrumentId === null)) return bad();
  return {
    assertInternal: true,
    instrumentId: parseUuid(row.instrumentId),
    occurredAt: parseAsOf(row.occurredAt),
    orderWithinTimestamp:
      'orderWithinTimestamp' in row ? integer(row.orderWithinTimestamp, 0, 2147483647) : null,
    quantity: parseDecimal(row.quantity, true),
    feeInstrumentId,
    feeQuantity,
  };
}
export function parseTransferCreate(raw: unknown): TransferCreateInput {
  const row = object(raw, [...pinKeys, 'fromAccountId', 'toAccountId', ...movementKeys]);
  return {
    ...pins(row),
    fromAccountId: parseUuid(row.fromAccountId),
    toAccountId: parseUuid(row.toAccountId),
    ...movement(row),
  };
}
export function parseTransferCorrection(raw: unknown): TransferCorrectionInput {
  const row = object(raw, [...pinKeys, 'expectedVersion', ...movementKeys]);
  return {
    ...pins(row),
    expectedVersion: integer(row.expectedVersion, 1, 10000),
    ...movement(row),
  };
}
export function parseTransferVoid(raw: unknown): TransferVoidInput {
  const row = object(raw, [...pinKeys, 'expectedVersion']);
  return { ...pins(row), expectedVersion: integer(row.expectedVersion, 1, 10000) };
}
export const parseTransferListQuery = parseTradePageQuery;

export function parseTransferAllocationQuery(raw: unknown): TransferAllocationQuery {
  const row = object(raw, ['fromJournalRevision', 'toJournalRevision', 'offset', 'limit']);
  if ((row.fromJournalRevision === undefined) !== (row.toJournalRevision === undefined))
    return bad();
  const revisions =
    row.fromJournalRevision === undefined
      ? {}
      : {
          fromJournalRevision: queryInteger(row.fromJournalRevision, 0, 10000),
          toJournalRevision: queryInteger(row.toJournalRevision, 0, 10000),
        };
  const offset = row.offset === undefined ? 0 : queryInteger(row.offset, 0, 99999);
  if (offset !== 0 && row.fromJournalRevision === undefined) return bad();
  return {
    ...revisions,
    offset,
    limit: row.limit === undefined ? 50 : queryInteger(row.limit, 1, 100),
  };
}

/** Fixed payload ordering makes original pins part of durable request identity. */
export function transferPayload(
  kind: 'create' | 'correct' | 'void',
  input: TransferCreateInput | TransferCorrectionInput | TransferVoidInput,
  transferId?: string,
): string {
  const target =
    'fromAccountId' in input
      ? { fromAccountId: input.fromAccountId, toAccountId: input.toAccountId }
      : { transferId, expectedVersion: input.expectedVersion };
  return JSON.stringify({
    kind,
    ...target,
    expectedFromJournalRevision: input.expectedFromJournalRevision,
    expectedToJournalRevision: input.expectedToJournalRevision,
    ...('quantity' in input
      ? {
          assertInternal: true,
          instrumentId: input.instrumentId,
          occurredAt: input.occurredAt,
          orderWithinTimestamp: input.orderWithinTimestamp,
          quantity: input.quantity,
          feeInstrumentId: input.feeInstrumentId,
          feeQuantity: input.feeQuantity,
        }
      : {}),
  });
}
