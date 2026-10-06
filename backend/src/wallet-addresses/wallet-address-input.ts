import { BadRequestException } from '@nestjs/common';
import { parseUuid } from '../accounting/input';
import { normalizeBitcoinAddress } from './bitcoin-address';
import type { Network } from './chain-assets';
import { normalizeEthereumAddress } from './ethereum-address';

export const LABEL_MAX_LENGTH = 40;

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
// A blank name is no name; the stored form is trimmed, one line and at most 40 characters.
function label(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return bad();
  const trimmed = value.trim();
  if (trimmed.length > LABEL_MAX_LENGTH || /\p{Cc}/u.test(trimmed)) return bad();
  return trimmed || null;
}
function account(value: unknown): string | null {
  return value === null || value === undefined ? null : parseUuid(value);
}

export interface Registration {
  network: Network;
  address: string;
  accountId: string | null;
  label: string | null;
}

// Bitcoin (the default of the legacy body) and Ethereum; Solana joins with its sync (M15).
export function parseRegistration(raw: unknown): Registration {
  const row = object(raw, ['network', 'address', 'accountId', 'label']);
  const network = row.network ?? 'bitcoin';
  if (network !== 'bitcoin' && network !== 'ethereum') return bad();
  return {
    network,
    address:
      network === 'bitcoin'
        ? normalizeBitcoinAddress(row.address)
        : normalizeEthereumAddress(row.address),
    accountId: account(row.accountId),
    label: label(row.label),
  };
}

export interface Update {
  accountId?: string | null;
  label?: string | null;
}

export function parseUpdate(raw: unknown): Update {
  const row = object(raw, ['accountId', 'label']);
  if (!('accountId' in row) && !('label' in row)) return bad();
  return {
    ...('accountId' in row ? { accountId: account(row.accountId) } : {}),
    ...('label' in row ? { label: label(row.label) } : {}),
  };
}

export function parseTransactionQuery(raw: unknown): { offset: number; limit: number } {
  const row = object(raw ?? {}, ['offset', 'limit']);
  return {
    offset: queryInteger(row.offset, 0, 0, 1_000_000),
    limit: queryInteger(row.limit, 50, 1, 100),
  };
}
