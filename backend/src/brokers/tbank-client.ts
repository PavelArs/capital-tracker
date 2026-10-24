import { Agent } from 'node:https';
import { rootCertificates } from 'node:tls';
import axios from 'axios';

// BROKER-CONNECT: the T-Invest API (T-Bank's free broker API) read with the owner's read-only
// token. Requests are JSON over HTTPS to the REST gateway of the gRPC contract; the token goes
// in the Authorization header only and is never logged or returned.
const DEFAULT_BASE_URL = 'https://invest-public-api.tbank.ru/rest';
const CONTRACT = 'tinkoff.public.invest.api.contract.v1';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Why T-Bank gave nothing: its own trouble, a token it no longer accepts, or more history than
 * one read takes.
 */
export type TBankFailure =
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'token_rejected'
  | 'too_many_operations';
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
  positionUid?: string;
  providerInstrumentUid?: string;
  instrumentType: string;
  /** Import-only CurrencyBy metadata distinguishes cash from commodities. */
  currencyCode?: string;
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

/** Where an operation stands at T-Bank; only an executed one has happened. */
export type TBankOperationState = 'executed' | 'canceled' | 'progress' | 'unspecified';

/** One operation T-Bank lists for a broker account, with amounts as exact decimal text. */
export interface TBankOperation {
  id: string;
  /** The operation this one belongs to (a trade's fee names its trade), '' for none. */
  parentId: string;
  /** T-Bank's own name, such as OPERATION_TYPE_BUY, or 'unknown'. */
  type: string;
  state: TBankOperationState;
  /** When T-Bank recorded the operation; for a trade, when it was ordered (see `fills`). */
  occurredAt: string;
  instrumentUid: string;
  positionUid?: string;
  /** The asset behind the instrument: one fund traded on two venues is one asset. */
  assetUid?: string;
  providerInstrumentUid?: string;
  instrumentType: string;
  ticker: string;
  /** Whole units the operation moved: for a trade, the filled part, not the ordered one. */
  quantity: string;
  /** What the operation moved in cash, signed as T-Bank gives it (a buy is negative). */
  payment: string;
  paymentCurrency: string;
  price: string;
  priceCurrency: string;
  commission: string;
  commissionCurrency: string;
  /** When and at what price a trade was filled, part by part; empty for any other operation. */
  fills: TBankFill[];
}

/** One fill of a trade: an order may fill in parts and on later days. */
export interface TBankFill {
  filledAt: string;
  quantity: string;
  price: string;
  priceCurrency: string;
}

/** One page of operations and the cursor of the next, '' after the last. */
export interface TBankOperationsPage {
  operations: TBankOperation[];
  nextCursor: string;
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

function uidReference<K extends 'positionUid' | 'assetUid'>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  if (value === undefined || value === '') return {};
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    return invalid();
  return { [key]: value.toLowerCase() } as Partial<Record<K, string>>;
}
const positionReference = (value: unknown) => uidReference('positionUid', value);

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
  // An object with neither a currency nor an amount is no price; a real zero names its currency.
  if (item.currency === undefined && item.units === undefined && item.nano === undefined)
    return { amount: '', currency: '' };
  return {
    amount: decimal(item),
    currency: typeof item.currency === 'string' ? item.currency : '',
  };
}

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
// T-Bank stamps cash operations to the whole second and fills to fractions of one, so a tax could
// replay before the sale that paid it; every time is kept to the whole second.
const wholeSecond = (time: string) => time.replace(/\.\d+Z$/, 'Z');

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
    ...positionReference(item.positionUid),
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
export function parsePositions(body: unknown, accountId: string): TBankPosition[] {
  const answer = record(body);
  if (answer.accountId !== undefined && answer.accountId !== accountId) return invalid();
  // JSON may leave out an empty list, but only an answer that names this account says it is
  // empty; a bare `{}` is a broken answer, not an account with nothing in it.
  if (answer.positions === undefined && answer.accountId !== accountId) return invalid();
  const held = answer.positions ?? [];
  const gifts = answer.virtualPositions ?? [];
  if (!Array.isArray(held) || !Array.isArray(gifts) || held.length + gifts.length > 500)
    return invalid();
  const positions = held.map((value) => position(value, false));
  if (new Set(positions.map((item) => item.instrumentUid)).size !== positions.length)
    return invalid();
  return [...positions, ...gifts.map((value) => position(value, true))];
}

// A page of 250 stays well under the body limit even with every field and fill T-Bank gives.
const OPERATIONS_PER_PAGE = 250;
/** 200 pages of 250: far more than a personal account holds, and a bound on one read. */
const MAX_OPERATION_PAGES = 200;
/** An operation id; T-Bank gives digits, but the contract only promises a string. */
const operationIdPattern = /^[0-9A-Za-z._:-]{1,128}$/;

const operationStates: Record<string, TBankOperationState> = {
  OPERATION_STATE_EXECUTED: 'executed',
  OPERATION_STATE_CANCELED: 'canceled',
  OPERATION_STATE_PROGRESS: 'progress',
};
const text = (value: unknown, pattern: RegExp) =>
  typeof value === 'string' && pattern.test(value) ? value : '';

