import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { parseDecimal } from './input';
import type { TransferMovement } from './owned-transfer-input';

export type TransferKind = 'create' | 'correct' | 'void';
interface TransferLabels {
  instrumentName: string;
  instrumentSymbol: string | null;
  feeInstrumentName: string | null;
  feeInstrumentSymbol: string | null;
}
export interface TransferVersion extends TransferMovement, TransferLabels {
  transferId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: TransferKind;
  createdAt: string;
  fromAccountId: string;
  toAccountId: string;
  fromJournalRevision: number;
  toJournalRevision: number;
}
export interface TransferVersionRow extends Omit<TransferVersion, 'occurredAt' | 'createdAt'> {
  occurredAt: Date;
  createdAt: Date;
  canonicalPayload: string;
}
export interface TransferReceipt {
  journalRevision: number;
  transfer: TransferVersion;
}
export const TRANSFER_LIMITS = { activeTransfers: 1000, versions: 10000 } as const;
export const transferVersionSelect = `SELECT v.*,t."fromAccountId",t."toAccountId",
  i.name AS "instrumentName",i.symbol AS "instrumentSymbol",
  fee.name AS "feeInstrumentName",fee.symbol AS "feeInstrumentSymbol"
  FROM owned_transfer_versions v JOIN owned_transfers t
    ON t."ownerId"=v."ownerId" AND t.id=v."transferId"
  JOIN accounting_instruments i ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"
  LEFT JOIN accounting_instruments fee ON fee."ownerId"=v."ownerId" AND fee.id=v."feeInstrumentId"`;

export function projectTransferVersion(row: TransferVersionRow): TransferVersion {
  return {
    transferId: row.transferId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    fromJournalRevision: row.fromJournalRevision,
    toJournalRevision: row.toJournalRevision,
    instrumentId: row.instrumentId,
    occurredAt: row.occurredAt.toISOString(),
    orderWithinTimestamp: row.orderWithinTimestamp,
    quantity: parseDecimal(row.quantity, true),
    feeInstrumentId: row.feeInstrumentId,
    feeQuantity: parseDecimal(row.feeQuantity, false),
    instrumentName: row.instrumentName,
    instrumentSymbol: row.instrumentSymbol,
    feeInstrumentName: row.feeInstrumentName,
    feeInstrumentSymbol: row.feeInstrumentSymbol,
  };
}
export function transferReceipt(row: TransferVersionRow): TransferReceipt {
  const transfer = projectTransferVersion(row);
  return { journalRevision: transfer.journalRevision, transfer };
}
export async function readTransferRevision(manager: EntityManager, owner: string): Promise<number> {
  const [journal]: { currentRevision: number }[] = await manager.query(
    'SELECT "currentRevision" FROM owner_transfer_journals WHERE "ownerId"=$1',
    [owner],
  );
  return journal?.currentRevision ?? 0;
}
export async function readTransferHeads(
  manager: EntityManager,
  owner: string,
): Promise<TransferVersion[]> {
  const rows: TransferVersionRow[] = await manager.query(
    `${transferVersionSelect} WHERE v."ownerId"=$1 AND v.version=t."currentVersion"
      AND v.kind<>'void' ORDER BY t.id LIMIT 1001`,
    [owner],
  );
  if (rows.length > TRANSFER_LIMITS.activeTransfers)
    throw new ConflictException('Accounting transfer capacity exceeded');
  return rows.map(projectTransferVersion);
}
export async function readTransferHead(manager: EntityManager, owner: string, id: string) {
  const [row]: TransferVersionRow[] = await manager.query(
    `${transferVersionSelect} WHERE v."ownerId"=$1 AND v."transferId"=$2 AND v.version=t."currentVersion"`,
    [owner, id],
  );
  return row;
}
export async function readTransferReplay(manager: EntityManager, owner: string, requestId: string) {
  const [row]: TransferVersionRow[] = await manager.query(
    `${transferVersionSelect} WHERE v."ownerId"=$1 AND v."requestId"=$2`,
    [owner, requestId],
  );
  return row;
}
export async function readTransferParticipants(
  manager: EntityManager,
  owner: string,
  ids: readonly string[],
) {
  const rows: { id: string }[] = await manager.query(
    `SELECT DISTINCT participant.id FROM owned_transfers t
      CROSS JOIN LATERAL (VALUES(t."fromAccountId"),(t."toAccountId")) participant(id)
      WHERE t."ownerId"=$1 AND participant.id=ANY($2::uuid[])`,
    [owner, ids],
  );
  return new Set(rows.map((row) => row.id));
}

/** Called only after full candidate replay and all capacity/CAS checks under the owner lock. */
export async function appendTransferVersion(
  manager: EntityManager,
  owner: string,
  value: Omit<TransferVersion, 'createdAt'> & { canonicalPayload: string },
): Promise<TransferReceipt> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Transfer append requires transaction');
  await manager.query(
    'INSERT INTO owner_transfer_journals("ownerId","currentRevision") VALUES($1,0) ON CONFLICT DO NOTHING',
    [owner],
  );
  if (value.kind === 'create') {
    await manager.query(
      `INSERT INTO owned_transfers(id,"ownerId","fromAccountId","toAccountId","currentVersion")
      VALUES($1,$2,$3,$4,1)`,
      [value.transferId, owner, value.fromAccountId, value.toAccountId],
    );
  }
  const [row]: TransferVersionRow[] = await manager.query(
    `INSERT INTO owned_transfer_versions
      ("ownerId","transferId",version,"journalRevision","fromJournalRevision","toJournalRevision",
       "requestId","canonicalPayload",kind,"instrumentId","occurredAt","orderWithinTimestamp",
       quantity,"feeInstrumentId","feeQuantity")
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      owner,
      value.transferId,
      value.version,
      value.journalRevision,
      value.fromJournalRevision,
      value.toJournalRevision,
      value.requestId,
      value.canonicalPayload,
      value.kind,
      value.instrumentId,
      value.occurredAt,
      value.orderWithinTimestamp,
      value.quantity,
      value.feeInstrumentId,
      value.feeQuantity,
    ],
  );
  if (value.kind !== 'create') {
    await manager.query(
      'UPDATE owned_transfers SET "currentVersion"=$3 WHERE "ownerId"=$1 AND id=$2',
      [owner, value.transferId, value.version],
    );
  }
  await manager.query(
    'UPDATE owner_transfer_journals SET "currentRevision"=$2 WHERE "ownerId"=$1',
    [owner, value.journalRevision],
  );
  return transferReceipt({
    ...value,
    ...row,
    fromAccountId: value.fromAccountId,
    toAccountId: value.toAccountId,
    instrumentName: value.instrumentName,
    instrumentSymbol: value.instrumentSymbol,
    feeInstrumentName: value.feeInstrumentName,
    feeInstrumentSymbol: value.feeInstrumentSymbol,
  });
}
