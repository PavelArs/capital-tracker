import { BadRequestException } from '@nestjs/common';
import { strictRecord } from '../shared/strict-input';
import { parseAsOf } from './input';

const DAY_MS = 86400000;

export function parseValuationHistoryQuery(input: unknown) {
  const bad = () => new BadRequestException('Invalid accounting input');
  const row = strictRecord(input, ['from', 'to']);
  if (!row) throw bad();
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
