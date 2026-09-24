import { BadRequestException } from '@nestjs/common';
import { parseAsOf, parseUuid } from './input';

function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid accounting input');
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new BadRequestException('Invalid accounting input');
  return input as Record<string, unknown>;
}

export function parseManualPortfolioRequest(input: unknown, query: unknown) {
  object(query, []);
  const body = object(input, ['at', 'accountIds']);
  const ids = body.accountIds;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 10 ||
    Object.keys(ids).length !== ids.length
  )
    throw new BadRequestException('Invalid accounting input');
  const accountIds = Array.from(ids, parseUuid);
  if (new Set(accountIds).size !== accountIds.length)
    throw new BadRequestException('Invalid accounting input');
  return { at: parseAsOf(body.at), accountIds: accountIds.sort() };
}
