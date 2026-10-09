import axios from 'axios';

// Esplora returns confirmed address history newest first, 25 transactions per page.
export const PAGE_SIZE = 25;
const DEFAULT_BASE_URL = 'https://blockstream.info/api';
// Pages of large consolidation transactions can be several megabytes.
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_UNIX_SECONDS = 253402300799;

export type ProviderFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
export type Direction = 'in' | 'out' | 'self';
export interface ChainObservation {
  txid: string;
  blockHeight: number;
  blockHash: string;
  blockTime: string;
  receivedSats: bigint;
  sentSats: bigint;
  feeSats: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}
export type PageResult =
  | { ok: true; transactions: ChainObservation[] }
  | { ok: false; reason: ProviderFailure };
export type CountResult = { ok: true; count: number } | { ok: false; reason: ProviderFailure };

class InvalidResponse extends Error {}

const hash = /^[0-9a-f]{64}$/;
function invalid(): never {
  throw new InvalidResponse();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function amount(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : invalid();
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid();
}
function owner(value: Record<string, unknown>): string | null {
  const address = value.scriptpubkey_address;
  if (address === undefined) return null;
  return typeof address === 'string' ? address : invalid();
}

// An address's history, or an account's (M21): a transaction's effect on every address it owns.
function observe(owned: ReadonlySet<string>, value: unknown): ChainObservation {
  const tx = record(value);
  const txid = typeof tx.txid === 'string' && hash.test(tx.txid) ? tx.txid : invalid();
  const status = record(tx.status);
  if (status.confirmed !== true) invalid();
  const blockHash =
    typeof status.block_hash === 'string' && hash.test(status.block_hash)
      ? status.block_hash
      : invalid();
  const blockHeight = amount(status.block_height, 2 ** 31 - 1);
  const blockTime = new Date(amount(status.block_time, MAX_UNIX_SECONDS) * 1000).toISOString();
  const fee = BigInt(amount(tx.fee));
  let related = false;
  let received = 0n;
  let sent = 0n;
  let everyOutputReturns = true;
  for (const output of list(tx.vout).map(record)) {
    const value = BigInt(amount(output.value));
    const mine = owned.has(owner(output) ?? '');
    related ||= mine;
    if (mine) received += value;
    else if (value > 0n) everyOutputReturns = false;
  }
  for (const input of list(tx.vin).map(record)) {
    // Coinbase inputs spend no previous output.
    if (input.prevout === null && input.is_coinbase === true) continue;
    const previous = record(input.prevout);
    const value = BigInt(amount(previous.value));
    if (owned.has(owner(previous) ?? '')) {
      related = true;
      sent += value;
    }
  }
  if (!related) invalid();
  const direction: Direction =
    sent > 0n && everyOutputReturns && received <= sent ? 'self' : received > sent ? 'in' : 'out';
  return {
    txid,
    blockHeight,
    blockHash,
    blockTime,
    receivedSats: received,
    sentSats: sent,
    feeSats: fee,
    direction,
    raw: tx,
  };
}

export function parsePage(owned: string | ReadonlySet<string>, body: unknown): ChainObservation[] {
  const items = list(body);
  if (items.length > PAGE_SIZE) invalid();
  const addresses = typeof owned === 'string' ? new Set([owned]) : owned;
  const transactions = items.map((item) => observe(addresses, item));
  if (new Set(transactions.map(({ txid }) => txid)).size !== transactions.length) invalid();
  return transactions;
}

export function formatSats(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % 100_000_000n).toString().padStart(8, '0');
  return `${value < 0n ? '-' : ''}${magnitude / 100_000_000n}.${fraction}`;
}

export class EsploraClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;

  constructor(options: { baseUrl?: string; timeoutMs?: number; pauseMs?: number } = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.pauseMs = options.pauseMs ?? 250;
  }

  /** One page of an address's history; `owned` names every address of its account (M21). */
  async page(
    address: string,
    afterTxid: string | null,
    owned: ReadonlySet<string> = new Set([address]),
  ): Promise<PageResult> {
    const path = `/address/${encodeURIComponent(address)}/txs/chain${afterTxid ? `/${afterTxid}` : ''}`;
    return this.get(path, (body) => ({ ok: true, transactions: parsePage(owned, body) }));
  }

  // Confirmed transaction count, used to tell the end of history from a lagging backend.
  async transactionCount(address: string): Promise<CountResult> {
    return this.get(`/address/${encodeURIComponent(address)}`, (body) => ({
      ok: true,
      count: amount(record(record(body).chain_stats).tx_count),
    }));
  }

  private async get<T>(
    path: string,
    parse: (body: unknown) => T,
  ): Promise<T | { ok: false; reason: ProviderFailure }> {
    // Public instances are shared; keep consecutive requests apart.
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string };
    try {
      response = await axios.get<string>(`${this.baseUrl}${path}`, {
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
    } catch {
      return { ok: false, reason: 'invalid_response' };
    }
  }
}
