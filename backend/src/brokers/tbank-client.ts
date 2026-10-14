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
  quantity: string;
  /** Each price with its own currency; both '' when T-Bank gives no such price. */
  averagePrice: string;
  averagePriceCurrency: string;
  currentPrice: string;
  currentPriceCurrency: string;
  /** A gift (virtual) position: shown, but not owned until sold before it expires. */
  virtual: boolean;
  /** When a virtual position expires (RFC 3339), '' for a held one or when T-Bank gives none. */
  expiresAt: string;
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
  // The value is units + nano / 1e9 with both parts of one sign; parts of opposite signs are a
  // broken answer, not a value to guess at.
  const negative = units.startsWith('-');
  if ((negative && nano > 0) || (!negative && units !== '0' && nano < 0)) return invalid();
  const whole = units.replace('-', '');
  const fraction = Math.abs(nano).toString().padStart(9, '0').replace(/0+$/, '');
  const sign = (negative || nano < 0) && (whole !== '0' || fraction) ? '-' : '';
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** A MoneyValue as its amount and currency, both '' when T-Bank gives none. */
function price(value: unknown): { amount: string; currency: string } {
  if (value === undefined || value === null) return { amount: '', currency: '' };
  const item = record(value);
  return {
    amount: decimal(item),
    currency: typeof item.currency === 'string' ? item.currency : '',
  };
}

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function position(value: unknown, virtual: boolean): TBankPosition {
  const item = record(value);
  const uid = item.instrumentUid;
  if (typeof uid !== 'string' || !idPattern.test(uid)) return invalid();
  const type = typeof item.instrumentType === 'string' ? item.instrumentType : '';
  const average = price(item.averagePositionPrice);
  const current = price(item.currentPrice);
  const expires = virtual && typeof item.expireDate === 'string' ? item.expireDate : '';
  return {
    instrumentUid: uid,
    // T-Bank names the type in lower case: share, bond, etf, currency, futures.
    instrumentType: /^[a-z_]{1,40}$/.test(type) ? type : 'unknown',
    // A position without a quantity is a broken answer, not an empty holding.
    quantity: decimal(item.quantity),
    averagePrice: average.amount,
    averagePriceCurrency: average.currency,
    currentPrice: current.amount,
    currentPriceCurrency: current.currency,
    virtual,
    expiresAt: timestampPattern.test(expires) ? expires : '',
  };
}

/** The held positions, then the virtual (gift) ones T-Bank lists apart from them. */
export function parsePositions(body: unknown): TBankPosition[] {
  const answer = record(body);
  const held = answer.positions ?? [];
  const gifts = answer.virtualPositions ?? [];
  if (!Array.isArray(held) || !Array.isArray(gifts) || held.length + gifts.length > 500)
    return invalid();
  return [
    ...held.map((value) => position(value, false)),
    ...gifts.map((value) => position(value, true)),
  ];
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
