import type { EntityManager } from 'typeorm';
import { jsonbText } from './jsonb-text';

/** A leg as wallet_address_transactions stores it; a chain's legs may carry no block or asset. */
interface Leg {
  txid: string;
  blockHeight?: number;
  blockHash?: string | null;
  blockTime: string;
  receivedUnits: bigint;
  sentUnits: bigint;
  feeUnits: bigint;
  direction: string;
  raw: Record<string, unknown>;
  asset?: string | null;
}

/** Columns a chain's legs have no value for, written into the statement as these constants. */
interface Fixed {
  blockHeight?: '0';
  blockHash?: 'NULL';
  asset?: 'NULL';
}

/** Stores legs of one wallet once each, in one statement; returns how many were new. */
export async function insertTransactions(
  manager: EntityManager,
  address: { ownerId: string; id: string },
  legs: readonly Leg[],
  fixed: Fixed = {},
): Promise<number> {
  if (legs.length === 0) return 0;
  const values: unknown[] = [];
  const bind = (value: unknown, cast = '') => {
    values.push(value);
    return `$${values.length}${cast}`;
  };
  // Bound in column order, so the parameters are numbered as the columns go.
  const rows = legs.map((leg) => {
    const cells = [
      bind(address.ownerId),
      bind(address.id),
      bind(leg.txid),
      fixed.blockHeight ?? bind(leg.blockHeight),
      fixed.blockHash ?? bind(leg.blockHash),
      bind(leg.blockTime),
      bind(leg.receivedUnits.toString(), '::numeric'),
      bind(leg.sentUnits.toString(), '::numeric'),
      bind(leg.feeUnits.toString(), '::numeric'),
      bind(leg.direction),
      bind(jsonbText(leg.raw), '::jsonb'),
      fixed.asset ?? bind(leg.asset),
    ];
    return `(${cells.join(',')})`;
  });
  const inserted: { txid: string }[] = await manager.query(
    `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
        "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw, asset)
        VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
    values,
  );
  return inserted.length;
}
