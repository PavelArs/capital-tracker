import type { EntityManager } from 'typeorm';
import type { ChainObservation } from './esplora-client';

/** Stores a page of observations of one wallet once each; returns how many were new. */
export async function insertObservations(
  manager: EntityManager,
  address: { ownerId: string; id: string },
  page: ChainObservation[],
): Promise<number> {
  if (page.length === 0) return 0;
  const values: unknown[] = [];
  const rows = page.map((tx) => {
    const base = values.length;
    values.push(
      address.ownerId,
      address.id,
      tx.txid,
      tx.blockHeight,
      tx.blockHash,
      tx.blockTime,
      tx.receivedSats.toString(),
      tx.sentSats.toString(),
      tx.feeSats.toString(),
      tx.direction,
      JSON.stringify(tx.raw),
    );
    const slot = (offset: number) => `$${base + offset}`;
    return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},${slot(5)},${slot(6)},${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)}::numeric,${slot(10)},${slot(11)}::jsonb)`;
  });
  const inserted: { txid: string }[] = await manager.query(
    `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
      "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw)
      VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
    values,
  );
  return inserted.length;
}
