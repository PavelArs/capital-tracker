import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { StepFailure } from './chain-sync';
import { isStellarAddress } from './stellar-address';

// Horizon (STELLAR-SYNC), the Stellar Development Foundation's free public API, no key. Every
// transaction it lists is in a closed ledger, so nothing read is ever replaced. Amounts are
// decimals with 7 places; the app stores stroops (1 XLM = 10 000 000 stroops).
//
// Some server networks freeze any download from abroad after its first ~16 KB (TRON-SYNC), so
// pages stay short (a transaction record with its XDR is ~2.5 KB, a payment ~1 KB) and every
// request takes a new connection.
export const HORIZON_TRANSACTION_PAGE_SIZE = 5;
export const HORIZON_PAYMENT_PAGE_SIZE = 10;
const DEFAULT_BASE_URL = 'https://horizon.stellar.org';
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const LOGGED_CHARS = 160;
const ADDRESS_OR_HASH = /\b[GM][A-Z2-7]{55,68}\b|\b[0-9a-fA-F]{64}\b/g;
const MAX_LEDGER = 2 ** 31 - 1;
// A total order ID (TOID): the ledger in the high 32 bits, then the transaction's place in it
// (20 bits) and the operation's (12 bits, zero for the transaction itself).
const MAX_TOID = 2n ** 63n - 1n;
export const OPERATION_BITS = 0xfffn;

/** One transaction naming the account, as /accounts/{id}/transactions lists it. */
export interface StellarTransaction {
  hash: string;
  /** Its paging token, the TOID; the list's order. */
  toid: bigint;
  ledger: number;
  /** ISO, whole seconds. */
  createdAt: string;
  successful: boolean;
  /** The account that paid the fee: the source, or a fee-bump's fee account. */
  feeAccount: string;
  /** Stroops charged, also for a failed transaction. */
  feeCharged: bigint;
  raw: Record<string, unknown>;
}

/** XLM one operation moved, as /accounts/{id}/payments lists it. */
export interface StellarPayment {
  /** The operation's TOID. */
  id: bigint;
  /** The TOID of its transaction. */
  transaction: bigint;
  hash: string;
  /** "payment", "create_account", "account_merge", "path_payment_strict_send", … */
  type: string;
  /** Each XLM movement of the operation: who paid whom how many stroops. */
  moves: { from: string; to: string; units: bigint }[];
  /** account_merge: the amount is only in the operation's effects. */
  merge: { from: string; into: string } | null;
  raw: Record<string, unknown>;
}

type Failure = { ok: false; reason: StepFailure };
export type PageResult<T> = { ok: true; items: T[] } | Failure;
export type UnitsResult = { ok: true; units: bigint } | Failure;

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
function hash(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : invalid();
}
function account(value: unknown): string {
  return isStellarAddress(value) ? value : invalid();
}
function toid(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) invalid();
  const parsed = BigInt(value);
  return parsed <= MAX_TOID ? parsed : invalid();
}
/** Horizon's "12.3456789", in stroops. */
export function stroops(value: unknown): bigint {
  if (typeof value !== 'string') invalid();
  const match = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,7}))?$/.exec(value);
  if (!match) invalid();
  return BigInt(match[1]) * 10_000_000n + BigInt((match[2] ?? '').padEnd(7, '0'));
}
/** A fee in stroops: newer Horizon writes it as text, older as a number. */
function fee(value: unknown): bigint {
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)) return BigInt(value);
  if (Number.isSafeInteger(value) && (value as number) >= 0) return BigInt(value as number);
  return invalid();
}
function time(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) invalid();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? invalid() : parsed.toISOString();
}

/** A HAL page's records. */
function records(body: unknown, size: number): unknown[] {
  const items = list(record(record(body)._embedded).records);
  return items.length > size ? invalid() : items;
}

// The XDR blobs are the largest part of a record and say nothing the fields do not.
const XDR = new Set(['envelope_xdr', 'result_xdr', 'result_meta_xdr', 'fee_meta_xdr', '_links']);
const trimmed = (item: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(item).filter(([key]) => !XDR.has(key)));

export function parseTransaction(value: unknown): StellarTransaction {
  const item = record(value);
  if (typeof item.successful !== 'boolean') invalid();
  const ledger = item.ledger;
  if (!Number.isSafeInteger(ledger) || (ledger as number) < 1 || (ledger as number) > MAX_LEDGER)
    invalid();
  const position = toid(item.paging_token);
  // The TOID names the ledger it was closed in, so the two must agree.
  if (position >> 32n !== BigInt(ledger as number) || (position & OPERATION_BITS) !== 0n) invalid();
  return {
    hash: hash(item.hash),
    toid: position,
    ledger: ledger as number,
    createdAt: time(item.created_at),
    successful: item.successful,
    feeAccount: account(item.fee_account ?? item.source_account),
    feeCharged: fee(item.fee_charged),
    raw: trimmed(item),
  };
}

const native = (item: Record<string, unknown>, key: string) => item[key] === 'native';

