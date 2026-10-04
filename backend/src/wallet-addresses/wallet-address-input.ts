import { BadRequestException } from '@nestjs/common';
import { normalizeBitcoinAddress } from './bitcoin-address';

function bad(): never {
  throw new BadRequestException('Invalid wallet address input');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Object.keys(input).some((key) => !keys.includes(key))) return bad();
  return input as Record<string, unknown>;
}
function queryInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,6})$/.test(value)) return bad();
  const number = Number(value);
  return number < minimum || number > maximum ? bad() : number;
}

export function parseRegistration(raw: unknown): { address: string } {
  const row = object(raw, ['address']);
  return { address: normalizeBitcoinAddress(row.address) };
}

export function parseTransactionQuery(raw: unknown): { offset: number; limit: number } {
  const row = object(raw ?? {}, ['offset', 'limit']);
  return {
    offset: queryInteger(row.offset, 0, 0, 1_000_000),
    limit: queryInteger(row.limit, 50, 1, 100),
  };
}

export function parseTxid(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : bad();
}

// The trade body stays opaque here: TradeService parses it exactly like a manual trade.
export function parseCompletion(raw: unknown): { accountId: unknown; trade: unknown } {
  const row = object(raw, ['accountId', 'trade']);
  return { accountId: row.accountId, trade: row.trade };
}
