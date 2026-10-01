import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal, parseUuid } from './input';

export const MAX_PRICE_VERSIONS = 10000;

function bad(): never {
  throw new BadRequestException('Invalid manual price input');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Object.keys(input).some((key) => !keys.includes(key))) return bad();
  return input as Record<string, unknown>;
}
function queryInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,4})$/.test(value)) return bad();
  const number = Number(value);
  if (number < minimum || number > maximum) return bad();
  return number;
}
function command(row: Record<string, unknown>) {
  if (row.assertReviewed !== true) return bad();
  if (
    typeof row.expectedRevision !== 'number' ||
    !Number.isSafeInteger(row.expectedRevision) ||
    row.expectedRevision < 0 ||
    row.expectedRevision > MAX_PRICE_VERSIONS
  )
    return bad();
  return {
    requestId: parseUuid(row.requestId),
    expectedRevision: row.expectedRevision === 0 ? 0 : row.expectedRevision,
    observedAt: parseAsOf(row.observedAt),
    assertReviewed: true as const,
  };
}
export function parsePriceSet(raw: unknown) {
  const row = object(raw, [
    'requestId',
    'expectedRevision',
    'observedAt',
    'priceUsd',
    'assertReviewed',
  ]);
  return { ...command(row), priceUsd: parseDecimal(row.priceUsd, false) };
}
export function parsePriceVoid(raw: unknown) {
  return command(object(raw, ['requestId', 'expectedRevision', 'observedAt', 'assertReviewed']));
}
export function parsePricePageQuery(raw: unknown) {
  const row = object(raw, ['offset', 'limit', 'revision']);
  const revision =
    row.revision === undefined ? undefined : queryInteger(row.revision, 0, MAX_PRICE_VERSIONS);
  const offset = row.offset === undefined ? 0 : queryInteger(row.offset, 0, MAX_PRICE_VERSIONS);
  if (offset > 0 && revision === undefined) return bad();
  return {
    ...(revision === undefined ? {} : { revision }),
    offset,
    limit: row.limit === undefined ? 50 : queryInteger(row.limit, 1, 100),
  };
}
export function parsePriceHistoryQuery(raw: unknown) {
  const row = object(raw, ['observedAt', 'beforeRevision', 'limit']);
  return {
    observedAt: parseAsOf(row.observedAt),
    ...(row.beforeRevision === undefined
      ? {}
      : { beforeRevision: queryInteger(row.beforeRevision, 1, MAX_PRICE_VERSIONS + 1) }),
    limit: row.limit === undefined ? 10 : queryInteger(row.limit, 1, 20),
  };
}
