import { BadRequestException } from '@nestjs/common';
import { parseUuid } from '../accounting/input';
import { normalizeBitcoinAddress } from './bitcoin-address';
import { isExtendedKey, normalizeExtendedKey } from './bitcoin-xpub';
import type { BybitCredentials } from './bybit-client';
import { isApiKey, isApiSecret } from './bybit-key-box';
import { isBybitCoin, isNetwork, type Network } from './chain-assets';
import { normalizeEthereumAddress } from './ethereum-address';
import { normalizeSolanaAddress } from './solana-address';
import { normalizeStellarAddress } from './stellar-address';
import { normalizeTronAddress } from './tron-address';
import { normalizeZcashAddress } from './zcash-address';

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
  network: Exclude<Network, 'bybit'>;
  address: string;
  accountId: string | null;
  label: string | null;
}
/** BYBIT-KEY (M22): an exchange account is added by its read-only API key, not an address. */
export interface ExchangeRegistration {
  network: 'bybit';
  credentials: BybitCredentials;
  accountId: string | null;
  label: string | null;
}

const normalizers: Record<Exclude<Network, 'bybit'>, (value: unknown) => string> = {
  // One address, or an account public key that stands for all of its addresses (M21).
  bitcoin: (value) =>
    isExtendedKey(value) ? normalizeExtendedKey(value) : normalizeBitcoinAddress(value),
  ethereum: normalizeEthereumAddress,
  base: normalizeEthereumAddress,
  arbitrum: normalizeEthereumAddress,
  optimism: normalizeEthereumAddress,
  polygon: normalizeEthereumAddress,
  bnb: normalizeEthereumAddress,
  avalanche: normalizeEthereumAddress,
  solana: normalizeSolanaAddress,
  tron: normalizeTronAddress,
  stellar: normalizeStellarAddress,
  zcash: normalizeZcashAddress,
};

// Bitcoin (the default of the legacy body), Ethereum (M14), Solana (M15), Bybit (M22), Tron and
// Stellar (M23), Zcash (M24).
export function parseRegistration(raw: unknown): Registration | ExchangeRegistration {
  if ((raw as Record<string, unknown> | null)?.network === 'bybit') {
    const row = object(raw, ['network', 'apiKey', 'apiSecret', 'accountId', 'label']);
    // Surrounding spaces from a copy are dropped; anything else must be exactly the key.
    const apiKey = typeof row.apiKey === 'string' ? row.apiKey.trim() : row.apiKey;
    const apiSecret = typeof row.apiSecret === 'string' ? row.apiSecret.trim() : row.apiSecret;
    if (!isApiKey(apiKey) || !isApiSecret(apiSecret)) return bad();
    return {
      network: 'bybit',
      credentials: { apiKey, apiSecret },
      accountId: account(row.accountId),
      label: label(row.label),
    };
  }
  const row = object(raw, ['network', 'address', 'accountId', 'label']);
  const network = row.network ?? 'bitcoin';
  if (!isNetwork(network) || network === 'bybit') return bad();
  return {
    network,
    address: normalizers[network](row.address),
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

export interface TokenVisibility {
  tickers: string[];
  visibility: 'hidden' | 'shown';
}

export const TOKENS_AT_ONCE = 200;

/** TOKEN-HIDE: tickers of other tokens, and whether the address's balances leave them out. */
export function parseTokenVisibility(raw: unknown): TokenVisibility {
  const row = object(raw, ['tickers', 'visibility']);
  const { tickers, visibility } = row;
  if (visibility !== 'hidden' && visibility !== 'shown') return bad();
  if (!Array.isArray(tickers) || tickers.length < 1 || tickers.length > TOKENS_AT_ONCE)
    return bad();
  if (!tickers.every((ticker) => typeof ticker === 'string' && /^[A-Z0-9]{1,16}$/.test(ticker)))
    return bad();
  return { tickers: [...new Set(tickers as string[])], visibility };
}

export function parseTransactionQuery(raw: unknown): { offset: number; limit: number } {
  const row = object(raw ?? {}, ['offset', 'limit']);
  return {
    offset: queryInteger(row.offset, 0, 0, 1_000_000),
    limit: queryInteger(row.limit, 50, 1, 100),
  };
}

/** BYBIT-COUNT-GAP: one coin's difference between Bybit's balance and the account's records. */
export interface BalanceGap {
  requestId: string;
  coin: string;
  direction: 'in' | 'out';
  /** The difference, positive, in the coin. */
  quantity: string;
  /** The balance Bybit reported when the owner saw the difference. */
  reported: string;
}

const AMOUNT = /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,18})?$/;

export function parseBalanceGap(raw: unknown): BalanceGap {
  const row = object(raw, ['requestId', 'coin', 'direction', 'quantity', 'reported']);
  const { coin, direction, quantity, reported } = row;
  if (typeof coin !== 'string' || !isBybitCoin(coin)) return bad();
  if (direction !== 'in' && direction !== 'out') return bad();
  if (typeof quantity !== 'string' || !AMOUNT.test(quantity) || !/[1-9]/.test(quantity))
    return bad();
  if (typeof reported !== 'string' || !AMOUNT.test(reported)) return bad();
  return { requestId: parseUuid(row.requestId), coin, direction, quantity, reported };
}
