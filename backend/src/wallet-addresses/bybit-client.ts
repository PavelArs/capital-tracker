import { createHmac } from 'node:crypto';
import axios from 'axios';
import type { ProviderFailure } from './esplora-client';

// sync-bybit-account (M22, D8): Bybit's free V5 API read with the owner's read-only key. Every
// private request is signed as Bybit documents it: HMAC-SHA256 with the secret over the
// timestamp, the key, the receive window and the exact query string sent, as lower-case hex.
const DEFAULT_BASE_URL = 'https://api.bybit.com';
const RECV_WINDOW = '10000';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
// Bybit's page sizes: up to 100 trades, Earn yields or converts and 50 deposits, withdrawals
// or coin exchanges a page.
export const TRADE_PAGE = 100;
export const RECORD_PAGE = 50;
export const YIELD_PAGE = 100;
export const CONVERT_PAGE = 100;

/** Why Bybit gave nothing: the provider's own trouble, or a key it no longer accepts. */
export type BybitFailure = ProviderFailure | 'key_rejected';
export type BybitResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: BybitFailure; detail: string | null };

export interface BybitCredentials {
  apiKey: string;
  apiSecret: string;
}

/** BYBIT-KEY: what Bybit says about a key. */
export interface BybitKeyInfo {
  userId: string;
  readOnly: boolean;
  /** The key may withdraw: its wallet permissions include Withdraw. */
  canWithdraw: boolean;
  /** The account is a Unified Trading Account (its trade history goes back two years). */
  unified: boolean;
  master: boolean;
  /** Bound to IP addresses; an unbound key expires after 90 days. */
  ipBound: boolean;
  expiresAt: string | null;
  /** BYBIT-EARN: the key may read Earn positions and yield (its Earn permission). */
  earn: boolean;
  /** BYBIT-CONVERT: the key may read convert history (its Exchange permission). */
  convert: boolean;
}

/** One fill of a spot order (Get Trade History, category spot). */
export interface BybitExecution {
  execId: string;
  orderId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  execPrice: string;
  execQty: string;
  execValue: string;
  /** Signed: a maker rebate is negative. */
  execFee: string;
  feeCurrency: string;
  execTime: number;
  raw: Record<string, unknown>;
}

/** An on-chain deposit, or a transfer from another Bybit user (internal). */
export interface BybitDeposit {
  internal: boolean;
  /** The record's own ID: Bybit's for an internal deposit, the chain hash otherwise. */
  id: string;
  coin: string;
  chain: string;
  amount: string;
  txID: string;
  /** Final and credited; a pending one is read again later, a failed one never counts. */
  state: 'done' | 'pending' | 'failed';
  /** When it was credited; null while a pending deposit has no time yet. */
  time: number | null;
  raw: Record<string, unknown>;
}

export interface BybitWithdrawal {
  withdrawId: string;
  txID: string;
  /** On chain, or to another Bybit user. */
  internal: boolean;
  coin: string;
  chain: string;
  amount: string;
  withdrawFee: string;
  state: 'done' | 'pending' | 'failed';
  time: number;
  raw: Record<string, unknown>;
}

/**
 * BYBIT-CONVERT: one coin converted into another at a quoted rate, on the web, in the app or
 * through the API (Get Convert History), or an older coin exchange (Get Coin Exchange Records).
 */
export interface BybitConvert {
  /** Bybit's exchange transaction ID; the same convert has the same ID in both lists. */
  id: string;
  fromCoin: string;
  fromAmount: string;
  toCoin: string;
  toAmount: string;
  /** Settled; one still processing is read again later, a failed one never counts. */
  state: 'done' | 'pending' | 'failed';
  time: number;
  raw: Record<string, unknown>;
}

export interface BybitPage<T> {
  items: T[];
  /** Null on the last page. */
  cursor: string | null;
}

export interface BybitBalance {
  coin: string;
  quantity: string;
}

/** BYBIT-EARN: Bybit's Earn products the app reads, by the category Bybit names them with. */
export type BybitEarnCategory = 'FlexibleSaving' | 'OnChain';

/** One Earn yield payment (Get Yield History); Bybit keeps the last three months. */
export interface BybitEarnYield {
  /** Unique among one user's yields of one category. */
  id: string;
  coin: string;
  amount: string;
  /** Paid out; a pending one is read again later, a failed one never counts. */
  state: 'done' | 'pending' | 'failed';
  time: number;
  raw: Record<string, unknown>;
}