export function parsePayment(value: unknown): StellarPayment {
  const item = record(value);
  const id = toid(item.paging_token);
  if (typeof item.type !== 'string' || !/^[a-z_]{1,64}$/.test(item.type)) invalid();
  // The list leaves failed transactions out; anything else is an answer the sync cannot trust.
  if (item.transaction_successful !== true) invalid();
  const moves: StellarPayment['moves'] = [];
  let merge: StellarPayment['merge'] = null;
  switch (item.type) {
    case 'create_account':
      moves.push({
        from: account(item.funder),
        to: account(item.account),
        units: stroops(item.starting_balance),
      });
      break;
    case 'payment':
      if (native(item, 'asset_type'))
        moves.push({ from: account(item.from), to: account(item.to), units: stroops(item.amount) });
      break;
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive': {
      // XLM paid in, or XLM received out: a path payment can turn one asset into another.
      const from = account(item.from);
      const to = account(item.to);
      if (native(item, 'source_asset_type'))
        moves.push({ from, to: '', units: stroops(item.source_amount) });
      if (native(item, 'asset_type')) moves.push({ from: '', to, units: stroops(item.amount) });
      break;
    }
    case 'account_merge':
      merge = { from: account(item.account), into: account(item.into) };
      break;
    case 'invoke_host_function':
      // A contract call that moved XLM through its asset contract (Soroban).
      for (const change of item.asset_balance_changes === undefined
        ? []
        : list(item.asset_balance_changes)) {
        const entry = record(change);
        if (!native(entry, 'asset_type') || entry.type !== 'transfer') continue;
        const accountOrNone = (side: unknown) => (isStellarAddress(side) ? side : '');
        moves.push({
          from: accountOrNone(entry.from),
          to: accountOrNone(entry.to),
          units: stroops(entry.amount),
        });
      }
      break;
  }
  return {
    id,
    transaction: id & ~OPERATION_BITS,
    hash: hash(item.transaction_hash),
    type: item.type,
    moves,
    merge,
    raw: trimmed(item),
  };
}

/** The XLM an account_merge moved, from its account_credited effect. */
export function parseMergeEffects(body: unknown, into: string): bigint {
  for (const value of records(body, 50)) {
    const effect = record(value);
    if (
      effect.type === 'account_credited' &&
      effect.account === into &&
      native(effect, 'asset_type')
    )
      return stroops(effect.amount);
  }
  return invalid();
}

/** The account's XLM balance now; an account that does not exist (never funded or merged) has none. */
export function parseBalance(body: unknown): bigint {
  for (const value of list(record(body).balances)) {
    const balance = record(value);
    if (balance.asset_type === 'native') return stroops(balance.balance);
  }
  return invalid();
}

export class HorizonClient {
  private readonly logger = new Logger(HorizonClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;
  private readonly agents = {
    httpAgent: new HttpAgent({ keepAlive: false }),
    httpsAgent: new HttpsAgent({ keepAlive: false }),
  };

  constructor(options: { baseUrl?: string; timeoutMs?: number; pauseMs?: number } = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // The public Horizon allows 3 600 requests an hour per server.
    this.pauseMs = options.pauseMs ?? 300;
  }

  /** The account's transactions after the TOID `after`, oldest first, failed ones included. */
  transactions(address: string, after: bigint | null): Promise<PageResult<StellarTransaction>> {
    return this.page(
      `/accounts/${address}/transactions`,
      HORIZON_TRANSACTION_PAGE_SIZE,
      after,
      { include_failed: 'true' },
      parseTransaction,
    );
  }

  /** The account's payment operations after the TOID `after`, oldest first. */
  payments(address: string, after: bigint | null): Promise<PageResult<StellarPayment>> {
    return this.page(
      `/accounts/${address}/payments`,
      HORIZON_PAYMENT_PAGE_SIZE,
      after,
      {},
      parsePayment,
    );
  }

  mergeAmount(operation: bigint, into: string): Promise<UnitsResult> {
    return this.get(
      `/operations/${operation}/effects`,
      { limit: '50' },
      (body) => ({ ok: true as const, units: parseMergeEffects(body, into) }),
      null,
    );
  }

  balance(address: string): Promise<UnitsResult> {
    return this.get(
      `/accounts/${address}`,
      {},
      (body) => ({ ok: true as const, units: parseBalance(body) }),
      { ok: true as const, units: 0n },
    );
  }

  private page<T>(
    path: string,
    size: number,
    after: bigint | null,
    params: Record<string, string>,
    parse: (item: unknown) => T,
  ): Promise<PageResult<T>> {
    return this.get(
      path,
      {
        order: 'asc',
        limit: String(size),
        ...params,
        ...(after === null ? {} : { cursor: after.toString() }),
      },
      (body) => ({ ok: true as const, items: records(body, size).map(parse) }),
      // An account that never existed has no history.
      { ok: true as const, items: [] },
    );
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
    parse: (body: unknown) => T,
    missing: T | null,
  ): Promise<T | Failure> {
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string };
    try {
      response = await axios.get<string>(`${this.baseUrl}${path}`, {
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
        headers: { Accept: 'application/hal+json, application/json' },
      });
    } catch (error) {
      this.logRefusal(path, 'failed', errorCode(error));
      return { ok: false, reason: 'unavailable' };
    } finally {
      this.lastRequestAt = Date.now();
    }
    if (response.status === 404 && missing !== null) return missing;
    if (response.status !== 200)
      this.logRefusal(path, `answered ${response.status}`, String(response.data));
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      return parse(JSON.parse(response.data));
    } catch {
      return { ok: false, reason: 'invalid_response' };
    }
  }

  /** The sync status shows only a summary; the log keeps what Horizon said, never an ID. */
  private logRefusal(path: string, outcome: string, detail: string) {
    const redact = (text: string) => text.replace(ADDRESS_OR_HASH, '<id>');
    const said = redact(detail.slice(0, LOGGED_CHARS + 100))
      .slice(0, LOGGED_CHARS)
      .replace(/\s+/g, ' ')
      .trim();
    this.logger.warn(
      `Horizon ${redact(path).replace(/\/\d+\//, '/<id>/')} ${outcome}${said ? `: ${said}` : ''}`,
    );
  }
}

function errorCode(error: unknown): string {
  const failure = error as { code?: unknown; name?: unknown; cause?: { code?: unknown } };
  for (const value of [failure?.code, failure?.cause?.code, failure?.name])
    if (typeof value === 'string' && value) return value;
  return 'unknown error';
}
