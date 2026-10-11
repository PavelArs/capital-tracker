import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { StepFailure } from './chain-sync';
import { tronHex } from './tron-address';

// TronGrid (TRON-SYNC), Tron's free public API: the account lists of its v1 index and the
// node API of its solidity nodes, so everything read is confirmed and never replaced. It
// answers without a key at a low rate; a free TronGrid key (TRONGRID_API_KEY) raises the limit.
// Amounts are in sun (1 TRX = 1 000 000 sun) and token base units.
//
// Some server networks freeze any download from TronGrid after its first ~16 KB, so every
// answer is kept small: the block header without its transactions, short pages (a transaction
// item is ~1.5 KB, a token transfer ~0.4 KB) and a new connection for every request.
export const TRONGRID_TRANSACTION_PAGE_SIZE = 6;
export const TRONGRID_TOKEN_PAGE_SIZE = 20;
const DEFAULT_BASE_URL = 'https://api.trongrid.io';
// TRON-INTERNAL: Tronscan's list of the TRX contracts sent an account, which TronGrid's account
// list leaves out. Only hashes and block times are taken from it; amounts come from TronGrid.
const DEFAULT_TRONSCAN_URL = 'https://apilist.tronscanapi.com';
export const TRONSCAN_PAGE_SIZE = 10;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
// A refusal is logged with its first characters, never an address, a hash or the key.
const LOGGED_CHARS = 160;
const ADDRESS_OR_HASH = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b|\b[0-9a-fA-F]{40,64}\b/g;
// Milliseconds since 1970 up to year 9999.
const MAX_TIME_MS = 253402300799999;
const MAX_BLOCK = 2 ** 31 - 1;

/** The newest confirmed (solidified) block. */
export interface TronTip {
  number: number;
  /** Milliseconds since 1970. */
  timestamp: number;
}

/** A transaction of the account list: one contract call with its parameters (hex addresses). */
export interface TronTransaction {
  kind: 'transaction';
  txid: string;
  blockNumber: number;
  timestamp: number;
  /** The contract ran to the end; a failed one moves nothing but still costs its fee. */
  success: boolean;
  /** "TransferContract", "TriggerSmartContract", "FreezeBalanceV2Contract", … */
  contractType: string;
  /** The account that signed and paid for it, hex. */
  owner: string | null;
  parameter: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/** TRX a contract moved inside a transaction, listed apart (no block number). */
export interface TronInternal {
  kind: 'internal';
  txid: string;
  timestamp: number;
  from: string | null;
  to: string | null;
  /** TRX moved; other tokens of the call value are not tracked. */
  units: bigint;
  rejected: boolean;
  raw: Record<string, unknown>;
}

export type TronAccountItem = TronTransaction | TronInternal;

/** One TRC-20 Transfer event naming the account (base58 addresses). */
export interface TronTokenTransfer {
  txid: string;
  timestamp: number;
  contract: string;
  from: string;
  to: string;
  value: bigint;
  raw: Record<string, unknown>;
}

/** What the node recorded when it ran a transaction (gettransactioninfobyid). */
export interface TronTransactionInfo {
  txid: string;
  blockNumber: number;
  timestamp: number;
  /** Every TRX the signer paid: bandwidth, energy, account creation and the like. */
  fee: bigint;
  failed: boolean;
  /** Vote rewards a WithdrawBalance claimed. */
  withdrawAmount: bigint;
  /** TRX a Stake 1.0 unfreeze returned. */
  unfreezeAmount: bigint;
  /** Unstaked TRX past its waiting period that went back to the balance (Stake 2.0). */
  withdrawExpireAmount: bigint;
  /** TRX contracts moved inside the transaction, as the node recorded them. */
  internal: TronInternal[];
  raw: Record<string, unknown>;
}

/** One Stake 2.0 unstake waiting to become withdrawable. */
export interface TronUnstaking {
  units: bigint;
  /** When it can be withdrawn, ISO. */
  availableAt: string;
}

/** TRON-STAKE-STATE: the account as the chain reports it now. */
export interface TronAccountState {
  /** Liquid TRX. */
  balance: bigint;
  /** Staked for energy, delegated to others included, Stake 1.0 and 2.0. */
  energy: bigint;
  /** Staked for bandwidth (and Stake 1.0 Tron Power), delegated to others included. */
  bandwidth: bigint;
  unstaking: TronUnstaking[];
}

type Failure = { ok: false; reason: StepFailure };
export type TipResult = { ok: true; tip: TronTip } | Failure;
export type PageResult<T> = { ok: true; items: T[]; next: string | null } | Failure;
export type InfoResult = { ok: true; info: TronTransactionInfo } | Failure;
export type AccountResult = { ok: true; account: TronAccountState } | Failure;
export type RewardResult = { ok: true; units: bigint } | Failure;
export type InternalListResult = { ok: true; items: TronscanInternal[] } | Failure;

/** TRON-INTERNAL: one TRX transfer Tronscan lists for the account, by hash and block time. */
export interface TronscanInternal {
  txid: string;
  timestamp: number;
  /** The receiver, hex. */
  to: string | null;
}

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
function integer(value: unknown, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : invalid();
}
/** A non-negative amount; Tron's JSON omits zero, and writes amounts as numbers. */
function amount(value: unknown): bigint {
  if (value === undefined) return 0n;
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)) return BigInt(value);
  return BigInt(integer(value, Number.MAX_SAFE_INTEGER));
}
function hash(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase()
    : invalid();
}
const time = (value: unknown) => integer(value, MAX_TIME_MS);
const block = (value: unknown) => integer(value, MAX_BLOCK);
function base58Address(value: unknown): string {
  return typeof value === 'string' && tronHex(value) !== null ? value : invalid();
}