class InvalidResponse extends Error {}
class Refused extends Error {
  constructor(
    readonly reason: BybitFailure,
    readonly detail: string,
  ) {
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
function text(value: unknown, pattern: RegExp): string {
  return typeof value === 'string' && pattern.test(value) ? value : invalid();
}
function list(value: unknown, maximum: number): unknown[] {
  return Array.isArray(value) && value.length <= maximum ? value : invalid();
}
const decimalPattern = /^(0|[1-9][0-9]{0,29})(\.[0-9]{1,30})?$/;
const decimal = (value: unknown) => text(value, decimalPattern);
const signed = (value: unknown) => text(value, /^-?(0|[1-9][0-9]{0,29})(\.[0-9]{1,30})?$/);
const coin = (value: unknown) => text(value, /^[A-Z0-9]{1,16}$/);
const idText = (value: unknown) => text(value, /^[0-9A-Za-z_-]{1,80}$/);
// Bybit's opaque page tokens are sent back exactly as received (its own SDKs do the same).
const cursorPattern = /^[0-9A-Za-z%+/=:,._-]{1,512}$/;
const MAX_MS = 253402300799999;
function milliseconds(value: unknown): number {
  const digits = text(value, /^[1-9][0-9]{0,14}$/);
  const number = Number(digits);
  return number <= MAX_MS ? number : invalid();
}
function seconds(value: unknown): number {
  return milliseconds(value) * 1000 <= MAX_MS ? milliseconds(value) * 1000 : invalid();
}
function nextCursor(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, cursorPattern);
}

export function parseKeyInfo(result: unknown): BybitKeyInfo {
  const item = record(result);
  const permissions = record(item.permissions);
  const wallet = list(permissions.Wallet ?? [], 20);
  const ips = list(item.ips ?? [], 200).map((ip) => text(ip, /^[0-9A-Fa-f.:/*]{1,64}$/));
  const userId = item.userID;
  const id =
    typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0
      ? String(userId)
      : text(userId, /^[1-9][0-9]{0,19}$/);
  const expiresAt =
    item.expiredAt === undefined || item.expiredAt === null || item.expiredAt === ''
      ? null
      : text(item.expiredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
  const earn = list(permissions.Earn ?? [], 20);
  const exchange = list(permissions.Exchange ?? [], 20);
  if (item.readOnly !== 0 && item.readOnly !== 1) invalid();
  return {
    userId: id,
    readOnly: item.readOnly === 1,
    canWithdraw: wallet.includes('Withdraw'),
    unified: item.uta === 1,
    master: item.isMaster !== false,
    ipBound: ips.length > 0 && !ips.includes('*'),
    expiresAt: expiresAt && new Date(expiresAt).toISOString(),
    earn: earn.includes('Earn'),
    convert: exchange.includes('ExchangeHistory'),
  };
}

export function parseExecution(value: unknown): BybitExecution {
  const item = record(value);
  const side = item.side === 'Buy' || item.side === 'Sell' ? item.side : invalid();
  return {
    execId: idText(item.execId),
    orderId: idText(item.orderId),
    symbol: text(item.symbol, /^[A-Z0-9]{2,32}$/),
    side,
    execPrice: decimal(item.execPrice),
    execQty: decimal(item.execQty),
    execValue: decimal(item.execValue),
    execFee: signed(item.execFee),
    // Empty when no fee was charged.
    feeCurrency: item.feeCurrency === '' ? '' : coin(item.feeCurrency),
    execTime: milliseconds(item.execTime),
    raw: item,
  };
}

const depositStates: Record<number, BybitDeposit['state']> = {
  0: 'pending',
  1: 'pending',
  2: 'pending',
  3: 'done',
  4: 'failed',
  10011: 'pending',
  10012: 'done',
};

export function parseDeposit(value: unknown): BybitDeposit {
  const item = record(value);
  const status = typeof item.status === 'number' ? depositStates[item.status] : undefined;
  const txID = text(item.txID, /^[0-9A-Za-z_:-]{0,128}$/);
  const state = status ?? invalid();
  const pendingTime = state !== 'done' && (item.successAt === '' || item.successAt === '0');
  return {
    internal: false,
    id: txID,
    coin: coin(item.coin),
    chain: text(item.chain, /^[0-9A-Za-z_-]{1,32}$/),
    amount: decimal(item.amount),
    txID,
    state,
    time: pendingTime ? null : milliseconds(item.successAt),
    raw: item,
  };
}

const internalStates: Record<number, BybitDeposit['state']> = {
  1: 'pending',
  2: 'done',
  3: 'failed',
};

export function parseInternalDeposit(value: unknown): BybitDeposit {
  const item = record(value);
  const status = typeof item.status === 'number' ? internalStates[item.status] : undefined;
  return {
    internal: true,
    id: idText(item.id),
    coin: coin(item.coin),
    chain: '',
    amount: decimal(item.amount),
    txID: typeof item.txID === 'string' ? item.txID : '',
    state: status ?? invalid(),
    // Seconds, unlike every other time Bybit sends.
    time: seconds(item.createdTime),
    raw: item,
  };
}

export function parseWithdrawal(value: unknown): BybitWithdrawal {
  const item = record(value);
  const status = text(item.status, /^[A-Za-z]{1,32}$/);
  const state =
    status === 'success' || status === 'BlockchainConfirmed'
      ? 'done'
      : ['CancelByUser', 'Reject', 'Fail'].includes(status)
        ? 'failed'
        : 'pending';
  return {
    withdrawId: idText(item.withdrawId),
    // Empty until the withdrawal is sent, and for one that failed.
    txID: item.txID === '' ? '' : text(item.txID, /^[0-9A-Za-z_:-]{1,128}$/),
    internal: item.withdrawType === 1,
    coin: coin(item.coin),
    chain: text(item.chain, /^[0-9A-Za-z_-]{1,32}$/),
    amount: decimal(item.amount),
    withdrawFee: item.withdrawFee === '' ? '0' : decimal(item.withdrawFee),
    state,
    time: milliseconds(item.createTime),
    raw: item,
  };
}

export function parseBalances(result: unknown): BybitBalance[] {
  const item = record(result);
  return list(item.balance, 2000).map((value) => {
    const row = record(value);
    return { coin: coin(row.coin), quantity: decimal(row.walletBalance) };
  });
}

/**
 * The unified trading account's coins, as /v5/account/wallet-balance lists them. A coin
 * borrowed on margin has a negative wallet balance: a debt, not a holding, so it reads as 0.
 */
export function parseWalletBalance(result: unknown): BybitBalance[] {
  const accounts = list(record(result).list, 1);
  if (accounts.length === 0) return [];
  return list(record(accounts[0]).coin, 2000).map((value) => {
    const row = record(value);
    const quantity = row.walletBalance === '' ? '0' : signed(row.walletBalance);
    return { coin: coin(row.coin), quantity: quantity.startsWith('-') ? '0' : quantity };
  });
}

/** BYBIT-EARN: what each Flexible Savings or On-chain position holds (Get Staked Position). */
export function parseEarnPositions(result: unknown): BybitBalance[] {
  return list(record(result).list, 2000).map((value) => {
    const row = record(value);
    return { coin: coin(row.coin), quantity: decimal(row.amount) };
  });
}

/** BYBIT-EARN: the active fixed-term positions; settled ones are already paid back. */
export const parseFixedTermPositions = parseEarnPositions;

const yieldStates: Record<string, BybitEarnYield['state']> = {
  Success: 'done',
  Pending: 'pending',
  Fail: 'failed',
};

export function parseEarnYieldItem(value: unknown): BybitEarnYield {
  const item = record(value);
  const status = typeof item.status === 'string' ? yieldStates[item.status] : undefined;
  return {
    id: idText(item.id),
    coin: coin(item.coin),
    amount: decimal(item.amount),
    state: status ?? invalid(),
    time: milliseconds(item.createdAt),
    raw: item,
  };
}

/** A page of yield: Bybit documents the list as `list` and sends it as `yield`. */
export function parseEarnYield(result: unknown): BybitPage<BybitEarnYield> {
  const item = record(result);
  const items = item.list ?? item.yield;
  return {
    items: list(items, YIELD_PAGE).map(parseEarnYieldItem),
    cursor: nextCursor(item.nextPageCursor),
  };
}

const convertStates: Record<string, BybitConvert['state']> = {
  init: 'pending',
  processing: 'pending',
  success: 'done',
  failure: 'failed',
};
// Shorter than other IDs: "bybit-trade-convert-" and the ID fit the stored 80 characters.
const convertId = (value: unknown) => text(value, /^[0-9A-Za-z_-]{1,60}$/);

export function parseConvert(value: unknown): BybitConvert {
  const item = record(value);
  const status =
    typeof item.exchangeStatus === 'string' ? convertStates[item.exchangeStatus] : undefined;
  return {
    id: convertId(item.exchangeTxId),
    fromCoin: coin(item.fromCoin),
    fromAmount: decimal(item.fromAmount),
    toCoin: coin(item.toCoin),
    toAmount: decimal(item.toAmount),
    state: status ?? invalid(),
    time: milliseconds(item.createdAt),
    raw: item,
  };
}

/** A page of convert history; the next page is asked for by number. */
export function parseConvertHistory(result: unknown): BybitConvert[] {
  return list(record(result).list ?? [], CONVERT_PAGE).map(parseConvert);
}

/** An older coin exchange: listed once done, with its time in seconds. */
export function parseCoinExchange(value: unknown): BybitConvert {
  const item = record(value);
  return {
    id: convertId(item.exchangeTxId),
    fromCoin: coin(item.fromCoin),
    fromAmount: decimal(item.fromAmount),
    toCoin: coin(item.toCoin),
    toAmount: decimal(item.toAmount),
    state: 'done',
    time: seconds(item.createdTime),
    raw: item,
  };
}

function page<T>(result: unknown, key: string, size: number, parse: (item: unknown) => T) {
  const item = record(result);
  return { items: list(item[key], size).map(parse), cursor: nextCursor(item.nextPageCursor) };
}

/** Bybit answers HTTP 200 with retCode 0 for success; any other code is its refusal. */
export function parseEnvelope(body: unknown): unknown {
  const envelope = record(body);
  const code = envelope.retCode;
  if (code === 0) return envelope.result;
  if (typeof code !== 'number') return invalid();
  const message = typeof envelope.retMsg === 'string' ? envelope.retMsg.slice(0, 160) : '';
  const detail = `Bybit answered: ${message.replace(/[^\x20-\x7e]/g, '') || 'no message'} (code ${code})`;
  // An invalid, expired, mis-signed or IP-bound key, or one without the permission needed.
  if ([10003, 10004, 10005, 10010, 33004].includes(code)) throw new Refused('key_rejected', detail);
  if ([10006, 10018].includes(code)) throw new Refused('rate_limited', detail);
  throw new Refused('unavailable', detail);
}

/** The signature Bybit checks: timestamp + key + receive window + query string. */
export function sign(secret: string, timestamp: string, apiKey: string, query: string): string {
  return createHmac('sha256', secret)
    .update(timestamp + apiKey + RECV_WINDOW + query)
    .digest('hex');
}

export class BybitClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private lastRequestAt = 0;

  constructor(options: { baseUrl?: string; timeoutMs?: number; pauseMs?: number } = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.pauseMs = options.pauseMs ?? 150;
  }

  keyInfo(key: BybitCredentials): Promise<BybitResult<BybitKeyInfo>> {
    return this.get(key, '/v5/user/query-api', [], parseKeyInfo);
  }

  /** Spot fills in [start, end]; Bybit allows at most seven days a request. */
  executions(key: BybitCredentials, start: number, end: number, cursor: string | null) {
    return this.get(
      key,
      '/v5/execution/list',
      [
        ['category', 'spot'],
        ['startTime', String(start)],
        ['endTime', String(end)],
        ['limit', String(TRADE_PAGE)],
        ...this.cursor(cursor),
      ],
      (result) => page(result, 'list', TRADE_PAGE, parseExecution),
    );
  }

  /** On-chain deposits in [start, end]; at most 30 days a request. */
  deposits(key: BybitCredentials, start: number, end: number, cursor: string | null) {
    return this.get(
      key,
      '/v5/asset/deposit/query-record',
      this.range(start, end, cursor),
      (result) => page(result, 'rows', RECORD_PAGE, parseDeposit),
    );
  }

  /** Transfers from other Bybit users in [start, end]; at most 30 days a request. */
  internalDeposits(key: BybitCredentials, start: number, end: number, cursor: string | null) {
    return this.get(
      key,
      '/v5/asset/deposit/query-internal-record',
      this.range(start, end, cursor),
      (result) => page(result, 'rows', RECORD_PAGE, parseInternalDeposit),
    );
  }

  /** Withdrawals on chain and to other Bybit users in [start, end]; at most 30 days. */
  withdrawals(key: BybitCredentials, start: number, end: number, cursor: string | null) {
    return this.get(
      key,
      '/v5/asset/withdraw/query-record',
      [['withdrawType', '2'], ...this.range(start, end, cursor)],
      (result) => page(result, 'rows', RECORD_PAGE, parseWithdrawal),
    );
  }

  /**
   * Every coin of one of the account's wallets: FUND (funding) or UNIFIED (trading). The
   * all-coins endpoint answers for UNIFIED only when asked for at most ten coins by name
   * (code 131203), so the trading account is read from its wallet balance instead.
   */
  balances(key: BybitCredentials, accountType: 'FUND' | 'UNIFIED') {
    if (accountType === 'UNIFIED')
      return this.get(
        key,
        '/v5/account/wallet-balance',
        [['accountType', 'UNIFIED']],
        parseWalletBalance,
      );
    return this.get(
      key,
      '/v5/asset/transfer/query-account-coins-balance',
      [['accountType', accountType]],
      parseBalances,
    );
  }

  /** BYBIT-EARN: what the account holds in one Earn product (the key's Earn permission). */
  earnPositions(key: BybitCredentials, category: BybitEarnCategory) {
    return this.get(key, '/v5/earn/position', [['category', category]], parseEarnPositions);
  }

  /** BYBIT-EARN: the account's active fixed-term savings. */
  fixedTermPositions(key: BybitCredentials) {
    return this.get(key, '/v5/earn/fixed-term/position', [], parseFixedTermPositions);
  }

  /** BYBIT-EARN: yield paid in [start, end]; at most seven days a request, three months back. */
  earnYield(
    key: BybitCredentials,
    category: BybitEarnCategory,
    start: number,
    end: number,
    cursor: string | null,
  ) {
    return this.get(
      key,
      '/v5/earn/yield',
      [
        ['category', category],
        ['startTime', String(start)],
        ['endTime', String(end)],
        ['limit', String(YIELD_PAGE)],
        ...this.cursor(cursor),
      ],
      parseEarnYield,
    );
  }

  /** BYBIT-CONVERT: one page of every convert, newest first (the key's Exchange permission). */
  convertHistory(key: BybitCredentials, index: number) {
    return this.get(
      key,
      '/v5/asset/exchange/query-convert-history',
      [
        ['index', String(index)],
        ['limit', String(CONVERT_PAGE)],
      ],
      parseConvertHistory,
    );
  }

  /** BYBIT-CONVERT: older coin exchanges, made before converts were listed in full. */
  coinExchanges(key: BybitCredentials, cursor: string | null) {
    return this.get(
      key,
      '/v5/asset/exchange/order-record',
      [['limit', String(RECORD_PAGE)], ...this.cursor(cursor)],
      (result) => {
        const item = record(result);
        return {
          items: list(item.orderBody ?? [], RECORD_PAGE).map(parseCoinExchange),
          cursor: nextCursor(item.nextPageCursor),
        };
      },
    );
  }

  private range(start: number, end: number, cursor: string | null): [string, string][] {
    return [
      ['startTime', String(start)],
      ['endTime', String(end)],
      ['limit', String(RECORD_PAGE)],
      ...this.cursor(cursor),
    ];
  }

  private cursor(cursor: string | null): [string, string][] {
    return cursor === null ? [] : [['cursor', cursor]];
  }

  private async get<T>(
    key: BybitCredentials,
    path: string,
    params: [string, string][],
    parse: (result: unknown) => T,
  ): Promise<BybitResult<T>> {
    // Every value is plain text the API takes verbatim, so the signed text is the sent text.
    if (params.some(([, value]) => !cursorPattern.test(value)))
      return { ok: false, reason: 'invalid_response', detail: null };
    const query = params.map(([name, value]) => `${name}=${value}`).join('&');
    const wait = this.lastRequestAt + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const timestamp = String(Date.now());
    let response: { status: number; data: string };
    try {
      response = await axios.get<string>(`${this.baseUrl}${path}${query ? `?${query}` : ''}`, {
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        headers: {
          Accept: 'application/json',
          'X-BAPI-API-KEY': key.apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'X-BAPI-SIGN': sign(key.apiSecret, timestamp, key.apiKey, query),
        },
      });
    } catch {
      return { ok: false, reason: 'unavailable', detail: null };
    } finally {
      this.lastRequestAt = Date.now();
    }
    // Bybit answers 403 when an IP exceeds its request limit.
    if (response.status === 403 || response.status === 429)
      return { ok: false, reason: 'rate_limited', detail: null };
    if (response.status === 401) return { ok: false, reason: 'key_rejected', detail: null };
    if (response.status !== 200) return { ok: false, reason: 'unavailable', detail: null };
    try {
      return { ok: true, value: parse(parseEnvelope(JSON.parse(response.data))) };
    } catch (error) {
      if (error instanceof Refused)
        return { ok: false, reason: error.reason, detail: error.detail };
      return { ok: false, reason: 'invalid_response', detail: null };
    }
  }
}
