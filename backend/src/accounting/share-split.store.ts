import type { EntityManager } from 'typeorm';
import { OwnedTransferCapacityError } from './owned-transfer-fifo';
import { type FifoSplit, SPLIT_LIMITS } from './share-split-types';

/** The owner's share splits still in force, oldest first. */
export async function readSplits(manager: EntityManager, owner: string): Promise<FifoSplit[]> {
  const rows: { id: string; instrumentId: string; effectiveAt: Date; ratio: number }[] =
    await manager.query(
      `SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits
        WHERE "ownerId"=$1 AND "removedAt" IS NULL ORDER BY "effectiveAt", id LIMIT $2`,
      [owner, SPLIT_LIMITS.activeSplits + 1],
    );
  if (rows.length > SPLIT_LIMITS.activeSplits) throw new OwnedTransferCapacityError();
  return rows.map((row) => ({
    splitId: row.id,
    instrumentId: row.instrumentId,
    effectiveAt: row.effectiveAt.toISOString(),
    ratio: row.ratio,
  }));
}
