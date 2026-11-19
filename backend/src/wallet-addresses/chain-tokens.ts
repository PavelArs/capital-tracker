import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { marketTickers } from '../accounting/asset-classification';
import {
  type AnyTokenNetwork,
  type ChainAsset,
  chainAssets,
  movesAnyToken,
  networkAssets,
  rememberTokens,
} from './chain-assets';

// TOKEN-ANY (M25): the tokens beyond USDT and USDC that Ethereum and Solana wallets move, as
// chain_tokens keeps them. The chain names a token; the portfolio needs a ticker no other asset
// has, so a scam token copying a real one's symbol never adds to the real one's holding.

/** What the chain says about a token the first time a wallet moves it. */
export interface TokenFacts {
  network: AnyTokenNetwork;
  /** Ethereum: the lower-case contract; Solana: the mint. */
  contract: string;
  /** As the chain names it; null when it gives none. */
  symbol: string | null;
  name: string | null;
  decimals: number;
}

// Accounting quantities carry 30 decimals (money.ts): a token with more cannot be counted.
export const MAX_TOKEN_DECIMALS = 30;
// A ticker is what price_observations accepts: 2 to 15 capital letters and digits.
const MAX_TICKER = 15;
const MAX_TICKER_BASE = 10;
/**
 * TOKEN-TICKER (Codex Security #6): a new token's ticker is at least this long. An exchange coin
 * is named by its code of 2 to 8 characters (isBybitCoin) and the market coins by shorter ones,
 * so a token can never take a name a real coin will use, in whichever order they appear.
 */
export const MIN_TOKEN_TICKER = 9;
const MAX_SYMBOL = 32;
const MAX_NAME = 64;

/** Tickers no other token may take: the tracked coins, the market coins and the currencies. */
export const reservedTickers: ReadonlySet<string> = new Set([
  ...chainAssets.map((asset) => asset.symbol),
  ...marketTickers,
  'USD',
  'EUR',
  'RUB',
]);

/** Text a token chose for itself, without control characters and runs of spaces. */
export function tokenText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = [
    ...value
      .replace(/\p{Cc}|\p{Cf}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, maximum)
    .join('')
    .trim();
  return clean === '' ? null : clean;
}

/** The token's facts as stored: its symbol, else its name, else part of its contract. */
export function storedFacts(facts: TokenFacts): { symbol: string; name: string } {
  const symbol =
    tokenText(facts.symbol, MAX_SYMBOL) ??
    tokenText(facts.name, MAX_SYMBOL) ??
    alphanumeric(facts.contract).slice(0, 6);
  return { symbol, name: tokenText(facts.name, MAX_NAME) ?? symbol };
}

