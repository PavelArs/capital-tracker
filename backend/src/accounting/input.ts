import { BadRequestException } from '@nestjs/common';
import {
  type AssetType,
  assetTypes,
  type ValuationCurrency,
  valuationCurrencies,
} from './asset-classification';

/** W1: how the owner holds the coins of a wallet. */
export const walletKinds = ['software', 'hardware', 'exchange'] as const;
export type WalletKind = (typeof walletKinds)[number];

export interface AccountInput {
  requestId: string;
  name: string;
  /** Present only when sent, so a body without it keeps its exact shape. */
  kind?: WalletKind;
}
export interface InstrumentInput extends AccountInput {
  symbol: string | null;
  assetType?: AssetType;
  valuationCurrency?: ValuationCurrency;
}
export interface PositionInput {
  instrumentId: string;
  quantity: string;
  costStatus: 'known' | 'unknown';
  totalCostUsd: string | null;
}
export interface OpeningInput {
  requestId: string;
  expectedRevision: number;
  asOf: string;
  positions: PositionInput[];
}
export interface ListQuery {
  cursor?: string;
  limit: number;
}
export interface HistoryQuery {
  beforeRevision?: number;
  limit: number;
}
const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  if (Object.keys(input).some((key) => !keys.includes(key))) return bad();
  return input as Record<string, unknown>;
}
function label(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return bad();
  const text = value.trim();
  if (!text || Array.from(text).length > maximum || Buffer.from(text).toString('utf8') !== text)
    return bad();
  return text;
}
export function parseUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    return bad();
  return value.toLowerCase();
}
export function parseDecimal(value: unknown, positive: boolean): string {
  if (typeof value !== 'string' || value.length > 256 || !/^[0-9]+(?:\.[0-9]+)?$/.test(value))
    return bad();
  const [whole, fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+/, '') || '0';
  if (integer.length > 48 || fraction.length > 30) return bad();
  const tail = fraction.replace(/0+$/, '');
  const result = tail ? `${integer}.${tail}` : integer;
  if (positive && result === '0') return bad();
  return result;
}
export function parseAsOf(value: unknown): string {
  if (typeof value !== 'string') return bad();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return bad();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1970 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return bad();
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0))
    return bad();
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1970 ||
    date.getUTCFullYear() > 9999
  )
    return bad();
  return date.toISOString();
}
export function parseAccount(input: unknown): AccountInput {
  const row = object(input, ['requestId', 'name', 'kind']);
  return {
    requestId: parseUuid(row.requestId),
    name: label(row.name, 120),
    ...(Object.hasOwn(row, 'kind') ? { kind: member(row.kind, walletKinds) } : {}),
  };
}
/**
 * WAL-RENAME, W1: the name and the kind of an account change; its id and history stay. A kind
 * of null takes the choice back; a body names at least one of the two.
 */
export function parseAccountChange(input: unknown): { name?: string; kind?: WalletKind | null } {
  const row = object(input, ['name', 'kind']);
  const has = (key: string) => Object.hasOwn(row, key);
  if (!has('name') && !has('kind')) return bad();
  return {
    ...(has('name') ? { name: label(row.name, 120) } : {}),
    ...(has('kind') ? { kind: row.kind === null ? null : member(row.kind, walletKinds) } : {}),
  };
}
function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  return allowed.find((item) => item === value) ?? bad();
}
export function parseInstrument(input: unknown): InstrumentInput {
  const row = object(input, ['requestId', 'name', 'symbol', 'assetType', 'valuationCurrency']);
  const has = (key: string) => Object.hasOwn(row, key);
  return {
    requestId: parseUuid(row.requestId),
    name: label(row.name, 120),
    symbol: has('symbol') ? label(row.symbol, 32) : null,
    // Present only when sent, so the legacy body keeps its exact shape (AST-LEGACY).
    ...(has('assetType') ? { assetType: member(row.assetType, assetTypes) } : {}),
    ...(has('valuationCurrency')
      ? { valuationCurrency: member(row.valuationCurrency, valuationCurrencies) }
      : {}),
  };
}
export function parseOpening(input: unknown): OpeningInput {
  const row = object(input, ['requestId', 'expectedRevision', 'asOf', 'positions']);
  if (
    typeof row.expectedRevision !== 'number' ||
    !Number.isInteger(row.expectedRevision) ||
    row.expectedRevision < 0 ||
    row.expectedRevision > 2147483646
  )
    return bad();
  if (!Array.isArray(row.positions) || row.positions.length < 1 || row.positions.length > 100)
    return bad();
  const positions = row.positions
    .map((value) => {
      const position = object(value, ['instrumentId', 'quantity', 'costStatus', 'totalCostUsd']);
      if (position.costStatus !== 'known' && position.costStatus !== 'unknown') return bad();
      if (position.costStatus === 'unknown' && position.totalCostUsd !== null) return bad();
      return {
        instrumentId: parseUuid(position.instrumentId),
        quantity: parseDecimal(position.quantity, true),
        costStatus: position.costStatus,
        totalCostUsd:
          position.costStatus === 'known' ? parseDecimal(position.totalCostUsd, false) : null,
      } as PositionInput;
    })
    .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
  if (new Set(positions.map((p) => p.instrumentId)).size !== positions.length) return bad();
  return {
    requestId: parseUuid(row.requestId),
    expectedRevision: row.expectedRevision,
    asOf: parseAsOf(row.asOf),
    positions,
  };
}
function queryInteger(value: unknown, max: number): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value)) return bad();
  const number = Number(value);
  if (number > max) return bad();
  return number;
}
export function parseListQuery(input: unknown): ListQuery {
  const row = object(input, ['cursor', 'limit']);
  return {
    ...(row.cursor === undefined ? {} : { cursor: parseUuid(row.cursor) }),
    limit: row.limit === undefined ? 50 : queryInteger(row.limit, 100),
  };
}
export function parseHistoryQuery(input: unknown): HistoryQuery {
  const row = object(input, ['beforeRevision', 'limit']);
  return {
    ...(row.beforeRevision === undefined
      ? {}
      : { beforeRevision: queryInteger(row.beforeRevision, 2147483647) }),
    limit: row.limit === undefined ? 10 : queryInteger(row.limit, 20),
  };
}
