import axios from 'axios';
import type { StepFailure } from './chain-sync';
import { base58Bytes } from './solana-address';

// The public Solana mainnet JSON-RPC endpoint (no key, Q7). Its published limits are 100
// requests per 10 seconds per IP and 40 per method, so calls are spaced; history is read only
// at "finalized" commitment, so a stored transaction is never replaced.
export const SOLANA_SIGNATURE_PAGE_SIZE = 1000;
const DEFAULT_URL = 'https://api.mainnet-beta.solana.com';
const COMMITMENT = 'finalized';
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_UNIX_SECONDS = 253402300799;

/** One entry of getSignaturesForAddress, newest first. */
export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
}

/** One SPL token account balance before or after a transaction. */
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  /** The wallet that owns the token account; older transactions may not report it. */
  owner: string | null;
  amount: bigint;
}

/** What getTransaction reports about a finalized transaction, in lamports and token units. */
export interface SolanaTransaction {
  signature: string;
  slot: number;
  blockTime: number;
  /** The fee its first signer (the fee payer) paid, also for a failed transaction. */
  fee: bigint;
  failed: boolean;
  /** Every account of the transaction in balance order, loaded lookup-table ones included. */
  accounts: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  raw: Record<string, unknown>;
}

type Failure = { ok: false; reason: StepFailure };
export type SlotResult = { ok: true; slot: number } | Failure;
export type AccountsResult = { ok: true; accounts: string[] } | Failure;
export type SignaturesResult = { ok: true; items: SignatureInfo[] } | Failure;
export type TransactionResult = { ok: true; transaction: SolanaTransaction } | Failure;
export type EpochResult = { ok: true; epoch: bigint } | Failure;
/** Each requested account's "jsonParsed" value in request order; null for a closed one. */
export type AccountValuesResult = { ok: true; values: unknown[] } | Failure;
/** The slot of the newest finalized transaction naming the address; null when none does. */
export type NewestSlotResult = { ok: true; slot: number | null } | Failure;

/** Accounts per getMultipleAccounts call, the method's own limit. */
export const SOLANA_ACCOUNTS_PER_CALL = 100;

class InvalidResponse extends Error {}
class Refused extends Error {
  constructor(readonly reason: StepFailure) {
    super(reason);
  }
}

function invalid(): never {
  throw new InvalidResponse();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid();
}
function integer(value: unknown, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : invalid();
}
const slot = (value: unknown) => integer(value, 2 ** 31 - 1);
const time = (value: unknown) => integer(value, MAX_UNIX_SECONDS);
const lamports = (value: unknown) => BigInt(integer(value, Number.MAX_SAFE_INTEGER));
function key(value: unknown): string {
  return typeof value === 'string' && base58Bytes(value)?.length === 32 ? value : invalid();
}
function signature(value: unknown): string {
  return typeof value === 'string' &&
    /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) &&
    base58Bytes(value)?.length === 64
    ? value
    : invalid();
}

/** A JSON-RPC answer's result, or the refusal it carries. */
export function rpcResult(body: unknown): unknown {
  const envelope = record(body);
  if (envelope.error !== undefined) {
    const error = record(envelope.error);
    const message = typeof error.message === 'string' ? error.message : '';
    if (error.code === 429 || /rate limit|too many requests/i.test(message))
      throw new Refused('rate_limited');
    throw new Refused('unavailable');
  }
  return 'result' in envelope ? envelope.result : invalid();
}

export function parseSignatures(result: unknown): SignatureInfo[] {
  const items = list(result);
  if (items.length > SOLANA_SIGNATURE_PAGE_SIZE) invalid();
  return items.map((value) => {
    const item = record(value);
    return {
      signature: signature(item.signature),
      slot: slot(item.slot),
      blockTime:
        item.blockTime === null || item.blockTime === undefined ? null : time(item.blockTime),
    };
  });
}

export function parseTokenAccounts(result: unknown): string[] {
  return list(record(result).value).map((item) => key(record(item).pubkey));
}

function tokenBalances(value: unknown, accounts: number): TokenBalance[] {
  if (value === null || value === undefined) return [];
  return list(value).map((entry) => {
    const item = record(entry);
    const amount = record(item.uiTokenAmount).amount;
    if (typeof amount !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(amount)) invalid();
    const accountIndex = integer(item.accountIndex, accounts - 1);
    return {
      accountIndex,
      mint: key(item.mint),
      owner: item.owner === undefined || item.owner === null ? null : key(item.owner),
      amount: BigInt(amount),
    };
  });
}

