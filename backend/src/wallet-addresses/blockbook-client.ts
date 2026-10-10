import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { StepFailure } from './chain-sync';
import type { Direction } from './esplora-client';

// Blockbook (ZCASH-SYNC), the open-source indexer behind Trezor Suite. Trezor's public Zcash
// instances answer 403 to a server, so the app reads them only as a fallback without a key; a
// free NOWNodes key (ZCASH_BLOCKBOOK_API_KEY) points it at NOWNodes' Blockbook instead. It sees only the transparent part of a transaction: what
// t-addresses paid in and received. Amounts are strings in zatoshi (1 ZEC = 100 000 000).
//
// An address's history comes newest first in numbered pages. With a fixed block range the
// pages do not move while a walk reads them (ZCASH-SYNC), and like every other source here
// the pages stay short and every request takes a new connection (TRON-SYNC).
export const BLOCKBOOK_PAGE_SIZE = 10;
const TREZOR_BASE_URLS = ['https://zec1.trezor.io', 'https://zec5.trezor.io'];
const NOWNODES_BASE_URLS = ['https://zecbook.nownodes.io'];
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const LOGGED_CHARS = 160;
const ADDRESS_OR_HASH = /\bt[13][1-9A-HJ-NP-Za-km-z]{33}\b|\b[0-9a-fA-F]{64}\b/g;
const MAX_HEIGHT = 2 ** 31 - 1;
const MAX_UNIX_SECONDS = 253402300799;
// ZIP-317: 5 000 zatoshi per logical action, so even a 200-action transaction pays 0.01 ZEC.
// Blockbook has counted value moved to or from the shielded pool as fee; such a figure is
// not a fee the wallet paid.
export const MAX_ZCASH_FEE = 1_000_000n;

class InvalidResponse extends Error {}
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
function integer(value: unknown, minimum = 0, maximum = MAX_HEIGHT): number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? (value as number)
    : invalid();
}
/** A non-negative zatoshi amount string. */
export function zatoshi(value: unknown): bigint {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,24})$/.test(value)
    ? BigInt(value)
    : invalid();
}
function addresses(value: Record<string, unknown>): string[] {
  if (value.addresses === undefined || value.addresses === null) return [];
  return list(value.addresses).map((item) => (typeof item === 'string' ? item : invalid()));
}

/** What one confirmed transaction did to a transparent address. */
export interface ZcashLeg {
  txid: string;
  blockHeight: number;
  blockHash: string;
  blockTime: string;
  receivedUnits: bigint;
  /** Everything the address's inputs spent, the fee included. */
  sentUnits: bigint;
  feeUnits: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}

/**
 * ZCASH-IDENTITY: one leg per transaction under its txid. Its inputs and outputs at `address`
 * give the ZEC sent and received, as on Bitcoin. ZEC that left for or came from the shielded
 * pool shows only as the transparent side of that move.
 */
