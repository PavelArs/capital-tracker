import type { EntityManager } from 'typeorm';
import { readDustThreshold } from '../owner-settings/owner-settings.service';
import { latestMarketPrices } from '../prices/market-price.store';
import { chainAsset, formatUnits, isOtherToken, movesAnyToken, type Network } from './chain-assets';
import { openPoolDeposits } from './pool-tables';
import { stakeMoves, stakeRewards } from './stake-tables';
import { type HiddenReason, hiddenReason, isWorthless, tokenKey } from './token-visibility';

// TOKEN-HIDE, TOKEN-DUST: which of the other tokens an Ethereum or Solana address holds are left
// out of everything the app counts: the address's balances, the portfolio and the transaction
// lists. The raw legs stay as stored; an owner's choice brings any token back.

/** What the rules need of an address and what it holds. */
export interface TokenHolder {
  network: Network;
  /** TOKEN-BACKFILL: set while the stored history is read again for other tokens. */
  tokenBackfillTo: number | null;
  /** The contracts the owner hid, and ones the app would hide that the owner brought back. */
  hiddenTokens: string[];
  shownTokens: string[];
  /** Contracts of other tokens the address holds that are worth nothing; set by `withDust`. */
  dustTokens?: ReadonlySet<string>;
  /** Received minus sent per asset; null names the network's own coin. */
  balances: { asset: string | null; units: string }[];
}

/**
 * SQL: the balance of each asset of the address `a`, from its stored legs, its stake moves and
 * rewards and the coins it put into liquidity pools.
 */
export const balancesLateral = (address: string) => `CROSS JOIN LATERAL (
    SELECT coalesce(json_agg(json_build_object('asset', y.asset, 'units', y.units::text)),
      '[]'::json) AS balances
    FROM (SELECT z.asset, sum(z.units) AS units FROM (
        SELECT x.asset, x."receivedUnits" - x."sentUnits" AS units
          FROM wallet_address_transactions x WHERE x."addressId" = ${address}.id
        UNION ALL SELECT NULL, m.units FROM ${stakeMoves} m WHERE m."addressId" = ${address}.id
        UNION ALL SELECT NULL, r.units FROM ${stakeRewards} r WHERE r."addressId" = ${address}.id
        UNION ALL SELECT o.asset, o.units FROM ${openPoolDeposits} o
          WHERE o."addressId" = ${address}.id
      ) z GROUP BY z.asset) y) b`;

/**
 * TOKEN-HIDE: the other tokens the address holds that its balances leave out, by contract, and
 * why. Empty while the stored history is still read again for tokens (TOKEN-BACKFILL). With
 * `includeEmpty`, also the tokens the address holds none of, such as one that only passed
 * through it between two contracts.
 */
export function leftOut(row: TokenHolder, includeEmpty = false): Map<string, HiddenReason> {
  const found = new Map<string, HiddenReason>();
  if (row.tokenBackfillTo !== null) return found;
  for (const item of row.balances) {
    if (!isOtherToken(row.network, item.asset)) continue;
    // A token the address passed through and holds none of has no balance to leave out; its
    // legs still are left out of the lists (`includeEmpty`).
    if (!includeEmpty && BigInt(item.units) === 0n) continue;
    const reason = hiddenReason(
      chainAsset(row.network, item.asset),
      BigInt(item.units),
      row.hiddenTokens,
      row.shownTokens,
      row.dustTokens?.has(item.asset as string) ?? false,
    );
    if (reason) found.set(item.asset as string, reason);
  }
  return found;
}

/**
 * TOKEN-DUST: marks the other tokens each address holds that are worth nothing: no price source
 * lists them, or the owner's dust threshold is set and they are worth less by the latest stored
 * price.
 */
export async function withDust<Row extends TokenHolder>(
  manager: EntityManager,
  owner: string,
  rows: Row[],
): Promise<Row[]> {
  const candidates = rows.filter((row) => movesAnyToken(row.network));
  if (candidates.length === 0) return rows;
  const threshold = await readDustThreshold(manager, owner);
  // A token the address holds none of can only be worth nothing because no source lists it.
  const held = (row: TokenHolder) =>
    row.balances.filter((item) => isOtherToken(row.network, item.asset));
  const tickers = [
    ...new Set(
      candidates.flatMap((row) =>
        held(row).map((item) => chainAsset(row.network, item.asset).symbol),
      ),
    ),
  ];
  const prices = new Map(
    tickers.length === 0
      ? []
      : (await latestMarketPrices(manager, tickers, new Date())).map((item) => [
          item.asset,
          item.price,
        ]),
  );
  for (const row of candidates) {
    const dust = new Set<string>();
    for (const item of held(row)) {
      const asset = chainAsset(row.network, item.asset);
      const units = BigInt(item.units);
      if (
        isWorthless(
          asset,
          formatUnits(units, asset),
          units === 0n ? null : threshold,
          prices.get(asset.symbol),
        )
      )
        dust.add(item.asset as string);
    }
    row.dustTokens = dust;
  }
  return rows;
}

/**
 * Every token of every Ethereum or Solana address of the owner that is left out, as
 * `tokenKey(address, contract)`. The portfolio and the transaction lists skip the legs of these
 * tokens, so they show up nowhere.
 */
export async function leftOutTokens(
  manager: EntityManager,
  owner: string,
): Promise<ReadonlySet<string>> {
  const rows: (TokenHolder & { id: string })[] = await manager.query(
    `SELECT a.id, a.network, a."tokenBackfillTo", a."hiddenTokens", a."shownTokens", b.balances
      FROM wallet_addresses a ${balancesLateral('a')}
      WHERE a."ownerId" = $1 AND a.network IN ('ethereum', 'solana')`,
    [owner],
  );
  const keys = new Set<string>();
  for (const row of await withDust(manager, owner, rows))
    for (const contract of leftOut(row, true).keys()) keys.add(tokenKey(row.id, contract));
  return keys;
}
