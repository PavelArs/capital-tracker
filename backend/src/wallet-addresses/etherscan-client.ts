import axios from 'axios';
import type { StepFailure } from './chain-sync';

// Etherscan's free API (Q6): one key, Ethereum mainnet through the V2 endpoint. Lists are read
// oldest first between two block numbers, at most PAGE_SIZE items per request.
export const ETHERSCAN_PAGE_SIZE = 1000;
const DEFAULT_BASE_URL = 'https://api.etherscan.io/v2/api';
const MAINNET = '1';
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_UNIX_SECONDS = 253402300799;

/** A transaction the address sent or received (action txlist). */
export interface NormalTransaction {
  hash: string;
  blockNumber: number;
  timeStamp: number;
  blockHash: string;
  from: string;
  /** Empty for a contract creation. */
  to: string;
  value: bigint;
  /** What the sender paid for gas, in wei. */
  fee: bigint;
  /** A reverted transaction moves no value; its sender still pays the fee. */
  failed: boolean;
  raw: Record<string, unknown>;
}
/** Ether a contract moved to or from the address inside a transaction (txlistinternal). */
export interface InternalTransfer {
  hash: string;
  blockNumber: number;
  timeStamp: number;
  from: string;
  to: string;
  value: bigint;
  failed: boolean;
  raw: Record<string, unknown>;
}
/** One ERC-20 Transfer event to or from the address (tokentx). */
export interface TokenTransfer {
  hash: string;
  blockNumber: number;
  timeStamp: number;
  blockHash: string;
  /** The event's position in its block, when the provider reports it. */
  logIndex: number | null;
  contract: string;
  from: string;
  to: string;
  value: bigint;
  raw: Record<string, unknown>;
}

export type ListResult<T> = { ok: true; items: T[] } | { ok: false; reason: StepFailure };
export type BlockResult = { ok: true; block: number } | { ok: false; reason: StepFailure };
/** What a read-only contract call returned; null when the call reverted. */
export type CallResult = { ok: true; data: string | null } | { ok: false; reason: StepFailure };

class InvalidResponse extends Error {}
class Refused extends Error {
  constructor(readonly reason: StepFailure) {
    super(reason);
  }
}

const hashPattern = /^0x[0-9a-f]{64}$/;
const addressPattern = /^0x[0-9a-f]{40}$/;
function invalid(): never {
  throw new InvalidResponse();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}
function hash(value: unknown): string {
  const lower = text(value).toLowerCase();
  return hashPattern.test(lower) ? lower : invalid();
}
function address(value: unknown, allowEmpty = false): string {
  const lower = text(value).toLowerCase();
  if (allowEmpty && lower === '') return '';
  return addressPattern.test(lower) ? lower : invalid();
}
function units(value: unknown): bigint {
  const digits = text(value);
  return /^(0|[1-9][0-9]{0,77})$/.test(digits) ? BigInt(digits) : invalid();
}
function integer(value: unknown, maximum: number): number {
  const digits = text(value);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(digits)) return invalid();
  const number = Number(digits);
  return number <= maximum ? number : invalid();
}
function flag(value: unknown): boolean {
  const digits = text(value);
  return digits === '1' ? true : digits === '0' || digits === '' ? false : invalid();
}
const block = (value: unknown) => integer(value, 2 ** 31 - 1);
const time = (value: unknown) => integer(value, MAX_UNIX_SECONDS);

export function parseNormal(value: unknown): NormalTransaction {
  const item = record(value);
  return {
    hash: hash(item.hash),
    blockNumber: block(item.blockNumber),
    timeStamp: time(item.timeStamp),
    blockHash: hash(item.blockHash),
    from: address(item.from),
    to: address(item.to, true),
    value: units(item.value),
    fee: units(item.gasUsed) * units(item.gasPrice),
    failed: flag(item.isError),
    raw: item,
  };
}

export function parseInternal(value: unknown): InternalTransfer {
  const item = record(value);
  return {
    hash: hash(item.hash),
    blockNumber: block(item.blockNumber),
    timeStamp: time(item.timeStamp),
    from: address(item.from),
    to: address(item.to, true),
    value: units(item.value),
    failed: flag(item.isError),
    raw: item,
  };
}

export function parseToken(value: unknown): TokenTransfer {
  const item = record(value);
  return {
    hash: hash(item.hash),
    blockNumber: block(item.blockNumber),
    timeStamp: time(item.timeStamp),
    blockHash: hash(item.blockHash),
    logIndex: item.logIndex === undefined ? null : integer(item.logIndex, 999_999_999),
    contract: address(item.contractAddress),
    from: address(item.from),
    to: address(item.to, true),
    value: units(item.value),
    raw: item,
  };
}

/**
 * Etherscan answers HTTP 200 with status "0" both for an empty list and for a refusal; the
 * message and result tell them apart.
 */
