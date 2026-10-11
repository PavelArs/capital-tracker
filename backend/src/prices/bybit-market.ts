import {
  getJson,
  invalid,
  type PriceFailure,
  positiveDecimal,
  type Quote,
  type QuoteKind,
  record,
} from './price-providers';

// BYBIT-ANY-COIN: a coin of a Bybit account that Kraken and CoinGecko are not asked for is priced
// from Bybit's public spot market, its pair with USDT, counted as dollars as the app counts
// USDT everywhere else. No key: market data is public and free.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
// Closed daily candles Bybit sends in one answer, about two years and nine months.
const DAILY_CANDLES = 1000;
// Bitcoin's genesis block; nothing priced here can be older.
const EARLIEST_MS = Date.parse('2009-01-03T00:00:00Z');
const CLOCK_SKEW_MS = 600_000;
// Bybit's code for a symbol it does not list.
const NOT_LISTED = 10001;

/** A coin with no USDT pair on Bybit's spot market. */
export type BybitMarketMiss = PriceFailure | 'not_listed';

/**
 * Bybit's kline answer: { retCode: 0, result: { symbol, list: [[start, open, high, low, close,
 * volume, turnover], …] } }, newest first, start in milliseconds as text. Only candles closed
 * by `now` are kept, oldest first, each observed at its close (start + interval).
 */
export function parseBybitCandles(
  body: unknown,
  intervalMs: number,
  nowMs: number,
): { closedAt: number; close: string }[] | BybitMarketMiss {
  try {
    const response = record(body);
    if (response.retCode === NOT_LISTED) return 'not_listed';
    if (response.retCode !== 0) return 'unavailable';
    const list = record(response.result).list;
    if (!Array.isArray(list) || list.length > DAILY_CANDLES) invalid();
    const closed: { closedAt: number; close: string }[] = [];
    let later = Number.POSITIVE_INFINITY;
    for (const entry of list as unknown[]) {
      if (!Array.isArray(entry) || entry.length < 5 || typeof entry[0] !== 'string') invalid();
      if (!/^[0-9]{1,15}$/.test(entry[0])) invalid();
      const start = Number(entry[0]);
      if (start < EARLIEST_MS || start > nowMs + CLOCK_SKEW_MS || start % intervalMs !== 0)
        invalid();
      if (start >= later) invalid();
      later = start;
      const close = positiveDecimal(entry[4]);
      if (start + intervalMs <= nowMs) closed.push({ closedAt: start + intervalMs, close });
    }
    return closed.reverse();
  } catch {
    return 'invalid_response';
  }
}

export class BybitMarketClient {
  readonly source = 'bybit' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.bybit.com';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** The coin's last closed hourly candle. */
  async latest(code: string, now: Date): Promise<Quote | BybitMarketMiss> {
    const candles = await this.candles(code, '60', HOUR_MS, 3, now);
    if (!Array.isArray(candles)) return candles;
    const last = candles.at(-1);
    // A coin listed within the hour has no closed candle yet.
    return last ? this.quote(code, last, 'hourly-close') : 'unavailable';
  }

  /** Every closed daily candle Bybit sends for the coin, oldest first. */
  async daily(code: string, now: Date): Promise<Quote[] | BybitMarketMiss> {
    const candles = await this.candles(code, 'D', DAY_MS, DAILY_CANDLES, now);
    if (!Array.isArray(candles)) return candles;
    return candles.map((candle) => this.quote(code, candle, 'daily-close'));
  }

  private quote(code: string, candle: { closedAt: number; close: string }, kind: QuoteKind) {
    return {
      asset: code,
      price: candle.close,
      observedAt: new Date(candle.closedAt).toISOString(),
      kind,
      source: this.source,
    };
  }

  private async candles(
    code: string,
    interval: string,
    intervalMs: number,
    limit: number,
    now: Date,
  ) {
    const query = new URLSearchParams({
      category: 'spot',
      symbol: `${code}USDT`,
      interval,
      limit: String(limit),
    });
    const fetched = await getJson(`${this.baseUrl}/v5/market/kline?${query}`, this.timeoutMs);
    if (!fetched.ok) return fetched.reason;
    return parseBybitCandles(fetched.body, intervalMs, now.getTime());
  }
}
