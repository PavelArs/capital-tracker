import type { EntityManager } from 'typeorm';
import type { Opening, Position } from './accounting.service';
import { parseDecimal } from './input';

export interface SnapshotRow {
  accountId: string;
  revision: number;
  requestId: string;
  asOf: Date;
  createdAt: Date;
  canonicalPayload: string;
}

export async function projectOpening(
  manager: EntityManager,
  owner: string,
  snapshot: SnapshotRow,
): Promise<Opening> {
  const rows: Position[] = await manager.query(
    `SELECT p."instrumentId",i.name AS "instrumentName",i.symbol AS "instrumentSymbol",p.quantity,p."costStatus",p."totalCostUsd"
      FROM account_opening_positions p JOIN accounting_instruments i ON i."ownerId"=p."ownerId" AND i.id=p."instrumentId"
      WHERE p."ownerId"=$1 AND p."accountId"=$2 AND p.revision=$3 ORDER BY p."instrumentId"`,
    [owner, snapshot.accountId, snapshot.revision],
  );
  return {
    accountId: snapshot.accountId,
    revision: snapshot.revision,
    requestId: snapshot.requestId,
    asOf: snapshot.asOf.toISOString(),
    createdAt: snapshot.createdAt.toISOString(),
    positions: rows.map((row) => ({
      ...row,
      quantity: parseDecimal(row.quantity, true),
      totalCostUsd: row.totalCostUsd === null ? null : parseDecimal(row.totalCostUsd, false),
    })),
  };
}

export async function readOpening(
  manager: EntityManager,
  owner: string,
  accountId: string,
  revision: number,
): Promise<Opening | null> {
  const [snapshot]: SnapshotRow[] = await manager.query(
    'SELECT * FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=$3',
    [owner, accountId, revision],
  );
  return snapshot ? projectOpening(manager, owner, snapshot) : null;
}