export function parseList<T>(body: unknown, parse: (item: unknown) => T): T[] {
  const envelope = record(body);
  const { status, message, result } = envelope;
  if (status === '1' && Array.isArray(result)) {
    if (result.length > ETHERSCAN_PAGE_SIZE) invalid();
    return result.map(parse);
  }
  if (status !== '0') return invalid();
  if (
    Array.isArray(result) &&
    result.length === 0 &&
    /^No (transactions|records) found/i.test(text(message))
  )
    return [];
  throw refusal(result);
}

function refusal(result: unknown): Refused | InvalidResponse {
  if (typeof result !== 'string') return new InvalidResponse();
  if (/rate limit/i.test(result)) return new Refused('rate_limited');
  if (/api ?key/i.test(result)) return new Refused('not_configured');
  return new Refused('unavailable');
}

/** The newest block number (proxy eth_blockNumber). */
export function parseBlockNumber(body: unknown): number {
  const envelope = record(body);
  if (typeof envelope.result === 'string' && /^0x[0-9a-f]{1,8}$/i.test(envelope.result)) {
    const number = Number.parseInt(envelope.result, 16);
    return number < 2 ** 31 ? number : invalid();
  }
  if (envelope.status === '0') throw refusal(envelope.result);
  return invalid();
}

// A contract's answer to one view call: a few words, never a page of data.
const MAX_CALL_HEX = 2 + 64 * 64;

/**
 * The answer to proxy eth_call: the returned bytes as hex, or null when the contract reverted
 * (it has no such function). A refusal reads as in the lists.
 */
export function parseCall(body: unknown): string | null {
  const envelope = record(body);
  const { result, error } = envelope;
  if (
    typeof result === 'string' &&
    result.length <= MAX_CALL_HEX &&
    /^0x([0-9a-f]{2})*$/i.test(result)
  )
    return result.toLowerCase();
  if (error !== undefined) {
    return /revert/i.test(text(record(error).message)) ? null : invalid();
  }
  if (envelope.status === '0') throw refusal(result);
  return invalid();
}

export class EtherscanClient {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;

  constructor(
    options: {
      apiKey?: string | null;
      baseUrl?: string;
      timeoutMs?: number;
      pauseMs?: number;
    } = {},
  ) {
    this.apiKey = options.apiKey?.trim() || null;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    // The free plan allows three calls a second (docs/provider-feasibility.md).
    this.pauseMs = options.pauseMs ?? 400;
  }

  /** Without a key nothing is requested: the wallet reports what the server misses. */
  get configured(): boolean {
    return this.apiKey !== null;
  }

  blockNumber(): Promise<BlockResult> {
    return this.get({ module: 'proxy', action: 'eth_blockNumber' }, (body) => ({
      ok: true,
      block: parseBlockNumber(body),
    }));
  }

  /** A read-only call of `to` with `data` as of the given block (proxy eth_call). */
  call(to: string, data: string, block: number): Promise<CallResult> {
    return this.get(
      { module: 'proxy', action: 'eth_call', to, data, tag: `0x${block.toString(16)}` },
      (body) => ({ ok: true, data: parseCall(body) }),
    );
  }

  normal(address: string, from: number, to: number): Promise<ListResult<NormalTransaction>> {
    return this.list('txlist', address, from, to, parseNormal);
  }

  internal(address: string, from: number, to: number): Promise<ListResult<InternalTransfer>> {
    return this.list('txlistinternal', address, from, to, parseInternal);
  }

  tokens(address: string, from: number, to: number): Promise<ListResult<TokenTransfer>> {
    return this.list('tokentx', address, from, to, parseToken);
  }

  private list<T>(
    action: string,
    address: string,
    from: number,
    to: number,
    parse: (item: unknown) => T,
  ): Promise<ListResult<T>> {
    return this.get(
      {
        module: 'account',
        action,
        address,
        startblock: String(from),
        endblock: String(to),
        page: '1',
        offset: String(ETHERSCAN_PAGE_SIZE),
        sort: 'asc',
      },
      (body) => ({ ok: true, items: parseList(body, parse) }),
    );
  }

  private async get<T>(
    params: Record<string, string>,
    parse: (body: unknown) => T,
  ): Promise<T | { ok: false; reason: StepFailure }> {
    if (!this.apiKey) return { ok: false, reason: 'not_configured' };
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string };
    try {
      response = await axios.get<string>(this.baseUrl, {
        params: { chainid: MAINNET, ...params, apikey: this.apiKey },
        // axios' timeout is an idle timeout; the signal bounds the whole response.
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        headers: { Accept: 'application/json' },
      });
    } catch {
      return { ok: false, reason: 'unavailable' };
    } finally {
      this.lastRequestAt = Date.now();
    }
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      return parse(JSON.parse(response.data));
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason };
      return { ok: false, reason: 'invalid_response' };
    }
  }
}