/** An int64 count: JSON gives it as text, a lenient encoder as a whole number, a zero not at all. */
function count(value: unknown): string {
  if (value === undefined) return '0';
  if (typeof value === 'string' && /^-?\d{1,18}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return invalid();
}

const emptyOperation: TBankOperation = {
  id: '',
  parentId: '',
  type: 'unknown',
  state: 'unspecified',
  occurredAt: '',
  instrumentUid: '',
  instrumentType: '',
  ticker: '',
  quantity: '0',
  payment: '',
  paymentCurrency: '',
  price: '',
  priceCurrency: '',
  commission: '',
  commissionCurrency: '',
  fills: [],
};

function fill(value: unknown): TBankFill {
  const item = record(value);
  const date = item.date;
  if (typeof date !== 'string' || !timestampPattern.test(date)) return invalid();
  const unit = price(item.price);
  return {
    filledAt: wholeSecond(date),
    quantity: count(item.quantity),
    price: unit.amount,
    priceCurrency: unit.currency,
  };
}

/**
 * The units an operation moved. An executed trade may be filled only in part, so the filled
 * count wins over the ordered one; JSON leaves out a zero, so a missing filled count is what
 * was ordered less what is left.
 */
function movedQuantity(item: Record<string, unknown>): string {
  const ordered = count(item.quantity);
  if (item.quantityDone !== undefined) return count(item.quantityDone);
  return (BigInt(ordered) - BigInt(count(item.quantityRest))).toString();
}

function operation(value: unknown): TBankOperation {
  const item = record(value);
  const state = (typeof item.state === 'string' && operationStates[item.state]) || 'unspecified';
  try {
    return executedShape(item, state);
  } catch (error) {
    // Only an executed operation is ever recorded, so an odd canceled or pending one is kept
    // as a bare count instead of making the whole history unreadable.
    if (state === 'executed') throw error;
    return { ...emptyOperation, state };
  }
}

function executedShape(item: Record<string, unknown>, state: TBankOperationState): TBankOperation {
  const id = item.id;
  if (typeof id !== 'string' || !operationIdPattern.test(id)) return invalid();
  // An operation without a time cannot be placed in the history, so the answer is broken.
  const date = item.date;
  if (typeof date !== 'string' || !timestampPattern.test(date)) return invalid();
  const payment = price(item.payment);
  const unit = price(item.price);
  const commission = price(item.commission);
  const fills = item.tradesInfo === undefined ? [] : (record(item.tradesInfo).trades ?? []);
  if (!Array.isArray(fills) || fills.length > 1000) return invalid();
  return {
    id,
    parentId: text(item.parentOperationId, operationIdPattern),
    type: text(item.type, /^OPERATION_TYPE_[A-Z_]{1,60}$/) || 'unknown',
    state,
    occurredAt: wholeSecond(date),
    instrumentUid: text(item.instrumentUid, idPattern),
    ...positionReference(item.positionUid),
    ...uidReference('assetUid', item.assetUid),
    instrumentType: text(item.instrumentType, /^[a-z_]{1,40}$/),
    ticker: text(item.ticker, /^[0-9A-Za-z._-]{1,32}$/),
    quantity: movedQuantity(item),
    payment: payment.amount,
    paymentCurrency: payment.currency,
    price: unit.amount,
    priceCurrency: unit.currency,
    commission: commission.amount,
    commissionCurrency: commission.currency,
    fills: fills.map(fill),
  };
}

/**
 * One GetOperationsByCursor page. An account with no operations answers `{}` (JSON leaves out
 * an empty list and a false flag), so an absent list reads as empty here.
 */
export function parseOperationsPage(body: unknown): TBankOperationsPage {
  const answer = record(body);
  const items = answer.items ?? [];
  if (!Array.isArray(items) || items.length > OPERATIONS_PER_PAGE) return invalid();
  // A flag that is neither true nor false (nor left out as false) could hide later pages.
  if (answer.hasNext !== undefined && typeof answer.hasNext !== 'boolean') return invalid();
  const hasNext = answer.hasNext === true;
  const cursor = typeof answer.nextCursor === 'string' ? answer.nextCursor : '';
  if (hasNext && !/^[\x21-\x7e]{1,512}$/.test(cursor)) return invalid();
  return { operations: items.map(operation), nextCursor: hasNext ? cursor : '' };
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
    return this.call(token, 'OperationsService/GetPortfolio', { accountId }, (body) =>
      parsePositions(body, accountId),
    );
  }

  /** The documented CurrencyBy ISO code; never infer cash identity from a price. */
  currencyCode(token: string, uid: string): Promise<TBankResult<string>> {
    return this.call(
      token,
      'InstrumentsService/CurrencyBy',
      { idType: 'INSTRUMENT_ID_TYPE_UID', id: uid },
      (body) => {
        const instrument = record(record(body).instrument);
        if (
          instrument.uid !== uid ||
          typeof instrument.isoCurrencyName !== 'string' ||
          !/^[A-Za-z]{3}$/.test(instrument.isoCurrencyName)
        )
          return invalid();
        return instrument.isoCurrencyName.toUpperCase();
      },
    );
  }

  /** Every operation of one broker account, oldest page first (GetOperationsByCursor). */
  async operations(token: string, accountId: string): Promise<TBankResult<TBankOperation[]>> {
    const all: TBankOperation[] = [];
    let cursor = '';
    for (let page = 0; page < MAX_OPERATION_PAGES; page += 1) {
      const body: Record<string, unknown> = {
        accountId,
        from: '2000-01-01T00:00:00Z',
        to: new Date().toISOString(),
        limit: OPERATIONS_PER_PAGE,
        // The fills say when a trade was filled; the operation's own date is when it was ordered.
        withoutTrades: false,
        withoutCommissions: false,
        withoutOvernights: false,
        ...(cursor ? { cursor } : {}),
      };
      const result = await this.call(
        token,
        'OperationsService/GetOperationsByCursor',
        body,
        parseOperationsPage,
      );
      if (!result.ok) return result;
      all.push(...result.value.operations);
      if (!result.value.nextCursor) return { ok: true, value: all };
      cursor = result.value.nextCursor;
    }
    return { ok: false, reason: 'too_many_operations' };
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
