import axios from 'axios';
import type { MarketAsset } from './price-catalog';

export type ProviderSource = 'kraken' | 'coingecko';
export type PriceFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
export type QuoteKind = 'hourly-close' | 'spot' | 'daily-close';
export interface Quote {
  asset: string;
  price: string;
  observedAt: string;
  kind: QuoteKind;
  source: ProviderSource;
}
export type QuoteResult =
  | { ok: true; quotes: Quote[]; missing: string[] }
  | { ok: false; reason: PriceFailure };
export type HistoryResult = { ok: true; quotes: Quote[] } | { ok: false; reason: PriceFailure };
export interface PriceProvider {
  readonly source: ProviderSource;
  latest(assets: readonly MarketAsset[], now: Date): Promise<QuoteResult>;
}

const HOUR_S = 3600;
const DAY_S = 86400;
// Bitcoin's genesis block; nothing priced here can be older.
const EARLIEST_S = Date.parse('2009-01-03T00:00:00Z') / 1000;
// Accept provider clocks slightly ahead of ours, never an observation from the future.
const CLOCK_SKEW_S = 600;
const MAX_BODY_BYTES = 1024 * 1024;

class InvalidResponse extends Error {}
function invalid(): never {
  throw new InvalidResponse();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function positiveDecimal(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{1,30}(\.[0-9]{1,30})?$/.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+/, '') || '0';
  const tail = fraction.replace(/0+$/, '');
  const result = tail ? `${integer}.${tail}` : integer;
  return result === '0' ? invalid() : result;
}
function instant(value: unknown, nowSeconds: number): number {
  return Number.isSafeInteger(value) &&
    (value as number) >= EARLIEST_S &&
    (value as number) <= nowSeconds + CLOCK_SKEW_S
    ? (value as number)
    : invalid();
}

