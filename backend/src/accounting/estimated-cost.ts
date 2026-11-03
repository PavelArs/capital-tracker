import type { EntityManager } from 'typeorm';
import { type AccountingCurrency, FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import { QUOTE_CURRENCY } from '../prices/price-catalog';
import { parseDecimal } from './input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import {
  type PortfolioAccountInput,
  type PortfolioInstrument,
  resolvePrice,
  type StoredPrice,
} from './portfolio-valuation';
import type { FifoSplit } from './share-split-types';

const ATOM = 10n ** 30n;

/** The key of the stored price nearest one lot's arrival: its asset and the instant. */
export const nearKey = (instrumentId: string, at: string) =>
  `${instrumentId}|${new Date(at).toISOString()}`;

/**
 * COST-ESTIMATE: a held lot with no purchase price is costed at the price stored nearest the time
 * it came in (`near`: the latest at or before it, else the first after), in USD at that day's
 * Bank of Russia rate, in the units held now (a split after the price divides it), rounded up at
 * 30 places so the profit never reads higher, and marked `costEstimated`. A missing price or rate
 * leaves the cost unknown; so do cash (its face value is no estimate) and a property.
 */
export function withEstimatedCosts(
  accounts: readonly PortfolioAccountInput[],
  instruments: readonly PortfolioInstrument[],
  near: ReadonlyMap<string, StoredPrice>,
  splits: readonly FifoSplit[],
  usd: FxConverter,
  /** The valuation instant: the lots are in the units held then. */
  at: string = new Date().toISOString(),
): PortfolioAccountInput[] {
  const valuedAt = Date.parse(at);
  const byId = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  return accounts.map((account) => ({
    ...account,
    lots: account.lots.map((lot) => {
      const instrument = byId.get(lot.instrumentId);
      // Cash has its face value, and a property's price is the owner's own estimate of it now.
      if (
        lot.costUsd !== null ||
        !instrument ||
        instrument.priceSource === 'fixed' ||
        account.assetClass === 'property'
      )
        return lot;
      const stored = near.get(nearKey(lot.instrumentId, lot.acquiredAt));
      if (!stored) return lot;
      const market = new Map<string, StoredPrice>();
      const manual = new Map<string, StoredPrice>();
      if (instrument.priceSource === 'market')
        market.set(instrument.symbol?.toUpperCase() ?? '', stored);
      else manual.set(instrument.id, stored);
      // The price comes per unit of its own day, or of the arrival when it is earlier.
      const { price } = resolvePrice(
        instrument,
        { market, manual, splits },
        new Date(lot.acquiredAt),
        usd,
      );
      if (!price) return lot;
      // The lot's quantity is in the units held at the valuation: a split between divides it.
      const unitsAt = Math.max(Date.parse(lot.acquiredAt), Date.parse(stored.observedAt));
      const ratio = splits.reduce(
        (units, split) =>
          split.instrumentId === lot.instrumentId &&
          Date.parse(split.effectiveAt) > unitsAt &&
          Date.parse(split.effectiveAt) <= valuedAt
            ? units * BigInt(split.ratio)
            : units,
        1n,
      );
      const product = canonicalDecimalToAtoms(lot.quantity) * canonicalDecimalToAtoms(price.value);
      const scale = ATOM * ratio;
      return { ...lot, costUsd: formatAtoms((product + scale - 1n) / scale), costEstimated: true };
    }),
  }));
}

interface NearRow {
  instrumentId: string;
  at: Date;
  price: string;
  observedAt: Date;
  source: string;
  currency: AccountingCurrency;
  /** BPH-SPLIT: when a broker price was read; its units are of that instant. */
  fetchedAt: Date | null;
}

/**
 * COST-ESTIMATE: for each lot without a purchase price, the stored price nearest the time it
 * came in, read as the valuation reads prices: a market price of the asset's symbol, else a hand
 * value still standing or a broker price of the asset. The latest at or before the time wins,
 * else the first after it.
 */
