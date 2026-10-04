import { BadRequestException } from '@nestjs/common';
import { parseAsOf } from './input';
import { parseDerivedTradePageQuery, type TradePageQuery } from './trade-input';

export interface HistoricalQuery extends TradePageQuery {
  at: string;
}

export function parseHistoricalQuery(input: unknown): HistoricalQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid accounting input');
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(input).some((key) => !['at', 'offset', 'limit', 'journalRevision'].includes(key))
  )
    throw new BadRequestException('Invalid accounting input');
  const { at, ...page } = input as Record<string, unknown>;
  return { at: parseAsOf(at), ...parseDerivedTradePageQuery(page) };
}
