import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { type Execution, type FifoTrade } from './fifo';
import { parseDecimal } from './input';

export type TradeKind = 'create' | 'correct' | 'void';
export interface AccountRow {
  id: string;
  currentRevision: number | null;
}
export interface JournalRow {
  accountId: string;
  requestId: string;
  canonicalPayload: string;
  originKind: 'declared-empty';
  coverageFrom: Date;
  createdAt: Date;
  currentRevision: number;
}
export interface VersionRow {
  tradeId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  canonicalPayload: string;
  kind: TradeKind;
  createdAt: Date;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  side: 'buy' | 'sell';
  occurredAt: Date;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
}
export interface TradeVersion extends FifoTrade {
  journalRevision: number;
  requestId: string;
  kind: TradeKind;
  createdAt: string;
}
export const versionSelect = `SELECT v.*, i.name AS "instrumentName", i.symbol AS "instrumentSymbol"
  FROM account_trade_versions v JOIN accounting_instruments i
  ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"`;

export function projectTradeVersion(row: VersionRow): TradeVersion {
  return {
    tradeId: row.tradeId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    instrumentSymbol: row.instrumentSymbol,
    side: row.side,
    occurredAt: row.occurredAt.toISOString(),
    orderWithinTimestamp: row.orderWithinTimestamp,
    quantity: parseDecimal(row.quantity, true),
    grossUsd: parseDecimal(row.grossUsd, true),
    feeUsd: parseDecimal(row.feeUsd, false),
  };
}
export async function readOwnedAccount(
  manager: EntityManager,
  owner: string,
  id: string,
  lock = false,
): Promise<AccountRow> {
  const [account]: AccountRow[] = await manager.query(
    `SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
    [owner, id],
  );
  if (!account) throw new NotFoundException();
  return account;
}
export async function readJournal(
  manager: EntityManager,
  owner: string,
  id: string,
): Promise<JournalRow | undefined> {
  const [journal]: JournalRow[] = await manager.query(
    'SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2',
    [owner, id],
  );
  return journal;
}
export async function readTradeHeads(
  manager: EntityManager,
  owner: string,
  id: string,
): Promise<TradeVersion[]> {
  const rows: VersionRow[] = await manager.query(
    `${versionSelect} JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accountId"
      AND t.id=v."tradeId" AND t."currentVersion"=v.version
      WHERE v."ownerId"=$1 AND v."accountId"=$2 ORDER BY v."occurredAt",v."orderWithinTimestamp",v."tradeId"`,
    [owner, id],
  );
  return rows.map(projectTradeVersion);
}
export interface PreparedTrade extends Execution {
  tradeId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  canonicalPayload: string;
  kind: TradeKind;
  instrumentName: string;
  instrumentSymbol: string | null;
}
function requireTransaction(manager: EntityManager) {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Trade write requires transaction');
}
export async function appendTradeVersion(
  manager: EntityManager,
  owner: string,
  id: string,
  next: PreparedTrade,
): Promise<TradeVersion> {
  requireTransaction(manager);
  if (next.kind === 'create') {
    await manager.query(
      `INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt")
      VALUES ($1,$2,$3,1,clock_timestamp())`,
      [next.tradeId, owner, id],
    );
  }
  const [saved]: VersionRow[] = await manager.query(
    `INSERT INTO account_trade_versions
    ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind,
    "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()) RETURNING *`,
    [
      owner,
      id,
      next.tradeId,
      next.version,
      next.journalRevision,
      next.requestId,
      next.canonicalPayload,
      next.kind,
      next.instrumentId,
      next.side,
      next.occurredAt,
      next.orderWithinTimestamp,
      next.quantity,
      next.grossUsd,
      next.feeUsd,
    ],
  );
  await manager.query(
    'UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
    [owner, id, next.tradeId, next.version],
  );
  return projectTradeVersion({
    ...saved,
    instrumentName: next.instrumentName,
    instrumentSymbol: next.instrumentSymbol,
  });
}
export async function advanceJournal(
  manager: EntityManager,
  owner: string,
  id: string,
  revision: number,
): Promise<void> {
  requireTransaction(manager);
  await manager.query(
    'UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=$2',
    [owner, id, revision],
  );
}