export async function readNearPrices(
  manager: EntityManager,
  owner: string,
  requests: readonly { instrumentId: string; at: string }[],
): Promise<Map<string, StoredPrice>> {
  if (requests.length === 0) return new Map();
  const side = (before: boolean) => {
    const [compare, order] = before ? ['<=', 'DESC'] : ['>', 'ASC'];
    return `
      (SELECT p.price::text AS price, p."observedAt", p.source, 'USD' AS currency,
          NULL::timestamptz AS "fetchedAt"
        FROM price_observations p
        WHERE i."priceSource"='market' AND p.asset=upper(i.symbol) AND p."quoteCurrency"=$4
          AND p."observedAt"${compare}r.at
        ORDER BY p."observedAt" ${order} LIMIT 1)
      UNION ALL
      (SELECT h."priceUsd"::text, h."observedAt", 'manual', h."quoteCurrency", NULL::timestamptz
        FROM (SELECT DISTINCT ON (v."observedAt") v."observedAt", v.kind, v."priceUsd", v."quoteCurrency"
          FROM manual_usd_price_versions v
          WHERE i."priceSource"='manual' AND v."ownerId"=$1 AND v."instrumentId"=i.id
          ORDER BY v."observedAt", v.revision DESC) h
        WHERE h.kind='set' AND h."observedAt"${compare}r.at
        ORDER BY h."observedAt" ${order} LIMIT 1)
      UNION ALL
      (SELECT b.price::text, b."observedAt", b.provider, b."quoteCurrency", b."fetchedAt"
        FROM broker_price_observations b
        WHERE i."priceSource"='manual' AND b."ownerId"=$1 AND b."instrumentId"=i.id
          AND b."observedAt"${compare}r.at
        ORDER BY b."observedAt" ${order} LIMIT 1)`;
  };
  const rows: NearRow[] = await manager.query(
    `SELECT r.id AS "instrumentId", r.at, c.price, c."observedAt", c.source, c.currency,
        c."fetchedAt"
      FROM unnest($2::uuid[], $3::timestamptz[]) AS r(id, at)
      JOIN accounting_instruments i ON i."ownerId"=$1 AND i.id=r.id
      CROSS JOIN LATERAL (${side(true)} UNION ALL ${side(false)}) c`,
    [
      owner,
      requests.map((request) => request.instrumentId),
      requests.map((request) => request.at),
      QUOTE_CURRENCY,
    ],
  );
  // Per request: the latest price at or before its time, else the earliest after it.
  const best = new Map<string, NearRow>();
  for (const row of rows) {
    const key = nearKey(row.instrumentId, row.at.toISOString());
    const known = best.get(key);
    const before = row.observedAt <= row.at;
    const knownBefore = known !== undefined && known.observedAt <= known.at;
    const better =
      !known ||
      (before && !knownBefore) ||
      (before && knownBefore && row.observedAt > known.observedAt) ||
      (!before && !knownBefore && row.observedAt < known.observedAt);
    if (better) best.set(key, row);
  }
  return new Map(
    [...best].map(([key, row]) => [
      key,
      {
        priceUsd: parseDecimal(row.price, false),
        observedAt: row.observedAt.toISOString(),
        source: row.source,
        currency: row.currency,
        ...(row.fetchedAt ? { unitsAt: row.fetchedAt.toISOString() } : {}),
      },
    ]),
  );
}

/** COST-ESTIMATE: the accounts with each lot that has no purchase price costed on arrival. */
export async function estimatedAccounts(
  manager: EntityManager,
  owner: string,
  instruments: readonly PortfolioInstrument[],
  accounts: readonly PortfolioAccountInput[],
  splits: readonly FifoSplit[],
  rates: FxRates,
  at: string,
): Promise<PortfolioAccountInput[]> {
  const priced = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const requests = new Map<string, { instrumentId: string; at: string }>();
  for (const account of accounts)
    for (const lot of account.lots) {
      const source = priced.get(lot.instrumentId)?.priceSource;
      if (
        lot.costUsd === null &&
        source !== undefined &&
        source !== 'fixed' &&
        account.assetClass !== 'property'
      )
        requests.set(nearKey(lot.instrumentId, lot.acquiredAt), {
          instrumentId: lot.instrumentId,
          at: lot.acquiredAt,
        });
    }
  const near = await readNearPrices(manager, owner, [...requests.values()]);
  return withEstimatedCosts(accounts, instruments, near, splits, new FxConverter(rates, 'USD'), at);
}
