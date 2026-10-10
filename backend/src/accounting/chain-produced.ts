import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** The journal entry kinds a chain classification produces, by the column that names them. */
export type ProducedColumn = 'tradeId' | 'rewardId' | 'swapId';

/**
 * CLS-PRODUCED: a trade, reward or swap that a blockchain classification created is changed or
 * deleted by changing that classification, never on its own. Voiding it alone would drop the
 * coins from the books while the classification still reads as answered, so the transaction
 * would no longer ask to be classified. The classification services write their own entries
 * through `mutateWithin`, which does not pass here.
 */
export async function refuseProducedEntry(
  manager: EntityManager,
  owner: string,
  column: ProducedColumn,
  id: string,
): Promise<void> {
  const [named] = await manager.query(
    `SELECT 1
      FROM chain_transaction_classifications h
      JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
        AND v.txid=h.txid AND v.version=h."currentVersion"
      WHERE v."ownerId"=$1 AND v.status='classified' AND v."${column}"::text=$2
      LIMIT 1`,
    [owner, id.toLowerCase()],
  );
  if (named)
    throw new ConflictException(
      'This entry was created by classifying a blockchain transaction; change that classification instead',
    );
}
