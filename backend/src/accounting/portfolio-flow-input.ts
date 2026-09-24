import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { parseTradePageQuery } from './trade-input';

export interface FlowInitialization {
  requestId: string;
  coverageFrom: string;
  assertReviewed: true;
}
export interface FlowVoid {
  requestId: string;
  expectedJournalRevision: number;
}
export interface FlowCreate extends FlowVoid {
  direction: 'contribution' | 'withdrawal';
  occurredAt: string;
  amountUsd: string;
  assertExternal: true;
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
export function parseFlowRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10000)
    return bad();
  return value === 0 ? 0 : value;
}
export function parseFlowInitialization(input: unknown): FlowInitialization {
  const row = object(input, ['requestId', 'coverageFrom', 'assertReviewed']);
  if (row.assertReviewed !== true) return bad();
  return {
    requestId: parseUuid(row.requestId),
    coverageFrom: parseAsOf(row.coverageFrom),
    assertReviewed: true,
  };
}
export function parseFlowCreate(input: unknown): FlowCreate {
  const row = object(input, [
    'requestId',
    'expectedJournalRevision',
    'direction',
    'occurredAt',
    'amountUsd',
    'assertExternal',
  ]);
  if (
    row.assertExternal !== true ||
    (row.direction !== 'contribution' && row.direction !== 'withdrawal')
  )
    return bad();
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: parseFlowRevision(row.expectedJournalRevision),
    direction: row.direction,
    occurredAt: parseAsOf(row.occurredAt),
    amountUsd: parseDecimal(row.amountUsd, true),
    assertExternal: true,
  };
}
export function parseFlowVoid(input: unknown): FlowVoid {
  const row = object(input, ['requestId', 'expectedJournalRevision']);
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: parseFlowRevision(row.expectedJournalRevision),
  };
}
export function parseFlowPeriod(input: unknown) {
  const row = object(input, ['from', 'to', 'journalRevision', 'offset', 'limit']);
  const from = parseAsOf(row.from);
  const to = parseAsOf(row.to);
  if (from >= to) return bad();
  return {
    from,
    to,
    ...parseTradePageQuery({
      journalRevision: row.journalRevision,
      offset: row.offset,
      limit: row.limit,
    }),
  };
}
