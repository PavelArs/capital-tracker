import axios from 'axios';
import type { StepFailure } from './chain-sync';

// Etherscan's free API (Q6): one key, any chain it lists through the V2 endpoint's `chainid`
// (mainnet unless told otherwise). Lists are read oldest first between two block numbers, at
// most PAGE_SIZE items per request.
export const ETHERSCAN_PAGE_SIZE = 1000;
const DEFAULT_BASE_URL = 'https://api.etherscan.io/v2/api';
const MAINNET = 1;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 2;
// BLOCKSCOUT-KEY: Blockscout's own multi-chain API, which asks for a free key and takes the chain as a
// parameter. A public explorer answers 429 (OP Mainnet) or 403 (Base) to requests without one.
const BLOCKSCOUT_PRO_URL = 'https://api.blockscout.com/v2/api';
// A reset time above a day is not a duration (some APIs send a clock time instead).
const MAX_RESET_MS = 24 * 60 * 60_000;
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

/** Why a read failed, and (SYNC-DETAIL) what the source itself said, for the owner's message. */
export type Failed = { ok: false; reason: StepFailure; detail?: string };
export type ListResult<T> = { ok: true; items: T[] } | Failed;
export type BlockResult = { ok: true; block: number } | Failed;
/** What a read-only contract call returned; null when the call reverted. */
export type CallResult = { ok: true; data: string | null } | Failed;

class InvalidResponse extends Error {}
class Refused extends Error {
  constructor(
    readonly reason: StepFailure,
    readonly said?: string,
  ) {
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
    // Blockscout names the transaction an internal transfer belongs to `transactionHash`.
    hash: hash(item.hash ?? item.transactionHash),
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
  // BLOCKSCOUT: status "2" says the explorer has not indexed some internal transfers of this range
  // yet. An empty list here would lose them for good once the scan moves on, so the pass stops and
  // asks again later instead of reading it as "none".
  if (status === '2' && /not yet been processed/i.test(text(message)))
    throw new Refused('unavailable', said(text(message)));
  if (status !== '0') return invalid();
  // An empty range: Etherscan says "No transactions found"; Blockscout names what is missing, as
  // in "No token transfers found" or "No internal transactions found".
  if (Array.isArray(result) && result.length === 0 && /^No [a-z ]+ found/i.test(text(message)))
    return [];
  throw refusal(result);
}

/** A refusal's words as shown to the owner: one short line, with anything address-like cut out. */
function said(result: string): string {
  return (
    result
      .replace(/0x[0-9a-f]{6,}/gi, '0x…')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is stripped
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, 80)
  );
}

