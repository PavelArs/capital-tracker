import { EntityManager } from 'typeorm';
import type { ValuationPrice } from './historical-valuation';
import { parseDecimal } from './input';

interface PriceRow {
  instrumentId: string;
  observedAt: Date;
  priceUsd: string | null;
  revision: number;
  kind: 'set' | 'void';
  quoteCurrency: string;
}

/** Indexed latest-point reads, in the same transaction as reconstructed holdings. */
export async function readValuationPrices(
  manager: EntityManager,
  owner: string,
  instrumentIds: readonly string[],
  instants: readonly string[],
): Promise<ValuationPrice[]> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Valuation price read requires transaction');
  if (instrumentIds.length === 0) return [];
  const rows: PriceRow[] = await manager.query(
    `SELECT price.* FROM unnest($2::uuid[]) AS instruments(id)
      CROSS JOIN unnest($3::timestamptz[]) AS points(at)
      CROSS JOIN LATERAL (
        SELECT v."instrumentId", v."observedAt", v."priceUsd"::text, v.revision, v.kind,
          v."quoteCurrency"
        FROM manual_usd_price_versions v
        WHERE v."ownerId"=$1 AND v."instrumentId"=instruments.id AND v."observedAt"=points.at
        ORDER BY v.revision DESC LIMIT 1
      ) price`,
    [owner, instrumentIds, instants],
  );
  // Filtering first would incorrectly resurrect an earlier version of a void point. These
  // valuations are in USD: a hand value set in RUB or EUR has no USD price here, so it reads
  // as missing, never converted at a guessed rate (AST-MANUAL-VALUE).
  return rows
    .filter((row) => row.kind === 'set' && row.quoteCurrency === 'USD')
    .map((row) => ({
      instrumentId: row.instrumentId,
      observedAt: row.observedAt.toISOString(),
      priceUsd: parseDecimal(row.priceUsd, false),
      revision: row.revision,
    }));
}