function alphanumeric(value: string): string {
  return value
    .replace(/^0x/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * The ticker a new token takes: its symbol in capitals and digits, with as much of the start of
 * its contract appended as makes it MIN_TOKEN_TICKER long ("SYN" becomes "SYN7F3A7F"), and more
 * while another asset has it. A symbol that long alone stays as it is.
 */
export function newTicker(
  symbol: string,
  contract: string,
  taken: (ticker: string) => boolean,
): string {
  let base = alphanumeric(symbol).slice(0, MAX_TICKER_BASE);
  const tail = alphanumeric(contract);
  if (base.length < 2) base = `T${base}`;
  for (
    let length = Math.max(0, MIN_TOKEN_TICKER - base.length);
    base.length + length <= MAX_TICKER && length <= tail.length;
    length++
  ) {
    const ticker = `${base}${tail.slice(0, length)}`;
    if (!taken(ticker)) return ticker;
  }
  // Fifteen characters of the contract alone, then shorter bases: never two tokens alike.
  for (let cut = base.length - 1; cut >= 1; cut--) {
    const ticker = `${base.slice(0, cut)}${tail.slice(0, MAX_TICKER - cut)}`;
    if (ticker.length >= MIN_TOKEN_TICKER && !taken(ticker)) return ticker;
  }
  throw new Error('No free ticker for the token');
}

interface TokenRow {
  network: string;
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  ticker: string;
  coingeckoId: string | null;
}

// TOKEN-HIDE: symbols a scam token borrows to pass for a real coin.
/** Whether a token's own symbol is the symbol of a tracked coin, such as "USDT" or "ETH". */
export const copiesTrackedCoin = (symbol: string): boolean =>
  reservedTickers.has(alphanumeric(symbol));

const asAsset = (row: TokenRow): ChainAsset | null =>
  movesAnyToken(row.network)
    ? {
        network: row.network,
        token: row.contract,
        symbol: row.ticker,
        name: row.name,
        decimals: row.decimals,
        contract: row.contract,
        listed: row.coingeckoId !== null,
        lookalike: copiesTrackedCoin(row.symbol),
      }
    : null;

/** Reads every stored token into the app's list of assets. */
export async function loadChainTokens(manager: EntityManager): Promise<number> {
  const rows: TokenRow[] = await manager.query(
    'SELECT network, contract, symbol, name, decimals, ticker, "coingeckoId" FROM chain_tokens',
  );
  rememberTokens(rows.flatMap((row) => asAsset(row) ?? []));
  return rows.length;
}

/** Every ticker an asset has: one asset key may name one coin only. */
async function takenTickers(manager: EntityManager): Promise<Set<string>> {
  const tickers: { ticker: string }[] = await manager.query(
    // Also a market asset's ticker, a Bybit coin say.
    `SELECT ticker FROM chain_tokens
     UNION SELECT upper(symbol) FROM accounting_instruments
      WHERE "assetType" = 'crypto' AND symbol IS NOT NULL`,
  );
  return new Set([...reservedTickers, ...tickers.map((row) => row.ticker)]);
}

/**
 * Stores the tokens not stored yet, each with a ticker no asset has, and remembers them. Runs
 * inside the transaction that stores the legs naming them; tokens are added one writer at a
 * time so two syncs never pick the same ticker. Returns the contracts that can be counted:
 * a token with more decimals than accounting keeps is left out with its legs.
 */
export async function registerChainTokens(
  manager: EntityManager,
  network: AnyTokenNetwork,
  found: readonly TokenFacts[],
): Promise<Set<string>> {
  const countable = found.filter(
    (item) =>
      item.network === network &&
      Number.isSafeInteger(item.decimals) &&
      item.decimals >= 0 &&
      item.decimals <= MAX_TOKEN_DECIMALS,
  );
  const contracts = [...new Set(countable.map((item) => item.contract))].sort();
  if (contracts.length === 0) return new Set();
  // One lock for every writer of chain_tokens (the text of "chain_tokens" as a key).
  await manager.query("SELECT pg_advisory_xact_lock(hashtext('chain_tokens'))");
  const stored: TokenRow[] = await manager.query(
    `SELECT network, contract, symbol, name, decimals, ticker, "coingeckoId" FROM chain_tokens
      WHERE network = $1 AND contract = ANY($2::text[])`,
    [network, contracts],
  );
  const known = new Set(stored.map((row) => row.contract));
  const fresh = contracts.flatMap((contract) => {
    if (known.has(contract)) return [];
    // The first report of a contract names it; later ones may differ only by provider quirks.
    const facts = countable.find((item) => item.contract === contract) as TokenFacts;
    return [{ contract, decimals: facts.decimals, ...storedFacts(facts) }];
  });
  const added: TokenRow[] = [];
  if (fresh.length > 0) {
    const taken = await takenTickers(manager);
    for (const item of fresh) {
      const ticker = newTicker(item.symbol, item.contract, (value) => taken.has(value));
      taken.add(ticker);
      const [row]: TokenRow[] = await manager.query(
        `INSERT INTO chain_tokens (network, contract, symbol, name, decimals, ticker)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING network, contract, symbol, name, decimals, ticker, "coingeckoId"`,
        [network, item.contract, item.symbol, item.name, item.decimals, ticker],
      );
      added.push(row);
    }
  }
  // Remembered before the legs commit: a token remembered for a rolled-back pass is stored
  // again, alike, by the next one.
  rememberTokens([...stored, ...added].flatMap((row) => asAsset(row) ?? []));
  return new Set(contracts);
}

/**
 * TOKEN-TICKER (Codex Security #6): an exchange account is about to record coins named by
 * `codes`. A token stored before tickers grew long (MIN_TOKEN_TICKER) may hold one of them; it
 * gives the code up for a long ticker of its own, so the coin and the token stay two assets, each
 * priced by its own source. The token keeps its asset (renamed, with its history) and the CoinGecko
 * prices stored under the old ticker are stored again under the new one; those left under the
 * old one are never read for the coin (namesItsAsset). A code the exchange already recorded
 * before is left as it is: its history was shared with the token before this rule, and moving
 * it would move the coin's records too. Runs in the transaction that stores the records, one
 * writer of chain_tokens at a time. Returns how many tokens were renamed: the caller reloads the
 * tokens (loadChainTokens) once its transaction has ended.
 */
export async function separateTokenTickers(
  manager: EntityManager,
  codes: Iterable<string>,
): Promise<number> {
  const short = [...new Set(codes)].filter((code) => code.length < MIN_TOKEN_TICKER).sort();
  if (short.length === 0) return 0;
  const read = (): Promise<TokenRow[]> =>
    manager.query(
      `SELECT network, contract, symbol, name, decimals, ticker, "coingeckoId" FROM chain_tokens
        WHERE ticker = ANY($1::text[]) ORDER BY ticker`,
      [short],
    );
  if ((await read()).length === 0) return 0;
  await manager.query("SELECT pg_advisory_xact_lock(hashtext('chain_tokens'))");
  const clashing = await read();
  if (clashing.length === 0) return 0;
  const recorded: { code: string }[] = await manager.query(
    `SELECT c.code FROM unnest($1::text[]) c(code)
      WHERE EXISTS (SELECT 1 FROM wallet_address_transactions x
        JOIN wallet_addresses a ON a.id = x."addressId"
        WHERE a.network = 'bybit' AND (x.asset = c.code OR x.raw->>'quoteAsset' = c.code))`,
    [clashing.map((row) => row.ticker)],
  );
  const shared = new Set(recorded.map((row) => row.code));
  const taken = await takenTickers(manager);
  let renamed = 0;
  for (const row of clashing) {
    if (shared.has(row.ticker)) continue;
    const ticker = newTicker(row.symbol, row.contract, (value) => taken.has(value));
    taken.add(ticker);
    await manager.query(
      'UPDATE chain_tokens SET ticker = $3 WHERE network = $1 AND contract = $2',
      [row.network, row.contract, ticker],
    );
    await manager.query(
      `UPDATE accounting_instruments SET symbol = $2
        WHERE "assetType" = 'crypto' AND "priceSource" = 'market' AND upper(symbol) = $1`,
      [row.ticker, ticker],
    );
    // Stored prices are append-only: the token's history is stored again under its new ticker.
    await manager.query(
      `INSERT INTO price_observations (asset, "quoteCurrency", source, "observedAt", price, kind)
        SELECT $2, "quoteCurrency", source, "observedAt", price, kind FROM price_observations
          WHERE asset = $1 AND source = 'coingecko'`,
      [row.ticker, ticker],
    );
    renamed++;
  }
  return renamed;
}

/**
 * The legs that can be stored: the network's own coin, USDT, USDC and the tokens
 * registerChainTokens found countable.
 */
export function countableLegs<T extends { asset: string | null }>(
  network: AnyTokenNetwork,
  legs: readonly T[],
  countable: ReadonlySet<string>,
): T[] {
  const builtIn = new Set(networkAssets(network).map((asset) => asset.token));
  return legs.filter((leg) => builtIn.has(leg.asset) || countable.has(leg.asset as string));
}

/** Reads the stored tokens once the app starts, before any request names one. */
@Injectable()
export class ChainTokenLoader implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChainTokenLoader.name);

  constructor(private readonly source: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await loadChainTokens(this.source.manager);
    } catch {
      // A database not migrated yet holds none; startup reports the schema itself.
      this.logger.warn('The stored chain tokens could not be read');
    }
  }
}
