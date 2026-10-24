import { BadRequestException } from '@nestjs/common';
import { strictRecord } from '../shared/strict-input';
import { parseAsOf } from './input';

export function parseValuationQuery(input: unknown): { at: string } {
  const row = strictRecord(input, ['at']);
  if (!row) throw new BadRequestException('Invalid accounting input');
  return { at: parseAsOf(row.at) };
}