export function parseTip(body: unknown): TronTip {
  const header = record(record(record(body).block_header).raw_data);
  return { number: block(header.number), timestamp: time(header.timestamp) };
}

/** One item of /v1/accounts/{address}/transactions: a transaction or an internal transfer. */
export function parseAccountItem(value: unknown): TronAccountItem {
  const item = record(value);
  if (item.internal_tx_id !== undefined) {
    const data = record(item.data);
    const call = data.call_value === undefined ? {} : record(data.call_value);
    if (data.rejected !== undefined && typeof data.rejected !== 'boolean') invalid();
    return {
      kind: 'internal',
      txid: hash(item.tx_id),
      timestamp: time(item.block_timestamp),
      from: tronHex(item.from_address),
      to: tronHex(item.to_address),
      units: amount(call._),
      rejected: data.rejected === true,
      raw: item,
    };
  }
  const contracts = list(record(item.raw_data).contract);
  // Every transaction Tron accepts today carries exactly one contract.
  if (contracts.length !== 1) invalid();
  const contract = record(contracts[0]);
  if (typeof contract.type !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(contract.type)) invalid();
  const parameter = record(record(contract.parameter).value);
  const result = item.ret === undefined ? [] : list(item.ret);
  const outcome = result.length > 0 ? record(result[0]).contractRet : undefined;
  if (outcome !== undefined && typeof outcome !== 'string') invalid();
  return {
    kind: 'transaction',
    txid: hash(item.txID),
    blockNumber: block(item.blockNumber),
    timestamp: time(item.block_timestamp),
    // A plain transfer reports SUCCESS too; anything else (REVERT, OUT_OF_ENERGY…) failed.
    success: outcome === undefined || outcome === 'SUCCESS',
    contractType: contract.type,
    owner: tronHex(parameter.owner_address),
    parameter,
    raw: item,
  };
}

/** One item of /v1/accounts/{address}/transactions/trc20. */
export function parseTokenTransfer(value: unknown): TronTokenTransfer {
  const item = record(value);
  const token = record(item.token_info);
  return {
    txid: hash(item.transaction_id),
    timestamp: time(item.block_timestamp),
    contract: base58Address(token.address),
    from: base58Address(item.from),
    to: base58Address(item.to),
    value: typeof item.value === 'string' ? amount(item.value) : invalid(),
    raw: item,
  };
}

/** A v1 list page: its items and the fingerprint of the next page, if there is one. */
export function parsePage<T>(body: unknown, parse: (item: unknown) => T, size: number) {
  const envelope = record(body);
  if (envelope.success !== true) invalid();
  const data = list(envelope.data);
  if (data.length > size) invalid();
  const meta = envelope.meta === undefined ? {} : record(envelope.meta);
  const fingerprint = meta.fingerprint;
  if (fingerprint !== undefined && (typeof fingerprint !== 'string' || fingerprint.length > 2048))
    invalid();
  return { items: data.map(parse), next: (fingerprint as string | undefined) || null };
}

export function parseInfo(body: unknown, txid: string): TronTransactionInfo {
  const item = record(body);
  // An unknown or not yet confirmed transaction is answered with {}.
  if (hash(item.id) !== txid) invalid();
  const receipt = item.receipt === undefined ? {} : record(item.receipt);
  const failed =
    item.result === 'FAILED' ||
    (receipt.result !== undefined && receipt.result !== 'SUCCESS' && receipt.result !== 'DEFAULT');
  const timestamp = time(item.blockTimeStamp);
  return {
    txid,
    blockNumber: block(item.blockNumber),
    timestamp,
    fee: amount(item.fee),
    failed,
    withdrawAmount: amount(item.withdraw_amount),
    unfreezeAmount: amount(item.unfreeze_amount),
    withdrawExpireAmount: amount(item.withdraw_expire_amount),
    internal: (item.internal_transactions === undefined
      ? []
      : list(item.internal_transactions)
    ).map((value) => parseInfoInternal(value, txid, timestamp)),
    raw: item,
  };
}