export function parseTransaction(address: string, value: unknown): ZcashLeg | null {
  const tx = record(value);
  const txid = typeof tx.txid === 'string' && /^[0-9a-f]{64}$/.test(tx.txid) ? tx.txid : invalid();
  // Unconfirmed transactions have height -1; the range of a walk never holds one.
  const blockHeight = integer(tx.blockHeight);
  const blockHash =
    typeof tx.blockHash === 'string' && /^[0-9a-f]{64}$/.test(tx.blockHash)
      ? tx.blockHash
      : invalid();
  const blockTime = new Date(integer(tx.blockTime, 1, MAX_UNIX_SECONDS) * 1000).toISOString();
  let received = 0n;
  let sent = 0n;
  let foreign = false;
  for (const output of list(tx.vout).map(record)) {
    const units = output.value === undefined ? 0n : zatoshi(output.value);
    const to = addresses(output);
    if (to.length === 1 && to[0] === address) received += units;
    else if (units > 0n) foreign = true;
  }
  let theirs = false;
  for (const input of list(tx.vin).map(record)) {
    // A coinbase input spends no previous output.
    if (input.coinbase !== undefined) continue;
    const from = addresses(input);
    const units = input.value === undefined ? 0n : zatoshi(input.value);
    if (from.length === 1 && from[0] === address) sent += units;
    else theirs = true;
  }
  if (received === 0n && sent === 0n) return null;
  // The wallet paid the fee when only its own inputs paid in.
  let fee = 0n;
  if (sent > 0n && !theirs && typeof tx.fees === 'string' && /^[0-9]{1,25}$/.test(tx.fees)) {
    const charged = BigInt(tx.fees);
    if (charged > 0n && charged <= MAX_ZCASH_FEE && charged <= sent) fee = charged;
  }
  // Self only when every transparent output came back and nothing but the fee went elsewhere,
  // so a move into the shielded pool stays a send.
  const self = sent > 0n && !foreign && fee > 0n && sent - received === fee;
  return {
    txid,
    blockHeight,
    blockHash,
    blockTime,
    receivedUnits: received,
    sentUnits: sent,
    feeUnits: fee,
    direction: self ? 'self' : received > sent ? 'in' : 'out',
    raw: tx,
  };
}

/** One page of an address's history within a block range, newest first. */
export interface ZcashPage {
  page: number;
  totalPages: number;
  /** Transactions in the whole range. */
  total: number;
  legs: ZcashLeg[];
}

/** ZCASH-SYNC: a page must hold exactly the transactions its place in the range promises. */
export function parsePage(
  address: string,
  range: { from: number; to: number; page: number },
  value: unknown,
): ZcashPage {
  const body = record(value);
  if (body.address !== address) invalid();
  const total = integer(body.txs);
  const totalPages = Math.ceil(total / BLOCKBOOK_PAGE_SIZE);
  // Blockbook leaves totalPages out, or gives 1 or 0, for an empty range.
  if (body.totalPages !== undefined && total > 0 && integer(body.totalPages) !== totalPages)
    invalid();
  const items = body.transactions === undefined ? [] : list(body.transactions);
  if (total === 0) {
    if (items.length > 0) invalid();
    return { page: range.page, totalPages: 0, total, legs: [] };
  }
  // Blockbook moves a page past the end back to the last one.
  if (integer(body.page, 1) !== range.page) invalid();
  const expected =
    range.page < totalPages ? BLOCKBOOK_PAGE_SIZE : total - (totalPages - 1) * BLOCKBOOK_PAGE_SIZE;
  if (items.length !== expected) invalid();
  const legs: ZcashLeg[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const tx = record(item);
    const height = integer(tx.blockHeight);
    if (height < range.from || height > range.to) invalid();
    const leg = parseTransaction(address, tx);
    const txid = tx.txid as string;
    if (seen.has(txid)) invalid();
    seen.add(txid);
    if (leg) legs.push(leg);
  }
  return { page: range.page, totalPages, total, legs };
}

/** ZCASH-SYNC: the newest block the instance has indexed, when it is caught up. */
export function parseStatus(value: unknown): number {
  const blockbook = record(record(value).blockbook);
  if (blockbook.inSync !== true) invalid();
  return integer(blockbook.bestHeight, 1);
}

type Failure = { ok: false; reason: StepFailure };
export type StatusResult = { ok: true; height: number } | Failure;
export type ZcashPageResult = ({ ok: true } & ZcashPage) | Failure;

export class BlockbookClient {
  private readonly logger = new Logger(BlockbookClient.name);
  private readonly baseUrls: string[];
  private readonly apiKey: string | null;
  private readonly secrets: string[];
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;
  private readonly agents = {
    httpAgent: new HttpAgent({ keepAlive: false }),
    httpsAgent: new HttpsAgent({ keepAlive: false }),
  };

