import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseDecimal } from './input';
import { parseProfitPreview } from './period-profit';
import { parseFlowRevision } from './portfolio-flow-input';

export const TWR_BOUNDARY_LIMIT = 32;
const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    return bad();
  return input as Record<string, unknown>;
}
export function parseTwrBoundaryQuery(input: unknown) {
  const row = object(input, ['from', 'to']);
  const from = parseAsOf(row.from);
  const to = parseAsOf(row.to);
  if (from >= to) return bad();
  return { from, to };
}
export function parseLinkedTwrPreview(input: unknown) {
  const row = object(input, [
    'from',
    'to',
    'openingValueUsd',
    'closingValueUsd',
    'assertReviewed',
    'expectedJournalRevision',
    'boundaryValuations',
  ]);
  const { expectedJournalRevision, boundaryValuations, ...profit } = row;
  const preview = parseProfitPreview(profit);
  const revision = parseFlowRevision(expectedJournalRevision);
  if (!Array.isArray(boundaryValuations) || boundaryValuations.length > TWR_BOUNDARY_LIMIT)
    return bad();
  const seen = new Set<string>();
  const values = boundaryValuations.map((value) => {
    const entry = object(value, ['at', 'valueBeforeUsd']);
    const at = parseAsOf(entry.at);
    if (at <= preview.from || at >= preview.to || seen.has(at)) return bad();
    seen.add(at);
    return { at, valueBeforeUsd: parseDecimal(entry.valueBeforeUsd, false) };
  });
  return { ...preview, expectedJournalRevision: revision, boundaryValuations: values };
}