/** One internal transaction of the node's record; only its TRX (no token id) is counted. */
function parseInfoInternal(value: unknown, txid: string, timestamp: number): TronInternal {
  const item = record(value);
  if (item.rejected !== undefined && typeof item.rejected !== 'boolean') invalid();
  const values = item.callValueInfo === undefined ? [] : list(item.callValueInfo);
  const units = values
    .map(record)
    .filter((entry) => entry.tokenId === undefined)
    .reduce((sum, entry) => sum + amount(entry.callValue), 0n);
  return {
    kind: 'internal',
    txid,
    timestamp,
    from: tronHex(item.caller_address),
    to: tronHex(item.transferTo_address),
    units,
    rejected: item.rejected === true,
    raw: item,
  };
}

/**
 * Tronscan's /api/internal-transaction: a page of the TRX transfers contracts made to an
 * account. Only the confirmed ones that were not rejected or reverted are kept, by hash, block
 * time (ms) and receiver; their amounts are read from the node's record of the transaction.
 */
export function parseInternalList(body: unknown): TronscanInternal[] {
  const items = record(body).data === undefined ? [] : list(record(body).data);
  return items.flatMap((value) => {
    const item = record(value);
    if (item.confirmed !== true || item.rejected === true || item.revert === true) return [];
    return [{ txid: hash(item.hash), timestamp: time(item.timestamp), to: tronHex(item.to) }];
  });
}

/** getaccount with visible addresses; an account never activated is answered with {}. */
export function parseAccount(body: unknown): TronAccountState {
  const item = record(body);
  const resource = item.account_resource === undefined ? {} : record(item.account_resource);
  const nested = (value: unknown) =>
    value === undefined ? 0n : amount(record(value).frozen_balance);
  let energy =
    nested(resource.frozen_balance_for_energy) +
    amount(resource.delegated_frozen_balance_for_energy) +
    amount(resource.delegated_frozenV2_balance_for_energy);
  let bandwidth =
    nested(item.tron_power) +
    amount(item.delegated_frozen_balance_for_bandwidth) +
    amount(item.delegated_frozenV2_balance_for_bandwidth);
  for (const frozen of item.frozen === undefined ? [] : list(item.frozen))
    bandwidth += amount(record(frozen).frozen_balance);
  for (const frozen of item.frozenV2 === undefined ? [] : list(item.frozenV2)) {
    const entry = record(frozen);
    // The resource defaults to BANDWIDTH and is then left out.
    if (entry.type === 'ENERGY') energy += amount(entry.amount);
    else if (entry.type === undefined || entry.type === 'BANDWIDTH' || entry.type === 'TRON_POWER')
      bandwidth += amount(entry.amount);
    else invalid();
  }
  const unstaking = (item.unfrozenV2 === undefined ? [] : list(item.unfrozenV2))
    .map((value) => {
      const entry = record(value);
      return {
        units: amount(entry.unfreeze_amount),
        availableAt: new Date(time(entry.unfreeze_expire_time)).toISOString(),
      };
    })
    .filter((entry) => entry.units > 0n)
    .sort((left, right) => left.availableAt.localeCompare(right.availableAt));
  return { balance: amount(item.balance), energy, bandwidth, unstaking };
}

export function parseReward(body: unknown): bigint {
  return amount(record(body).reward);
}

