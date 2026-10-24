import { BadRequestException } from '@nestjs/common';
import { strictRecord } from '../shared/strict-input';
import { parseAsOf } from './input';
import { parseDerivedTradePageQuery, type TradePageQuery } from './trade-input';

export interface HistoricalQuery extends TradePageQuery {
  at: string;
}

export function parseHistoricalQuery(input: unknown): HistoricalQuery {
  const row = strictRecord(input, ['at', 'offset', 'limit', 'journalRevision']);
  if (!row) throw new BadRequestException('Invalid accounting input');
  const { at, ...page } = row;
  return { at: parseAsOf(at), ...parseDerivedTradePageQuery(page) };
}
