import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { canonicalDecimalToAtoms } from './money';

export interface CarryInLotInput {
  instrumentId: string;
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
}
export interface CarryInPreviewInput {
  expectedOpeningRevision: number;
  lots: CarryInLotInput[];
}
export interface CarryInInitializationInput extends CarryInPreviewInput {
  requestId: string;
  assertReviewed: true;
}
export interface CarryInLotsQuery {
  afterOrdinal: number;
  limit: number;
}

const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Object.keys(value).some((key) => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 2147483647
  )
    return bad();
  return value === 0 ? 0 : value;
}
function preview(row: Record<string, unknown>): CarryInPreviewInput {
  const expectedOpeningRevision = integer(row.expectedOpeningRevision, 1);
  if (!Array.isArray(row.lots) || row.lots.length < 1 || row.lots.length > 100) return bad();
  const lots = Array.from(row.lots, (value): CarryInLotInput => {
    const lot = object(value, [
      'instrumentId',
      'acquiredAt',
      'orderWithinTimestamp',
      'originalQuantity',
      'originalCostUsd',
      'remainingQuantity',
    ]);
    const originalQuantity = parseDecimal(lot.originalQuantity, true);
    const remainingQuantity = parseDecimal(lot.remainingQuantity, true);
    if (canonicalDecimalToAtoms(remainingQuantity) > canonicalDecimalToAtoms(originalQuantity))
      return bad();
    return {
      instrumentId: parseUuid(lot.instrumentId),
      acquiredAt: parseAsOf(lot.acquiredAt),
      orderWithinTimestamp: integer(lot.orderWithinTimestamp, 0),
      originalQuantity,
      originalCostUsd: parseDecimal(lot.originalCostUsd, false),
      remainingQuantity,
    };
  }).sort((left, right) =>
    left.acquiredAt === right.acquiredAt
      ? left.orderWithinTimestamp - right.orderWithinTimestamp
      : left.acquiredAt < right.acquiredAt
        ? -1
        : 1,
  );
  for (let index = 1; index < lots.length; index++) {
    if (
      lots[index].acquiredAt === lots[index - 1].acquiredAt &&
      lots[index].orderWithinTimestamp === lots[index - 1].orderWithinTimestamp
    )
      return bad();
  }
  return { expectedOpeningRevision, lots };
}

export function parseCarryInPreview(value: unknown): CarryInPreviewInput {
  return preview(object(value, ['expectedOpeningRevision', 'lots']));
}
export function parseCarryInInitialization(value: unknown): CarryInInitializationInput {
  const row = object(value, ['requestId', 'expectedOpeningRevision', 'lots', 'assertReviewed']);
  if (row.assertReviewed !== true) return bad();
  return { requestId: parseUuid(row.requestId), ...preview(row), assertReviewed: true };
}
function queryInteger(value: unknown, minimum: number): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,2})$/.test(value)) return bad();
  const result = Number(value);
  return result < minimum || result > 100 ? bad() : result;
}
export function parseCarryInLotsQuery(value: unknown = {}): CarryInLotsQuery {
  const row = object(value, ['afterOrdinal', 'limit']);
  return {
    afterOrdinal: row.afterOrdinal === undefined ? 0 : queryInteger(row.afterOrdinal, 0),
    limit: row.limit === undefined ? 50 : queryInteger(row.limit, 1),
  };
}