/** getTransaction with "json" encoding: account keys as text, balances in lamports. */
export function parseTransaction(result: unknown, expected: string): SolanaTransaction {
  const item = record(result);
  const meta = record(item.meta);
  const message = record(record(item.transaction).message);
  const signatures = list(record(item.transaction).signatures).map(signature);
  if (!signatures.includes(expected)) invalid();
  const loaded =
    meta.loadedAddresses === undefined || meta.loadedAddresses === null
      ? { writable: [], readonly: [] }
      : record(meta.loadedAddresses);
  const accounts = [
    ...list(message.accountKeys),
    ...list(loaded.writable ?? []),
    ...list(loaded.readonly ?? []),
  ].map(key);
  const preBalances = list(meta.preBalances).map(lamports);
  const postBalances = list(meta.postBalances).map(lamports);
  if (
    accounts.length === 0 ||
    preBalances.length !== accounts.length ||
    postBalances.length !== accounts.length
  )
    invalid();
  return {
    signature: expected,
    slot: slot(item.slot),
    blockTime: time(item.blockTime),
    fee: lamports(meta.fee),
    failed: meta.err !== null && meta.err !== undefined,
    accounts,
    preBalances,
    postBalances,
    preTokenBalances: tokenBalances(meta.preTokenBalances, accounts.length),
    postTokenBalances: tokenBalances(meta.postTokenBalances, accounts.length),
    raw: item,
  };
}

export function parseEpoch(result: unknown): bigint {
  return BigInt(integer(record(result).epoch, Number.MAX_SAFE_INTEGER));
}

export function parseAccountValues(result: unknown, count: number): unknown[] {
  const values = list(record(result).value);
  if (values.length !== count) invalid();
  return values;
}

export class SolanaRpcClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;

  constructor(options: { url?: string; timeoutMs?: number; pauseMs?: number } = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // At most 40 calls of one method in 10 seconds (docs/provider-feasibility.md).
    this.pauseMs = options.pauseMs ?? 300;
  }

  /** The newest finalized slot. */
  slot(): Promise<SlotResult> {
    return this.call('getSlot', [{ commitment: COMMITMENT }], (result) => ({
      ok: true,
      slot: slot(result),
    }));
  }

  /** The wallet's token accounts of one mint; their history is not the wallet's own. */
  tokenAccounts(owner: string, mint: string): Promise<AccountsResult> {
    return this.call(
      'getTokenAccountsByOwner',
      [
        owner,
        { mint },
        { commitment: COMMITMENT, encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
      ],
      (result) => ({ ok: true, accounts: parseTokenAccounts(result) }),
    );
  }

  /** Signatures that touched the address, newest first, older than `before` when given. */
  signatures(address: string, before: string | null): Promise<SignaturesResult> {
    return this.call(
      'getSignaturesForAddress',
      [
        address,
        {
          commitment: COMMITMENT,
          limit: SOLANA_SIGNATURE_PAGE_SIZE,
          ...(before ? { before } : {}),
        },
      ],
      (result) => ({ ok: true, items: parseSignatures(result) }),
    );
  }

  /** A finalized transaction; one the node no longer keeps is unavailable, never empty. */
  transaction(value: string): Promise<TransactionResult> {
    return this.call(
      'getTransaction',
      [value, { commitment: COMMITMENT, encoding: 'json', maxSupportedTransactionVersion: 0 }],
      (result) => {
        if (result === null) throw new Refused('unavailable');
        return { ok: true, transaction: parseTransaction(result, value) };
      },
    );
  }

  /** The epoch of the newest finalized slot. */
  epoch(): Promise<EpochResult> {
    return this.call('getEpochInfo', [{ commitment: COMMITMENT }], (result) => ({
      ok: true,
      epoch: parseEpoch(result),
    }));
  }

  /** Accounts as the RPC parses them (stake accounts read as such); at most 100 per call. */
  accounts(keys: readonly string[]): Promise<AccountValuesResult> {
    if (keys.length === 0 || keys.length > SOLANA_ACCOUNTS_PER_CALL)
      throw new Error('Account batch out of range');
    return this.call(
      'getMultipleAccounts',
      [keys, { commitment: COMMITMENT, encoding: 'jsonParsed' }],
      (result) => ({ ok: true, values: parseAccountValues(result, keys.length) }),
    );
  }

  /** Only the newest signature of an address: has anything touched it since a slot? */
  newestSlot(address: string): Promise<NewestSlotResult> {
    return this.call(
      'getSignaturesForAddress',
      [address, { commitment: COMMITMENT, limit: 1 }],
      (result) => {
        const items = parseSignatures(result);
        return { ok: true, slot: items.length === 0 ? null : items[0].slot };
      },
    );
  }

  private async call<T>(
    method: string,
    params: unknown[],
    parse: (result: unknown) => T,
  ): Promise<T | Failure> {
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string };
    try {
      response = await axios.post<string>(
        this.url,
        { jsonrpc: '2.0', id: 1, method, params },
        {
          // axios' timeout is an idle timeout; the signal bounds the whole response.
          timeout: this.timeoutMs,
          signal: AbortSignal.timeout(this.timeoutMs),
          maxRedirects: 0,
          maxContentLength: MAX_BODY_BYTES,
          responseType: 'text',
          transformResponse: [(data: string) => data],
          validateStatus: () => true,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        },
      );
    } catch {
      return { ok: false, reason: 'unavailable' };
    } finally {
      this.lastRequestAt = Date.now();
    }
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      return parse(rpcResult(JSON.parse(response.data)));
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason };
      return { ok: false, reason: 'invalid_response' };
    }
  }
}
