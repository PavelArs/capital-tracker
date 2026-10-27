import type { EntityManager } from 'typeorm';
import { canonicalDecimalToAtoms } from '../accounting/money';
import { instrumentFacts, resolveLinks, type SavedLink } from './broker-instrument-links';
import type { TBankOperation, TBankPosition } from './tbank-client';

/** BPR-1: one usable current price T-Bank reported for a linked security. */
export interface BrokerPrice {
  instrumentId: string;
  price: string;
  currency: 'RUB' | 'USD' | 'EUR';
}

const securityTypes = ['share', 'bond', 'etf'];
export const priceCurrencies: Record<string, BrokerPrice['currency']> = {
  rub: 'RUB',
  usd: 'USD',
  eur: 'EUR',
};
const positive = (value: string) =>
  /^\d+(\.\d+)?$/.test(value) && canonicalDecimalToAtoms(value) > 0n;
const held = (position: TBankPosition) =>
  !position.virtual &&
  securityTypes.includes(position.instrumentType) &&
  positive(position.quantity);
const fallbackName = (uid: string) => `T-Bank ${uid}`;

/**
 * BPR-1: the lowest price of each asset, never a better figure than the real one; an asset whose
 * prices name two currencies keeps none.
 */
export function lowestPrices(prices: readonly BrokerPrice[]): BrokerPrice[] {
  const found = new Map<string, BrokerPrice | null>();
  for (const price of prices) {
    if (!found.has(price.instrumentId)) {
      found.set(price.instrumentId, price);
      continue;
    }
    const earlier = found.get(price.instrumentId);
    if (!earlier) continue;
    if (earlier.currency !== price.currency) found.set(price.instrumentId, null);
    else if (canonicalDecimalToAtoms(price.price) < canonicalDecimalToAtoms(earlier.price))
      found.set(price.instrumentId, price);
  }
  return [...found.values()]
    .filter((item): item is BrokerPrice => item !== null)
    .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
}

/**
 * BPR-1: the price of each held share, bond or ETF linked to an asset, when T-Bank gives a
 * positive one in RUB, USD or EUR. Two venues of one asset keep the lower price.
 */
export function pickPrices(
  positions: readonly TBankPosition[],
  linked: ReadonlyMap<string, string>,
): BrokerPrice[] {
  const prices: BrokerPrice[] = [];
  for (const position of positions) {
    const instrumentId = linked.get(position.instrumentUid);
    const currency = priceCurrencies[position.currentPriceCurrency];
    if (!instrumentId || !held(position) || !currency || !positive(position.currentPrice)) continue;
    prices.push({ instrumentId, price: position.currentPrice, currency });
  }
  return lowestPrices(prices);
}

/**
 * BPR-4: an asset still named "T-Bank <uid>" with no ticker, made before its ticker could be read,
 * takes the one ticker the operations of that security name. Any other name stays.
 */
export function fallbackRenames(
  links: readonly SavedLink[],
  operations: readonly TBankOperation[],
): { instrumentId: string; ticker: string }[] {
  const renames: { instrumentId: string; ticker: string }[] = [];
  for (const link of links) {
    if (link.symbol !== null || link.name !== fallbackName(link.uid)) continue;
    const tickers = new Set(
      operations
        .filter(
          (operation) =>
            operation.ticker &&
            (operation.instrumentUid === link.uid || operation.providerInstrumentUid === link.uid),
        )
        .map((operation) => operation.ticker),
    );
    if (tickers.size === 1) renames.push({ instrumentId: link.id, ticker: [...tickers][0] });
  }
  return renames;
}

/**
 * The saved asset of each held security of this history, resolved as the import resolves it;
 * undefined when the links disagree, so nothing is guessed.
 */
