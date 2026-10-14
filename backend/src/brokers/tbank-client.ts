import { Agent } from 'node:https';
import { rootCertificates } from 'node:tls';
import axios from 'axios';

// BROKER-CONNECT: the T-Invest API (T-Bank's free broker API) read with the owner's read-only
// token. Requests are JSON over HTTPS to the REST gateway of the gRPC contract; the token goes
// in the Authorization header only and is never logged or returned.
const DEFAULT_BASE_URL = 'https://invest-public-api.tbank.ru/rest';
const CONTRACT = 'tinkoff.public.invest.api.contract.v1';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Why T-Bank gave nothing: its own trouble, or a token it no longer accepts. */
export type TBankFailure = 'rate_limited' | 'unavailable' | 'invalid_response' | 'token_rejected';
export type TBankResult<T> = { ok: true; value: T } | { ok: false; reason: TBankFailure };

/** What the token may do with one broker account. */
export type TBankAccess = 'read_only' | 'full_access' | 'no_access';

export interface TBankAccount {
  id: string;
  name: string;
  open: boolean;
  /** Closed for good: nothing can be done with it, whatever the token allows. */
  closed: boolean;
  access: TBankAccess;
  /** An Invest Box (Инвесткопилка): T-Bank gives no portfolio for it. */
  investBox: boolean;
}

/** One position the token reads in a broker account, with prices as exact decimal text. */
export interface TBankPosition {
  instrumentUid: string;
  instrumentType: string;
  currency: string;
  quantity: string;
  averagePrice: string;
  currentPrice: string;
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

/** The token as T-Bank issues it: plain letters, digits, dots, dashes and underscores. */
export const tokenPattern = /^[0-9A-Za-z._-]{20,200}$/;
export const isTBankToken = (value: unknown): value is string =>
  typeof value === 'string' && tokenPattern.test(value);
const idPattern = /^[0-9A-Za-z_-]{1,64}$/;

const accessLevels: Record<string, TBankAccess> = {
  ACCOUNT_ACCESS_LEVEL_READ_ONLY: 'read_only',
  ACCOUNT_ACCESS_LEVEL_FULL_ACCESS: 'full_access',
  ACCOUNT_ACCESS_LEVEL_NO_ACCESS: 'no_access',
};

export function parseAccounts(body: unknown): TBankAccount[] {
  const list = record(body).accounts;
  if (!Array.isArray(list) || list.length > 100) return invalid();
  return list.map((value) => {
    const item = record(value);
    const id = item.id;
    if (typeof id !== 'string' || !idPattern.test(id)) return invalid();
    const name = typeof item.name === 'string' ? item.name.slice(0, 120) : '';
    const level = typeof item.accessLevel === 'string' ? accessLevels[item.accessLevel] : undefined;
    return {
      id,
      name,
      open: item.status === 'ACCOUNT_STATUS_OPEN',
      // Any other status (new, unspecified or one the contract adds) may still become usable.
      closed: item.status === 'ACCOUNT_STATUS_CLOSED',
      // A token or an account the contract does not describe is treated as able to trade.
      access: level ?? 'full_access',
      investBox: item.type === 'ACCOUNT_TYPE_INVEST_BOX',
    };
  });
}

/**
 * A Quotation or MoneyValue (int64 units as text, int32 nano) as exact decimal text, so a price
 * never passes through a float. JSON leaves out a zero part, so an absent part reads as zero.
 */
export function decimal(value: unknown): string {
  const item = record(value);
  const units =
    item.units === undefined ? '0' : typeof item.units === 'string' ? item.units : invalid();
  const nano = item.nano === undefined ? 0 : typeof item.nano === 'number' ? item.nano : invalid();
  if (!/^-?\d{1,18}$/.test(units) || !Number.isInteger(nano) || Math.abs(nano) > 999_999_999)
    return invalid();
  const negative = units.startsWith('-') || nano < 0;
  const whole = units.replace('-', '');
  const fraction = Math.abs(nano).toString().padStart(9, '0').replace(/0+$/, '');
  return `${negative && (whole !== '0' || fraction) ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function parsePositions(body: unknown): TBankPosition[] {
  const list = record(body).positions ?? [];
  if (!Array.isArray(list) || list.length > 500) return invalid();
  return list.map((value) => {
    const item = record(value);
    const uid = item.instrumentUid;
    if (typeof uid !== 'string' || !idPattern.test(uid)) return invalid();
    const average = item.averagePositionPrice ? record(item.averagePositionPrice) : {};
    const type = typeof item.instrumentType === 'string' ? item.instrumentType : '';
    return {
      instrumentUid: uid,
      // T-Bank names the type in lower case: share, bond, etf, currency, futures.
      instrumentType: /^[a-z_]{1,40}$/.test(type) ? type : 'unknown',
      currency: typeof average.currency === 'string' ? average.currency : '',
      // A position without a quantity is a broken answer, not an empty holding.
      quantity: decimal(item.quantity),
      averagePrice: item.averagePositionPrice ? decimal(average) : '',
      currentPrice: item.currentPrice ? decimal(item.currentPrice) : '',
    };
  });
}

export class TBankClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly agent: Agent | undefined;

  /**
   * T-Bank's gateway is signed by a root the usual public stores do not carry, so the owner's
   * server needs it added: `extraRoots` are trusted next to the built-in ones, for this client
   * only. Verification itself stays on.
   */
  constructor(options: { baseUrl?: string; timeoutMs?: number; extraRoots?: string[] } = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.agent = options.extraRoots?.length
      ? new Agent({ ca: [...rootCertificates, ...options.extraRoots] })
      : undefined;
  }

  /** Every broker account the token can see (GetAccounts). */
  accounts(token: string): Promise<TBankResult<TBankAccount[]>> {
    return this.call(token, 'UsersService/GetAccounts', {}, parseAccounts);
  }

  /** What the token reads in one broker account now (GetPortfolio). */
  portfolio(token: string, accountId: string): Promise<TBankResult<TBankPosition[]>> {
    return this.call(token, 'OperationsService/GetPortfolio', { accountId }, parsePositions);
  }

  private async call<T>(
    token: string,
    method: string,
    body: Record<string, unknown>,
    parse: (body: unknown) => T,
  ): Promise<TBankResult<T>> {
    let response: { status: number; data: string };
    try {
      response = await axios.post<string>(`${this.baseUrl}/${CONTRACT}.${method}`, body, {
        // axios' timeout is an idle timeout; the signal bounds the whole response.
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        httpsAgent: this.agent,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (response.status === 401 || response.status === 403)
      return { ok: false, reason: 'token_rejected' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      return { ok: true, value: parse(JSON.parse(response.data)) };
    } catch {
      return { ok: false, reason: 'invalid_response' };
    }
  }
}
