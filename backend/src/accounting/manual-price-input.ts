import { BadRequestException } from '@nestjs/common';
import { strictRecord } from '../shared/strict-input';
import { parseAsOf, parseDecimal, parseUuid } from './input';

export const MAX_PRICE_VERSIONS = 10000;

function bad(): never {
  throw new BadRequestException('Invalid manual price input');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  return strictRecord(input, keys) ?? bad();
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
const QUOTE_CURRENCIES = ['USD', 'EUR', 'RUB'] as const;
export type PriceCurrency = (typeof QUOTE_CURRENCIES)[number];

/**
 * A price in USD (`priceUsd`), or in USD, EUR or RUB (`price` with `currency`): a hand value
 * keeps the currency it was set in (AST-MANUAL-VALUE). The result's `priceUsd` is the stored
 * price column, in `currency` when one is given.
 */
export function parsePriceSet(raw: unknown) {
  const row = object(raw, [
    'requestId',
    'expectedRevision',
    'observedAt',
    'priceUsd',
    'price',
    'currency',
    'assertReviewed',
  ]);
  if (row.priceUsd !== undefined) {
    if (row.price !== undefined || row.currency !== undefined) return bad();
    return { ...command(row), priceUsd: parseDecimal(row.priceUsd, false) };
  }
  if (!QUOTE_CURRENCIES.includes(row.currency as PriceCurrency)) return bad();
  return {
    ...command(row),
    priceUsd: parseDecimal(row.price, false),
    currency: row.currency as PriceCurrency,
  };
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