  constructor(
    options: {
      baseUrls?: string[];
      apiKey?: string | null;
      /** One Blockbook address chosen by the server's owner; the key may be part of it. */
      baseUrl?: string | null;
      timeoutMs?: number;
      pauseMs?: number;
    } = {},
  ) {
    this.apiKey = options.apiKey?.trim() || null;
    const custom = options.baseUrl?.trim().replace(/\/+$/, '');
    this.baseUrls =
      options.baseUrls ?? (custom ? [custom] : this.apiKey ? NOWNODES_BASE_URLS : TREZOR_BASE_URLS);
    // A custom address may carry the key in its path (GetBlock): keep every piece out of logs.
    this.secrets = [
      ...(this.apiKey ? [this.apiKey] : []),
      ...(custom ? new URL(custom).pathname.split('/').filter((part) => part.length >= 8) : []),
    ];
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.pauseMs = options.pauseMs ?? 500;
  }

  status(): Promise<StatusResult> {
    return this.get('/api', {}, (body) => ({ ok: true as const, height: parseStatus(body) }));
  }

  /** Page `page` (from 1) of the address's confirmed transactions in blocks from..to. */
  page(address: string, from: number, to: number, page: number): Promise<ZcashPageResult> {
    return this.get(
      `/api/v2/address/${address}`,
      {
        details: 'txs',
        from: String(from),
        to: String(to),
        page: String(page),
        pageSize: String(BLOCKBOOK_PAGE_SIZE),
      },
      (body) => ({ ok: true as const, ...parsePage(address, { from, to, page }, body) }),
    );
  }

  /** Asks each instance in turn; another one answers when the first is down. */
  private async get<T extends { ok: true }>(
    path: string,
    params: Record<string, string>,
    parse: (body: unknown) => T,
  ): Promise<T | Failure> {
    let failure: Failure = { ok: false, reason: 'unavailable' };
    for (const baseUrl of this.baseUrls) {
      const answer: T | Failure = await this.request(baseUrl, path, params, parse);
      if (answer.ok) return answer;
      failure = answer;
      // A busy instance asks the app to slow down; the next pass tries again.
      if (answer.reason === 'rate_limited') break;
    }
    return failure;
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    params: Record<string, string>,
    parse: (body: unknown) => T,
  ): Promise<T | Failure> {
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string };
    try {
      response = await axios.get<string>(`${baseUrl}${path}`, {
        params,
        // axios' timeout is an idle timeout; the signal bounds the whole response.
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        ...this.agents,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        headers: { Accept: 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) },
      });
    } catch (error) {
      this.logRefusal(path, 'failed', errorCode(error));
      return { ok: false, reason: 'unavailable' };
    } finally {
      this.lastRequestAt = Date.now();
    }
    if (response.status !== 200)
      this.logRefusal(path, `answered ${response.status}`, String(response.data));
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    // A key-less server is turned away with 401 or 403 (Trezor's Cloudflare, NOWNodes); so is a
    // key that NOWNodes does not accept.
    if (response.status === 401 || response.status === 403)
      return { ok: false, reason: 'not_configured' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      return parse(JSON.parse(response.data));
    } catch {
      return { ok: false, reason: 'invalid_response' };
    }
  }

  /** The sync status shows only a summary; the log keeps what Blockbook said, never an ID. */
  private logRefusal(path: string, outcome: string, detail: string) {
    const redact = (text: string) =>
      this.secrets
        .reduce((safe, secret) => safe.split(secret).join('<key>'), text)
        .replace(ADDRESS_OR_HASH, '<id>');
    const said = redact(detail.slice(0, LOGGED_CHARS + 100))
      .slice(0, LOGGED_CHARS)
      .replace(/\s+/g, ' ')
      .trim();
    this.logger.warn(`Blockbook ${redact(path)} ${outcome}${said ? `: ${said}` : ''}`);
  }
}

function errorCode(error: unknown): string {
  const failure = error as { code?: unknown; name?: unknown; cause?: { code?: unknown } };
  for (const value of [failure?.code, failure?.cause?.code, failure?.name])
    if (typeof value === 'string' && value) return value;
  return 'unknown error';
}
