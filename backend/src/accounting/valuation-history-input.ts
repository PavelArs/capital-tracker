import { BadRequestException } from '@nestjs/common';
import { parseAsOf } from './input';

const DAY_MS = 86400000;

export function parseValuationHistoryQuery(input: unknown) {
  const bad = () => new BadRequestException('Invalid accounting input');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad();
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(input).some((key) => !['from', 'to'].includes(key))
  )
    throw bad();
  const row = input as Record<string, unknown>;
  const from = parseAsOf(row.from);
  const to = parseAsOf(row.to);
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (end < start || end - start > 30 * DAY_MS) throw bad();
  const instants: string[] = [];
  for (let instant = start; instant <= end; instant += DAY_MS)
    instants.push(new Date(instant).toISOString());
  if (instants[instants.length - 1] !== to) instants.push(to);
  return { from, to, instants };
}
