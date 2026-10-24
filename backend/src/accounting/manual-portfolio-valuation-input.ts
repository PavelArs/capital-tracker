import { BadRequestException } from '@nestjs/common';
import { strictRecord } from '../shared/strict-input';
import { parseAsOf, parseUuid } from './input';

const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  return strictRecord(input, allowed) ?? bad();
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
