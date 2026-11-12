import { BadRequestException } from '@nestjs/common';
import { strictInteger, strictRecord } from '../shared/strict-input';
import { parseUuid } from './input';

/** The one refusal of a malformed accounting command or query. */
export const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
export function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  return strictRecord(raw, keys) ?? bad();
}
export function integer(raw: unknown, minimum: number, maximum: number): number {
  return strictInteger(raw, minimum, maximum) ?? bad();
}
/** A query-string integer: at most five digits, no leading zero, within the bounds. */
export function queryInteger(raw: unknown, minimum: number, maximum: number): number {
  if (typeof raw !== 'string' || raw.length > 5 || !/^(0|[1-9][0-9]*)$/.test(raw)) return bad();
  const value = Number(raw);
  if (value < minimum || value > maximum) return bad();
  return value;
}
/** The request key and the journal revision a command on one account is pinned to. */
export function journalPins(row: Record<string, unknown>) {
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 0, 10000),
  };
}
