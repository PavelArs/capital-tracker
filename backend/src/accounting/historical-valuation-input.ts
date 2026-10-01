import { BadRequestException } from '@nestjs/common';
import { parseAsOf } from './input';

export function parseValuationQuery(input: unknown): { at: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid accounting input');
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(input).some((key) => key !== 'at')
  )
    throw new BadRequestException('Invalid accounting input');
  return { at: parseAsOf((input as Record<string, unknown>).at) };
}
