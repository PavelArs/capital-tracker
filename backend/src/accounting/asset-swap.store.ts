import type { EntityManager } from 'typeorm';
import type { FifoSwap } from './asset-swap-types';
import { parseDecimal } from './input';

export const SWAP_LIMITS = { activeSwaps: 1000, versions: 10000 } as const;
export type SwapKind = 'create' | 'correct' | 'void';
export interface SwapVersion extends FifoSwap {
  accountId: string;
  journalRevision: number;
  requestId: string;
  kind: SwapKind;
  createdAt: string;
  feeInstrumentName: string | null;
  feeInstrumentSymbol: string | null;
}
export interface SwapVersionRow extends Omit<SwapVersion, 'occurredAt' | 'createdAt'> {
  occurredAt: Date;
  createdAt: Date;
  canonicalPayload: string;
}

// Instrument identities and labels are immutable under the current catalog contract.
export const swapVersionSelect = `SELECT v.*,o.name AS "outgoingInstrumentName",o.symbol AS "outgoingInstrumentSymbol",
  i.name AS "incomingInstrumentName",i.symbol AS "incomingInstrumentSymbol",
  f.name AS "feeInstrumentName",f.symbol AS "feeInstrumentSymbol"
  FROM account_swap_versions v
  JOIN accounting_instruments o ON o."ownerId"=v."ownerId" AND o.id=v."outgoingInstrumentId"
  JOIN accounting_instruments i ON i."ownerId"=v."ownerId" AND i.id=v."incomingInstrumentId"
  LEFT JOIN accounting_instruments f ON f."ownerId"=v."ownerId" AND f.id=v."feeInstrumentId"`;
export const swapHeadJoin = `JOIN account_swaps s ON s."ownerId"=v."ownerId"
  AND s."accountId"=v."accountId" AND s.id=v."swapId" AND s."currentVersion"=v.version`;

export function projectSwapVersion(row: SwapVersionRow): SwapVersion {
  return {
    accountId: row.accountId,
    swapId: row.swapId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    outgoingInstrumentId: row.outgoingInstrumentId,
    outgoingInstrumentName: row.outgoingInstrumentName,
    outgoingInstrumentSymbol: row.outgoingInstrumentSymbol,
    incomingInstrumentId: row.incomingInstrumentId,
    incomingInstrumentName: row.incomingInstrumentName,
    incomingInstrumentSymbol: row.incomingInstrumentSymbol,
    occurredAt: row.occurredAt.toISOString(),
    orderWithinTimestamp: row.orderWithinTimestamp,
    outgoingQuantity: parseDecimal(row.outgoingQuantity, true),
    incomingQuantity: parseDecimal(row.incomingQuantity, true),
    considerationUsd:
      row.considerationUsd === null ? null : parseDecimal(row.considerationUsd, false),
    feeSource: row.feeSource,
    feeInstrumentId: row.feeInstrumentId,
    feeInstrumentName: row.feeInstrumentName,
    feeInstrumentSymbol: row.feeInstrumentSymbol,
    feeQuantity: parseDecimal(row.feeQuantity, false),
  };
}

export function swapReceipt(row: SwapVersionRow) {
  return {
    accountId: row.accountId,
    journalRevision: row.journalRevision,
    swap: projectSwapVersion(row),
  };
}

export async function readSwapReplay(
  manager: EntityManager,
  owner: string,
  account: string,
  request: string,
): Promise<SwapVersionRow | undefined> {
  const [row]: SwapVersionRow[] = await manager.query(
    `${swapVersionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3`,
    [owner, account, request],
  );
  return row;
}

export async function readSwapHead(
  manager: EntityManager,
  owner: string,
  account: string,
  id: string,
): Promise<SwapVersionRow | undefined> {
  const [row]: SwapVersionRow[] = await manager.query(
    `${swapVersionSelect} ${swapHeadJoin} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3`,
    [owner, account, id],
  );
  return row;
}

export async function readSwapCounts(manager: EntityManager, owner: string, account?: string) {
  const parameters = account === undefined ? [owner] : [owner, account];
  const accountFilter = account === undefined ? '' : ' AND v."accountId"=$2';
  const [versions]: { count: number }[] = await manager.query(
    `SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1${accountFilter}`,
    parameters,
  );
  const [heads]: { active: number; count: number }[] = await manager.query(
    `SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active
      FROM account_swap_versions v ${swapHeadJoin} WHERE v."ownerId"=$1${accountFilter}`,
    parameters,
  );
  return { versionCount: versions.count, activeCount: heads.active, headCount: heads.count };
}

export async function appendSwapVersion(
  manager: EntityManager,
  owner: string,
  value: Omit<SwapVersion, 'createdAt'> & { canonicalPayload: string },
) {
  if (value.kind === 'create') {
    await manager.query(
      'INSERT INTO account_swaps(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)',
      [value.swapId, owner, value.accountId],
    );
  }
  const [row]: SwapVersionRow[] = await manager.query(
    `INSERT INTO account_swap_versions
    ("ownerId","accountId","swapId",version,"journalRevision","requestId","canonicalPayload",kind,
     "outgoingInstrumentId","incomingInstrumentId","occurredAt","orderWithinTimestamp",
     "outgoingQuantity","incomingQuantity","considerationUsd","feeSource","feeInstrumentId","feeQuantity")
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [
      owner,
      value.accountId,
      value.swapId,
      value.version,
      value.journalRevision,
      value.requestId,
      value.canonicalPayload,
      value.kind,
      value.outgoingInstrumentId,
      value.incomingInstrumentId,
      value.occurredAt,
      value.orderWithinTimestamp,
      value.outgoingQuantity,
      value.incomingQuantity,
      value.considerationUsd,
      value.feeSource,
      value.feeInstrumentId,
      value.feeQuantity,
    ],
  );
  if (value.kind !== 'create') {
    await manager.query(
      'UPDATE account_swaps SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
      [owner, value.accountId, value.swapId, value.version],
    );
  }
  return swapReceipt({
    ...row,
    outgoingInstrumentName: value.outgoingInstrumentName,
    outgoingInstrumentSymbol: value.outgoingInstrumentSymbol,
    incomingInstrumentName: value.incomingInstrumentName,
    incomingInstrumentSymbol: value.incomingInstrumentSymbol,
    feeInstrumentName: value.feeInstrumentName,
    feeInstrumentSymbol: value.feeInstrumentSymbol,
  });
}