type Fetched = { ok: true; body: unknown } | { ok: false; reason: PriceFailure };
async function getJson(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Fetched> {
  let response: { status: number; data: string };
  try {
    response = await axios.get<string>(url, {
      // axios' timeout is an idle timeout; the signal bounds the whole response.
      timeout: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
      maxRedirects: 0,
      maxContentLength: MAX_BODY_BYTES,
      responseType: 'text',
      transformResponse: [(data: string) => data],
      validateStatus: () => true,
      headers: { Accept: 'application/json', ...headers },
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (response.status === 429) return { ok: false, reason: 'rate_limited' };
  if (response.status !== 200) return { ok: false, reason: 'unavailable' };
  try {
    return { ok: true, body: JSON.parse(response.data) };
  } catch {
    return { ok: false, reason: 'invalid_response' };
  }
}

// Kraken OHLC: { error: [], result: { <pair>: [[time, o, h, l, close, vwap, volume, count]], last } }.
// The last candle is the current, uncommitted one; only closed candles are used.
export function parseKrakenCandles(
  body: unknown,
  intervalSeconds: number,
  nowSeconds: number,
): { closedAt: number; close: string }[] | PriceFailure {
  const response = record(body);
  if (!Array.isArray(response.error)) invalid();
  if (response.error.length) {
    // Public endpoints throttle with EGeneral:Too many requests, private ones with EAPI:Rate…
    return response.error.some(
      (item) =>
        typeof item === 'string' &&
        (item.startsWith('EAPI:Rate') || item.startsWith('EGeneral:Too many requests')),
    )
      ? 'rate_limited'
      : 'unavailable';
  }
  const series = Object.entries(record(response.result)).filter(([key]) => key !== 'last');
  if (series.length !== 1 || !Array.isArray(series[0][1])) invalid();
  const closed: { closedAt: number; close: string }[] = [];
  let previous = -1;
  for (const entry of series[0][1] as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 5) invalid();
    const time = instant(entry[0], nowSeconds);
    if (time % intervalSeconds !== 0 || time <= previous) invalid();
    previous = time;
    const close = positiveDecimal(entry[4]);
    if (time + intervalSeconds <= nowSeconds)
      closed.push({ closedAt: time + intervalSeconds, close });
  }
  return closed;
}

export class KrakenClient implements PriceProvider {
  readonly source = 'kraken' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pauseMs: number;
  private readonly retryPauseMs: number;
  private lastRequestAt = 0;

  constructor(
    options: { baseUrl?: string; timeoutMs?: number; pauseMs?: number; retryPauseMs?: number } = {},
  ) {
    this.baseUrl = options.baseUrl ?? 'https://api.kraken.com';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // Kraken documents about one public request per second; back-to-back calls at that
    // pace still failed every other request in production, so keep a wider gap.
    this.pauseMs = options.pauseMs ?? 2_000;
    // A throttled or dropped request is sent once more after this pause.
    this.retryPauseMs = options.retryPauseMs ?? 5_000;
  }

  async latest(assets: readonly MarketAsset[], now: Date): Promise<QuoteResult> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const since = Math.floor(nowSeconds / HOUR_S) * HOUR_S - 3 * HOUR_S;
    const quotes: Quote[] = [];
    const missing: string[] = [];
    const reasons: PriceFailure[] = [];
    for (const asset of assets) {
      const candles = await this.candles(asset, HOUR_S, since, nowSeconds);
      const last = Array.isArray(candles) ? candles.at(-1) : undefined;
      if (last) quotes.push(this.quote(asset, last, 'hourly-close'));
      else {
        missing.push(asset.code);
        reasons.push(Array.isArray(candles) ? 'invalid_response' : candles);
      }
    }
    return quotes.length || !reasons.length
      ? { ok: true, quotes, missing }
      : { ok: false, reason: reasons[0] };
  }

  // Closed daily candles from `from` on, each observed at its close (open + 1 day).
  async daily(asset: MarketAsset, from: Date, now: Date): Promise<HistoryResult> {
    const fromSeconds = Math.floor(from.getTime() / 1000);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const candles = await this.candles(asset, DAY_S, fromSeconds - 1, nowSeconds);
    if (!Array.isArray(candles)) return { ok: false, reason: candles };
    return {
      ok: true,
      quotes: candles
        .filter(({ closedAt }) => closedAt - DAY_S >= fromSeconds)
        .map((candle) => this.quote(asset, candle, 'daily-close')),
    };
  }

  private quote(
    asset: MarketAsset,
    candle: { closedAt: number; close: string },
    kind: QuoteKind,
  ): Quote {
    return {
      asset: asset.code,
      price: candle.close,
      observedAt: new Date(candle.closedAt * 1000).toISOString(),
      kind,
      source: this.source,
    };
  }

  private async candles(
    asset: MarketAsset,
    interval: number,
    since: number,
    nowSeconds: number,
  ): Promise<{ closedAt: number; close: string }[] | PriceFailure> {
    const first = await this.request(asset, interval, since, nowSeconds, this.pauseMs);
    if (first !== 'rate_limited' && first !== 'unavailable') return first;
    return this.request(asset, interval, since, nowSeconds, this.retryPauseMs);
  }

  private async request(
    asset: MarketAsset,
    interval: number,
    since: number,
    nowSeconds: number,
    pauseMs: number,
  ): Promise<{ closedAt: number; close: string }[] | PriceFailure> {
    const wait = this.lastRequestAt + pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const query = new URLSearchParams({
      pair: asset.krakenPair,
      interval: String(interval / 60),
      since: String(since),
    });
    let fetched: Fetched;
    try {
      fetched = await getJson(`${this.baseUrl}/0/public/OHLC?${query}`, this.timeoutMs);
    } finally {
      this.lastRequestAt = Date.now();
    }
    if (!fetched.ok) return fetched.reason;
    try {
      return parseKrakenCandles(fetched.body, interval, nowSeconds);
    } catch {
      return 'invalid_response';
    }
  }
}

// CoinGecko simple/price: { <id>: { usd: number, last_updated_at: seconds } }.
function geckoPrice(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid();
  // Shortest round-trip text of the JSON number; exponent forms are not accepted.
  return positiveDecimal(String(value));
}

export class CoinGeckoClient implements PriceProvider {
  readonly source = 'coingecko' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly demoKey: string | undefined;

  constructor(options: { baseUrl?: string; timeoutMs?: number; demoKey?: string } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.coingecko.com';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.demoKey = options.demoKey;
  }

  async latest(assets: readonly MarketAsset[], now: Date): Promise<QuoteResult> {
    const query = new URLSearchParams({
      ids: assets.map(({ coingeckoId }) => coingeckoId).join(','),
      vs_currencies: 'usd',
      include_last_updated_at: 'true',
      precision: 'full',
    });
    const fetched = await getJson(
      `${this.baseUrl}/api/v3/simple/price?${query}`,
      this.timeoutMs,
      this.demoKey ? { 'x-cg-demo-api-key': this.demoKey } : {},
    );
    if (!fetched.ok) return fetched;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    try {
      const body = record(fetched.body);
      const quotes: Quote[] = [];
      const missing: string[] = [];
      for (const asset of assets) {
        if (!Object.prototype.hasOwnProperty.call(body, asset.coingeckoId)) {
          missing.push(asset.code);
          continue;
        }
        const entry = record(body[asset.coingeckoId]);
        quotes.push({
          asset: asset.code,
          price: geckoPrice(entry.usd),
          observedAt: new Date(instant(entry.last_updated_at, nowSeconds) * 1000).toISOString(),
          kind: 'spot',
          source: this.source,
        });
      }
      return { ok: true, quotes, missing };
    } catch {
      return { ok: false, reason: 'invalid_response' };
    }
  }
}