async function heldLinks(
  manager: EntityManager,
  owner: string,
  operations: readonly TBankOperation[],
  positions: readonly TBankPosition[],
): Promise<Map<string, SavedLink> | undefined> {
  const wanted = new Set(positions.filter(held).map((item) => item.instrumentUid));
  if (wanted.size === 0) return new Map();
  // Gifts are not holdings: the import resolves identities without them too.
  const facts = instrumentFacts(wanted, [
    ...operations,
    ...positions.filter((item) => !item.virtual),
  ]);
  if (!facts) return undefined;
  const saved: SavedLink[] = await manager.query(
    `SELECT l."providerInstrumentId" AS uid, l."assetUid", l."instrumentType", i.id, i.name,
        i.symbol
      FROM broker_instrument_links l JOIN accounting_instruments i
        ON i."ownerId" = l."ownerId" AND i.id = l."instrumentId"
      WHERE l."ownerId" = $1 AND l.provider = 'tbank'
        AND (l."providerInstrumentId" = ANY($2::text[]) OR l."assetUid" = ANY($3::uuid[]))`,
    [
      owner,
      [...facts.values()].flatMap((fact) => [...fact.uids]),
      [...facts.values()].flatMap((fact) => (fact.assetUid ? [fact.assetUid] : [])),
    ],
  );
  return resolveLinks(facts, saved);
}

/**
 * BPR-2: the current price of each held linked security of one account's history, after naming a
 * fallback-named asset by its ticker (BPR-4); 'conflict' when the saved links disagree with it.
 */
export async function readBrokerPrices(
  manager: EntityManager,
  owner: string,
  history: { operations: readonly TBankOperation[]; positions?: readonly TBankPosition[] },
): Promise<BrokerPrice[] | 'conflict'> {
  const positions = history.positions ?? [];
  const links = await heldLinks(manager, owner, history.operations, positions);
  if (!links) return 'conflict';
  const byId = new Map([...links.values()].map((link) => [link.id, link]));
  for (const { instrumentId, ticker } of fallbackRenames([...byId.values()], history.operations))
    await manager.query(
      `UPDATE accounting_instruments SET name = $3, symbol = $3
        WHERE "ownerId" = $1 AND id = $2 AND symbol IS NULL AND name = $4`,
      [owner, instrumentId, ticker, fallbackName(byId.get(instrumentId)!.uid)],
    );
  return pickPrices(positions, new Map([...links].map(([uid, link]) => [uid, link.id])));
}

/** BPR-2: stores prices read at `observedAt`; returns how many were new. */
export function insertBrokerPrices(
  manager: EntityManager,
  owner: string,
  prices: readonly BrokerPrice[],
  observedAt: Date,
): Promise<number> {
  return insertObservations(
    manager,
    owner,
    prices.map((item) => ({ ...item, observedAt })),
  );
}

/** BPR-2, BPH-CLOSE: stores prices each at its own instant; returns how many were new. */
export async function insertObservations(
  manager: EntityManager,
  owner: string,
  prices: readonly (BrokerPrice & { observedAt: Date })[],
): Promise<number> {
  if (prices.length === 0) return 0;
  const saved: unknown[] = await manager.query(
    `INSERT INTO broker_price_observations ("ownerId", "instrumentId", provider, "observedAt", price,
        "quoteCurrency")
      SELECT $1, item.instrument, 'tbank', item.at, item.price, item.currency
        FROM unnest($2::uuid[], $3::timestamptz[], $4::numeric[], $5::text[])
          AS item(instrument, at, price, currency)
      ON CONFLICT DO NOTHING RETURNING "instrumentId"`,
    [
      owner,
      prices.map((item) => item.instrumentId),
      prices.map((item) => item.observedAt),
      prices.map((item) => item.price),
      prices.map((item) => item.currency),
    ],
  );
  return saved.length;
}

/** One account's prices, read and stored; links that disagree store none. */
export async function saveBrokerPrices(
  manager: EntityManager,
  owner: string,
  history: { operations: readonly TBankOperation[]; positions?: readonly TBankPosition[] },
  observedAt: Date,
): Promise<number | 'conflict'> {
  const prices = await readBrokerPrices(manager, owner, history);
  return prices === 'conflict' ? prices : insertBrokerPrices(manager, owner, prices, observedAt);
}