export class TronGridClient {
  private readonly logger = new Logger(TronGridClient.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly tronscanUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;
  private readonly agents = {
    httpAgent: new HttpAgent({ keepAlive: false }),
    httpsAgent: new HttpsAgent({ keepAlive: false }),
  };

  constructor(
    options: {
      apiKey?: string | null;
      baseUrl?: string;
      tronscanUrl?: string;
      timeoutMs?: number;
      pauseMs?: number;
    } = {},
  ) {
    this.apiKey = options.apiKey?.trim() || null;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.tronscanUrl = options.tronscanUrl ?? DEFAULT_TRONSCAN_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // Without a key TronGrid allows only a few calls a second; with one, more.
    this.pauseMs = options.pauseMs ?? (this.apiKey ? 150 : 400);
  }

  tip(): Promise<TipResult> {
    // The newest solid block's header (~0.5 KB); getnowblock would send all its transactions.
    return this.get('/walletsolidity/getblock', { detail: 'false' }, (body) => ({
      ok: true as const,
      tip: parseTip(body),
    }));
  }

  /** The account's transactions with block times in [from, to] ms, oldest first. */
  transactions(address: string, from: number, to: number, fingerprint: string | null) {
    return this.page(
      `/v1/accounts/${address}/transactions`,
      {},
      TRONGRID_TRANSACTION_PAGE_SIZE,
      { from, to, fingerprint },
      parseAccountItem,
    );
  }

  /** The account's transfers of one TRC-20 contract in [from, to] ms, oldest first. */
  tokenTransfers(
    address: string,
    contract: string,
    from: number,
    to: number,
    fingerprint: string | null,
  ) {
    return this.page(
      `/v1/accounts/${address}/transactions/trc20`,
      { contract_address: contract },
      TRONGRID_TOKEN_PAGE_SIZE,
      { from, to, fingerprint },
      parseTokenTransfer,
    );
  }

  info(txid: string): Promise<InfoResult> {
    return this.get('/walletsolidity/gettransactioninfobyid', { value: txid }, (body) => ({
      ok: true as const,
      info: parseInfo(body, txid),
    }));
  }

  account(address: string): Promise<AccountResult> {
    return this.get('/walletsolidity/getaccount', { address, visible: 'true' }, (body) => ({
      ok: true as const,
      account: parseAccount(body),
    }));
  }

  /** Vote rewards the account has not claimed yet. */
  reward(address: string): Promise<RewardResult> {
    return this.get('/wallet/getReward', { address, visible: 'true' }, (body) => ({
      ok: true as const,
      units: parseReward(body),
    }));
  }

  /**
   * TRON-INTERNAL: one page of the TRX transfers contracts made to the account, newest first, as
   * Tronscan lists them; `start` counts the items before the page.
   */
  internalTransfers(address: string, start: number): Promise<InternalListResult> {
    return this.get(
      '/api/internal-transaction',
      { address, start: String(start), limit: String(TRONSCAN_PAGE_SIZE) },
      (body) => ({ ok: true as const, items: parseInternalList(body) }),
      'Tronscan',
    );
  }

  private page<T>(
    path: string,
    params: Record<string, string>,
    size: number,
    { from, to, fingerprint }: { from: number; to: number; fingerprint: string | null },
    parse: (item: unknown) => T,
  ): Promise<PageResult<T>> {
    return this.get(
      path,
      {
        only_confirmed: 'true',
        limit: String(size),
        order_by: 'block_timestamp,asc',
        min_timestamp: String(from),
        max_timestamp: String(to),
        ...params,
        ...(fingerprint ? { fingerprint } : {}),
      },
      (body) => ({ ok: true as const, ...parsePage(body, parse, size) }),
    );
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
    parse: (body: unknown) => T,
    provider: 'TronGrid' | 'Tronscan' = 'TronGrid',
  ): Promise<T | Failure> {
    const tronscan = provider === 'Tronscan';
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: { status: number; data: string };
    try {
      response = await axios.get<string>(`${tronscan ? this.tronscanUrl : this.baseUrl}${path}`, {
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
        headers: {
          Accept: 'application/json',
          // The TronGrid key is TronGrid's alone; Tronscan is asked without one.
          ...(this.apiKey && !tronscan ? { 'TRON-PRO-API-KEY': this.apiKey } : {}),
        },
      });
    } catch (error) {
      this.logRefusal(provider, path, 'failed', errorCode(error));
      return { ok: false, reason: 'unavailable' };
    } finally {
      this.lastRequestAt = Date.now();
    }
    if (response.status !== 200)
      this.logRefusal(provider, path, `answered ${response.status}`, String(response.data));
    // TronGrid answers 403 both to a key it refuses and to calls over its rate, keyed ("exceeds
    // the frequency limit") or not ("request rate exceeded … suspended").
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status === 401 || response.status === 403)
      return {
        ok: false,
        reason: /limit|frequen|rate|exceed|suspend/i.test(String(response.data))
          ? 'rate_limited'
          : 'not_configured',
      };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      return parse(JSON.parse(response.data));
    } catch {
      return { ok: false, reason: 'invalid_response' };
    }
  }

  /** The sync status shows only a summary; the log keeps what TronGrid actually said. */
  private logRefusal(provider: string, path: string, outcome: string, detail: string) {
    const redact = (text: string) =>
      (this.apiKey ? text.split(this.apiKey).join('<key>') : text).replace(ADDRESS_OR_HASH, '<id>');
    // Redacted before the cut, so no identifier is left half-shown at the end.
    const said = redact(detail.slice(0, LOGGED_CHARS + 100))
      .slice(0, LOGGED_CHARS)
      .replace(/\s+/g, ' ')
      .trim();
    this.logger.warn(`${provider} ${redact(path)} ${outcome}${said ? `: ${said}` : ''}`);
  }
}

function errorCode(error: unknown): string {
  const failure = error as { code?: unknown; name?: unknown; cause?: { code?: unknown } };
  for (const value of [failure?.code, failure?.cause?.code, failure?.name])
    if (typeof value === 'string' && value) return value;
  return 'unknown error';
}
