import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { loadChainTokens } from '../wallet-addresses/chain-tokens';
import { BybitMarketClient, type BybitMarketMiss } from './bybit-market';
import { extraMarketCodes } from './market-codes';
import { latestMarketPrices } from './market-price.store';
import { MARKET_ASSETS, QUOTE_CURRENCY } from './price-catalog';
import {
  failureMessage,
  freshness,
  gatherQuotes,
  isDue,
  nextRunAt,
  type SourceOutcome,
} from './price-collection';
import { CoinGeckoClient, KrakenClient, type PriceFailure, type Quote } from './price-providers';

export type CollectionResult =
  | { outcome: 'collected'; stored: number; backfilled: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

// Owner decision Q4: the chart history starts on 1 January 2025.
export const BACKFILL_FROM = new Date('2025-01-01T00:00:00Z');
const BACKFILL_KEY = 'prices:backfill';
const PROVIDER_KEYS = { kraken: 'prices:kraken', coingecko: 'prices:coingecko' } as const;
const BYBIT_KEY = 'prices:bybit';
const TOKENS_KEY = 'prices:tokens';
// TOKEN-ANY-PRICE: tokens asked of CoinGecko in one run, in requests of TOKENS_PER_REQUEST.
const MAX_TOKENS = 120;
const TOKENS_PER_REQUEST = 30;
// A token CoinGecko did not know is asked about again after this long.
const UNLISTED_RECHECK_MS = 24 * 3_600_000;
// BYBIT-ANY-COIN: coins asked of Bybit's market in one run, two requests each at most.
const MAX_BYBIT_COINS = 50;
const BYBIT_MISS_TEXT: Record<BybitMarketMiss, string> = {
  not_listed: 'has no USDT market for',
  unavailable: 'did not answer for',
  rate_limited: 'rate limit reached for',
  invalid_response: 'sent an unreadable answer for',
};
// Arbitrary constant identifying the price collector's session advisory lock.
const LOCK_KEY = 7_340_600_001;
const INTERRUPTED_AFTER_MS = 15 * 60_000;
const INSERT_BATCH = 1000;

interface SourceRow {
  key: string;
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}
const iso = (date: Date | null) => date?.toISOString() ?? null;

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService,
    private readonly kraken: KrakenClient,
    private readonly coingecko: CoinGeckoClient,
    private readonly bybit: BybitMarketClient,
  ) {}

  private get enabled(): boolean {
    return this.config.get('PRICE_COLLECTION_ENABLED') === 'true';
  }

  // Interval jobs stay registered when BACKGROUND_JOBS_ENABLED=false disables cron jobs;
  // this one has its own explicit switch.
  @Interval(5 * 60_000)
  async scheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch {
      this.logger.warn('Hourly price collection could not finish');
    }
  }

  async tick(now = new Date()): Promise<CollectionResult> {
    if (!this.enabled) return { outcome: 'disabled' };
    return this.collect(now, true);
  }

  // Runs one collection; with onlyIfDue, skips it when the hour already had one.
  async collect(now = new Date(), onlyIfDue = false): Promise<CollectionResult> {
    // A transaction-scoped advisory lock on a dedicated connection: one run at a time,
    // released by the rollback below or by the connection ending, never left behind.
    const runner = this.source.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      try {
        const [lock]: { locked: boolean }[] = await runner.query(
          'SELECT pg_try_advisory_xact_lock($1) AS locked',
          [LOCK_KEY],
        );
        if (!lock.locked) return { outcome: 'busy' };
        // Checked under the lock so a run that just finished elsewhere is not repeated.
        if (onlyIfDue && !isDue(await this.lastAttempt(), now)) return { outcome: 'not_due' };
        const backfilled = await this.backfill(now);
        const stored = await this.collectLatest(now);
        const bybit = await this.collectBybit(now);
        const tokens = await this.collectTokens(now);
        return {
          outcome: 'collected',
          stored: stored + bybit.stored + tokens,
          backfilled: backfilled + bybit.backfilled,
        };
      } finally {
        await runner.rollbackTransaction();
      }
    } finally {
      await runner.release();
    }
  }

  private async lastAttempt(): Promise<Date | null> {
    const [row]: { at: Date | null }[] = await this.source.query(
      `SELECT max("lastAttemptAt") AS at FROM sync_sources WHERE key = ANY($1)`,
      [Object.values(PROVIDER_KEYS)],
    );
    return row?.at ?? null;
  }

  private async collectLatest(now: Date): Promise<number> {
    const { quotes, outcomes } = await gatherQuotes(now, MARKET_ASSETS, {
      kraken: this.kraken,
      coingecko: this.coingecko,
    });
    return this.source.transaction(async (manager) => {
      const stored = await this.insert(manager, quotes);
      for (const [provider, outcome] of Object.entries(outcomes)) {
        await this.record(
          manager,
          PROVIDER_KEYS[provider as keyof typeof PROVIDER_KEYS],
          outcome,
          now,
        );
      }
      return stored;
    });
  }

  /**
   * BYBIT-ANY-COIN: every market-priced coin the catalog does not list, priced from Bybit's
   * spot market: the last closed hourly candle, and once per coin the daily candles Bybit keeps,
   * so a transaction can be valued at its time. A coin Bybit does not list stays without a price.
   */
  private async collectBybit(now: Date): Promise<{ stored: number; backfilled: number }> {
    const codes = (await extraMarketCodes(this.source)).slice(0, MAX_BYBIT_COINS);
    if (codes.length === 0) return { stored: 0, backfilled: 0 };
    const done: { asset: string }[] = await this.source.query(
      `SELECT DISTINCT asset FROM price_observations
       WHERE kind = 'daily-close' AND source = 'bybit' AND "quoteCurrency" = $1
         AND asset = ANY($2)`,
      [QUOTE_CURRENCY, codes],
    );
    const complete = new Set(done.map(({ asset }) => asset));
    const history: Quote[] = [];
    const quotes: Quote[] = [];
    const missed = new Map<string, BybitMarketMiss>();
    for (const code of codes) {
      const latest = await this.bybit.latest(code, now);
      if (typeof latest === 'string') {
        missed.set(code, latest);
        continue;
      }
      quotes.push(latest);
      if (complete.has(code)) continue;
      const daily = await this.bybit.daily(code, now);
      if (typeof daily !== 'string') history.push(...daily);
    }
    const reasons = [...new Set(missed.values())];
    const text = reasons
      .map((reason) => {
        const names = codes.filter((code) => missed.get(code) === reason);
        return `Bybit ${BYBIT_MISS_TEXT[reason]} ${names.join(', ')}`;
      })
      .join('; ');
    const outcome: SourceOutcome =
      missed.size === 0
        ? { state: 'synced', errorCode: null, errorMessage: null }
        : quotes.length === 0 && !missed.has('not_listed')
          ? { state: 'failed', errorCode: reasons[0], errorMessage: text }
          : { state: 'delayed', errorCode: 'missing_assets', errorMessage: text };
    return this.source.transaction(async (manager) => {
      const backfilled = await this.insert(manager, history);
      const stored = await this.insert(manager, quotes);
      await this.record(manager, BYBIT_KEY, outcome, now);
      return { stored, backfilled };
    });
  }

  /**
   * TOKEN-ANY-PRICE: the tokens of Ethereum and Solana wallets that wallets hold now (a balance
   * above zero) are priced by contract from CoinGecko, hourly. A token CoinGecko does not list
   * gets no price: it is asked about once, when it first shows up, and its value stays unknown.
   * Such a token is spam (TOKEN-HIDE), so it is not asked about again unless the owner brings it
   * back, and the tokens the owner hid are not asked about at all. At most MAX_TOKENS are asked
   * per run, those checked longest ago first, so hundreds of unknown tokens cost a few requests
   * and never the whole run.
   */
  private async collectTokens(now: Date): Promise<number> {
    const due: { network: 'ethereum' | 'solana'; contract: string; ticker: string }[] =
      await this.source.query(
        `SELECT t.network, t.contract, t.ticker FROM chain_tokens t
          WHERE t.network IN ('ethereum', 'solana')
            AND (t."coingeckoId" IS NOT NULL OR t."priceCheckedAt" IS NULL
                 OR t."priceCheckedAt" <= $1)
            AND EXISTS (
              SELECT 1 FROM wallet_address_transactions x
                JOIN wallet_addresses a ON a.id = x."addressId"
               WHERE a.network = t.network AND x.asset = t.contract
                 AND t.contract <> ALL(a."hiddenTokens")
                 AND (t."coingeckoId" IS NOT NULL OR t."priceCheckedAt" IS NULL
                      OR t.contract = ANY(a."shownTokens"))
               GROUP BY a.id
              HAVING sum(x."receivedUnits") - sum(x."sentUnits") > 0)
          ORDER BY t."priceCheckedAt" NULLS FIRST, t.network, t.contract
          LIMIT $2`,
        [new Date(now.getTime() - UNLISTED_RECHECK_MS), MAX_TOKENS],
      );
    if (due.length === 0) return 0;
    const quotes: Quote[] = [];
    const priced: { network: string; contract: string }[] = [];
    const asked: { network: string; contract: string }[] = [];
    let failure: PriceFailure | null = null;
    for (const network of ['ethereum', 'solana'] as const) {
      const own = due.filter((token) => token.network === network);
      for (let start = 0; start < own.length && !failure; start += TOKENS_PER_REQUEST) {
        const batch = own.slice(start, start + TOKENS_PER_REQUEST);
        const answer = await this.coingecko.tokens(
          network,
          batch.map(({ contract }) => contract),
          now,
        );
        if (!answer.ok) {
          failure = answer.reason;
          break;
        }
        for (const token of batch) {
          asked.push(token);
          const found = answer.prices.get(token.contract);
          if (!found) continue;
          priced.push(token);
          quotes.push({
            asset: token.ticker,
            price: found.price,
            observedAt: found.observedAt,
            kind: 'spot',
            source: 'coingecko',
          });
        }
      }
    }
    const outcome: SourceOutcome = failure
      ? { state: 'failed', errorCode: failure, errorMessage: failureMessage('coingecko', failure) }
      : { state: 'synced', errorCode: null, errorMessage: null };
    const stored = await this.source.transaction(async (manager) => {
      const stored = await this.insert(manager, quotes);
      // The contract itself marks a token CoinGecko lists: the lookup key that found it.
      for (const token of asked) {
        const found = priced.some(
          (item) => item.network === token.network && item.contract === token.contract,
        );
        await manager.query(
          `UPDATE chain_tokens SET "priceCheckedAt" = $3,
             "coingeckoId" = CASE WHEN $4 THEN contract ELSE "coingeckoId" END
           WHERE network = $1 AND contract = $2`,
          [token.network, token.contract, now, found],
        );
      }
      await this.record(manager, TOKENS_KEY, outcome, now);
      return stored;
    });
    // What the app remembers of the tokens (whether a source lists one) follows the table.
    await loadChainTokens(this.source.manager);
    return stored;
  }

  // Kraken daily candles from 2025-01-01, until every catalog asset succeeded once.
  private async backfill(now: Date): Promise<number> {
    const [state]: SourceRow[] = await this.source.query(
      'SELECT * FROM sync_sources WHERE key = $1',
      [BACKFILL_KEY],
    );
    if (state?.lastSuccessAt) return 0;
    const done: { asset: string }[] = await this.source.query(
      `SELECT DISTINCT asset FROM price_observations
       WHERE kind = 'daily-close' AND source = 'kraken' AND "quoteCurrency" = $1`,
      [QUOTE_CURRENCY],
    );
    const complete = new Set(done.map(({ asset }) => asset));
    const quotes: Quote[] = [];
    const failed: string[] = [];
    let reason: PriceFailure | null = null;
    for (const asset of MARKET_ASSETS) {
      if (complete.has(asset.code)) continue;
      const result = await this.kraken.daily(asset, BACKFILL_FROM, now);
      if (result.ok) quotes.push(...result.quotes);
      else {
        failed.push(asset.code);
        reason ??= result.reason;
      }
    }
    return this.source.transaction(async (manager) => {
      const stored = await this.insert(manager, quotes);
      await this.record(
        manager,
        BACKFILL_KEY,
        failed.length
          ? {
              state: 'failed',
              errorCode: reason,
              errorMessage: `No history for ${failed.join(', ')}`,
            }
          : { state: 'synced', errorCode: null, errorMessage: null },
        now,
        null,
      );
      return stored;
    });
  }

  private async insert(manager: EntityManager, quotes: Quote[]): Promise<number> {
    let stored = 0;
    for (let start = 0; start < quotes.length; start += INSERT_BATCH) {
      const batch = quotes.slice(start, start + INSERT_BATCH);
      const rows: unknown[] = await manager.query(
        `INSERT INTO price_observations (asset, "quoteCurrency", source, "observedAt", price, kind)
         SELECT asset, $1, source, "observedAt", price, kind
         FROM unnest($2::text[], $3::text[], $4::timestamptz[], $5::numeric[], $6::text[])
           AS q(asset, source, "observedAt", price, kind)
         ON CONFLICT DO NOTHING RETURNING asset`,
        [
          QUOTE_CURRENCY,
          batch.map(({ asset }) => asset),
          batch.map(({ source }) => source),
          batch.map(({ observedAt }) => observedAt),
          batch.map(({ price }) => price),
          batch.map(({ kind }) => kind),
        ],
      );
      stored += rows.length;
    }
    return stored;
  }

  private async record(
    manager: EntityManager,
    key: string,
    outcome: SourceOutcome,
    now: Date,
    next: Date | null = nextRunAt(now),
  ): Promise<void> {
    const succeeded = outcome.state === 'synced';
    await manager.query(
      `INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt", "errorCode", "errorMessage")
       VALUES ($1, $2, $3, CASE WHEN $4 THEN $3::timestamptz END, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state,
         "lastAttemptAt" = EXCLUDED."lastAttemptAt",
         "lastSuccessAt" = COALESCE(EXCLUDED."lastSuccessAt", sync_sources."lastSuccessAt"),
         "nextRunAt" = EXCLUDED."nextRunAt", "errorCode" = EXCLUDED."errorCode",
         "errorMessage" = EXCLUDED."errorMessage"`,
      [key, outcome.state, now, succeeded, next, outcome.errorCode, outcome.errorMessage],
    );
  }

  async read(now = new Date()) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      // BYBIT-ANY-COIN: the catalog, then the coins priced from Bybit's market.
      const codes = [
        ...MARKET_ASSETS.map(({ code }) => code),
        ...(await extraMarketCodes(manager)).slice(0, MAX_BYBIT_COINS),
      ];
      const latest = await latestMarketPrices(manager, codes, now);
      const sources: SourceRow[] = await manager.query(
        `SELECT * FROM sync_sources WHERE key LIKE 'prices:%' ORDER BY key`,
      );
      const byAsset = new Map(latest.map((row) => [row.asset, row]));
      return {
        quoteCurrency: QUOTE_CURRENCY,
        assets: codes.map((code) => {
          const row = byAsset.get(code);
          const observedAt = row?.observedAt ?? null;
          return {
            asset: code,
            price: row?.price ?? null,
            quoteCurrency: QUOTE_CURRENCY,
            observedAt,
            source: row?.source ?? null,
            status: freshness(observedAt, now),
          };
        }),
        sources: sources.map((row) => {
          const interrupted =
            row.state === 'syncing' &&
            (!row.lastAttemptAt ||
              now.getTime() - row.lastAttemptAt.getTime() > INTERRUPTED_AFTER_MS);
          return {
            key: row.key,
            state: interrupted ? 'failed' : row.state,
            lastAttemptAt: iso(row.lastAttemptAt),
            lastSuccessAt: iso(row.lastSuccessAt),
            nextRunAt: iso(row.nextRunAt),
            errorCode: interrupted ? 'interrupted' : row.errorCode,
            errorMessage: interrupted ? 'Collection stopped before it finished' : row.errorMessage,
          };
        }),
      };
    });
  }
}