function refusal(result: unknown): Refused | InvalidResponse {
  if (typeof result !== 'string') return new InvalidResponse();
  // Etherscan's own words for a chain outside the free plan (docs.etherscan.io, common errors).
  if (/free api access is not supported|upgrade your api plan/i.test(result))
    return new Refused('plan_required');
  if (/rate limit/i.test(result)) return new Refused('rate_limited');
  if (/api ?key/i.test(result)) return new Refused('not_configured');
  return new Refused('unavailable', said(result));
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

interface ClientOptions {
  apiKey?: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  pauseMs?: number;
  chainId?: number;
  /** BLOCKSCOUT: another explorer answering Etherscan's calls: no key, no `chainid`. */
  keyless?: boolean;
  /** BLOCKSCOUT-KEY: the free Blockscout key; with it a chain is read through Blockscout's PRO API. */
  blockscoutKey?: string | null;
  /** BLOCKSCOUT-KEY: where that PRO API answers (the tests point it at a local server). */
  proUrl?: string;
  /** BLOCKSCOUT-KEY: parameters sent with every call of a keyless client (the chain and the key). */
  extraParams?: Record<string, string>;
}

export class EtherscanClient {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private readonly chainId: number;
  private readonly keyless: boolean;
  private readonly blockscoutKey: string | null;
  private readonly proUrl: string;
  private readonly extraParams: Record<string, string> | null;
  // The key's rate limit is shared by every chain, so the views of one client share the pause.
  private readonly pace: { lastRequestAt: number };

  constructor(options: ClientOptions = {}, pace: { lastRequestAt: number } = { lastRequestAt: 0 }) {
    this.apiKey = options.apiKey?.trim() || null;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    // The free plan allows three calls a second (docs/provider-feasibility.md).
    this.pauseMs = options.pauseMs ?? 400;
    this.chainId = options.chainId ?? MAINNET;
    this.keyless = options.keyless ?? false;
    this.blockscoutKey = options.blockscoutKey?.trim() || null;
    this.proUrl = options.proUrl ?? BLOCKSCOUT_PRO_URL;
    this.extraParams = options.extraParams ?? null;
    this.pace = pace;
  }

  /**
   * BLOCKSCOUT: the same questions put to a chain's Blockscout explorer (`baseUrl` ends in /api),
   * which needs no key. It paces itself: its limit is its own. BLOCKSCOUT-KEY: with the free
   * Blockscout key set, the chain is read through Blockscout's PRO API instead, whose limits are
   * the key's, not the public explorer's.
   */
  blockscout(baseUrl: string, chainId?: number): EtherscanClient {
    const pro = this.blockscoutKey !== null && chainId !== undefined;
    return new EtherscanClient({
      baseUrl: pro ? this.proUrl : baseUrl,
      keyless: true,
      timeoutMs: this.timeoutMs,
      pauseMs: this.pauseMs,
      // The PRO API names the chain `chain_id` in its own guide and `chainid` in some pages: both go.
      ...(pro
        ? {
            extraParams: {
              chain_id: String(chainId),
              chainid: String(chainId),
              apikey: this.blockscoutKey as string,
            },
          }
        : {}),
    });
  }

  /** EVM-MULTICHAIN: the same key and pacing, reading another chain of Etherscan's V2 API. */
  forChain(chainId: number): EtherscanClient {
    return new EtherscanClient(
      {
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        timeoutMs: this.timeoutMs,
        pauseMs: this.pauseMs,
        chainId,
      },
      this.pace,
    );
  }

  /** Without a key nothing is requested: the wallet reports what the server misses. */
  get configured(): boolean {
    return this.keyless || this.apiKey !== null;
  }

  blockNumber(): Promise<BlockResult> {
    const params = this.keyless
      ? { module: 'block', action: 'eth_block_number' }
      : { module: 'proxy', action: 'eth_blockNumber' };
    return this.get(params, (body) => ({
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

  /** The source's host name, which names it in what the owner reads. */
  private get host(): string {
    try {
      return new URL(this.baseUrl).hostname;
    } catch {
      return 'The data source';
    }
  }

  /**
   * RATE-LIMIT: what a 429 says. A public Blockscout explorer counts requests without a key and
   * names the time its limit lifts in x-ratelimit-reset (milliseconds); retry-after is in seconds.
   */
  private limitDetail(headers: unknown): string {
    const header = (name: string): number | null => {
      const value = (headers as Record<string, unknown> | undefined)?.[name];
      const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const seconds = header('retry-after');
    const reset = header('x-ratelimit-reset');
    const ms = seconds !== null ? seconds * 1000 : reset;
    const lifts =
      ms !== null && ms > 0 && ms <= MAX_RESET_MS
        ? `, its limit lifts in about ${Math.max(1, Math.ceil(ms / 60_000))} min`
        : '';
    const key =
      this.keyless && this.extraParams === null ? ' without a key (BLOCKSCOUT_API_KEY)' : '';
    return `${this.host} limits requests${key}${lifts}`;
  }

  private async get<T>(
    params: Record<string, string>,
    parse: (body: unknown) => T,
  ): Promise<T | Failed> {
    if (!this.configured) return { ok: false, reason: 'not_configured' };
    const wait = this.pace.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string; headers: unknown };
    // REDIRECT: an explorer may answer with a redirect (301) to the same address in another form.
    // Only one that stays on the same host and scheme is followed; a request carries the key in
    // its query, so it never goes to another host.
    const origin = new URL(this.baseUrl);
    let movedTo: string | null = null;
    try {
      response = await axios.get<string>(this.baseUrl, {
        params: this.keyless
          ? { ...this.extraParams, ...params }
          : { chainid: String(this.chainId), ...params, apikey: this.apiKey },
        // axios' timeout is an idle timeout; the signal bounds the whole response.
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: MAX_REDIRECTS,
        beforeRedirect: (options: {
          protocol?: string;
          hostname?: string;
          port?: string | number;
        }) => {
          const port = String(options.port ?? '');
          const same =
            options.protocol === origin.protocol &&
            options.hostname === origin.hostname &&
            (port === origin.port || (origin.port === '' && ['', '80', '443'].includes(port)));
          if (!same) {
            movedTo = options.hostname ?? null;
            throw new Error('Redirected to another host');
          }
        },
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (movedTo !== null) {
        const target = said(movedTo);
        return { ok: false, reason: 'unavailable', detail: `${this.host} moved to ${target}` };
      }
      const code = axios.isAxiosError(error) && error.code ? ` (${error.code})` : '';
      return { ok: false, reason: 'unavailable', detail: `${this.host} did not answer${code}` };
    } finally {
      this.pace.lastRequestAt = Date.now();
    }
    if (response.status === 429) {
      return { ok: false, reason: 'rate_limited', detail: this.limitDetail(response.headers) };
    }
    if (response.status !== 200) {
      return {
        ok: false,
        reason: 'unavailable',
        detail: `${this.host} answered HTTP ${response.status}`,
      };
    }
    try {
      return parse(JSON.parse(response.data));
    } catch (error) {
      if (error instanceof Refused) {
        const detail = error.said ? `${this.host} said: ${error.said}` : undefined;
        return { ok: false, reason: error.reason, ...(detail ? { detail } : {}) };
      }
      return {
        ok: false,
        reason: 'invalid_response',
        detail: `${this.host} sent an unexpected answer`,
      };
    }
  }
}
