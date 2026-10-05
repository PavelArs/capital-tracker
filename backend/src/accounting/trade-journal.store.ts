import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  deriveCarryInAmounts,
  type Execution,
  type FifoCarryInInput,
  FifoHistoryError,
  type FifoTrade,
} from './fifo';
import { parseDecimal } from './input';
import { isPaidCurrency, isRateSource, type TradePayment } from './paid-currency';
import type { TradeSettlement } from './trade-settlement';

export type TradeKind = 'create' | 'correct' | 'void';
export interface AccountRow {
  id: string;
  currentRevision: number | null;
}
interface JournalFields {
  accountId: string;
  requestId: string;
  canonicalPayload: string;
  coverageFrom: Date;
  createdAt: Date;
  currentRevision: number;
}
export type JournalRow = JournalFields &
  (
    | { originKind: 'declared-empty'; openingRevision: null }
    | { originKind: 'known-cost-carry-in'; openingRevision: number }
  );
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
  paidCurrency: string | null;
  paidGross: string | null;
  paidFee: string | null;
  paidRateDate: string | null;
  paidPerUsd: string | null;
  paidRateSource: string | null;
  comment: string | null;
  settlementInstrumentId: string | null;
  settlementName: string | null;
  settlementSymbol: string | null;
  settlementQuantity: string | null;
}
export interface TradeVersion extends FifoTrade {
  journalRevision: number;
  requestId: string;
  kind: TradeKind;
  createdAt: string;
  /** The owner's note on this version (OPS-COMMENT). */
  comment?: string;
}
export const versionSelect = `SELECT v.*, i.name AS "instrumentName", i.symbol AS "instrumentSymbol",
  p.currency AS "paidCurrency", p.gross AS "paidGross", p.fee AS "paidFee",
  p."rateDate"::text AS "paidRateDate", p."perUsd" AS "paidPerUsd",
  p."rateSource" AS "paidRateSource", c.comment,
  s."instrumentId" AS "settlementInstrumentId", si.name AS "settlementName",
  si.symbol AS "settlementSymbol", s.quantity AS "settlementQuantity"
  FROM account_trade_versions v JOIN accounting_instruments i
  ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"
  LEFT JOIN account_trade_version_payments p ON p."ownerId"=v."ownerId"
  AND p."accountId"=v."accountId" AND p."tradeId"=v."tradeId" AND p.version=v.version
  LEFT JOIN account_trade_version_comments c ON c."ownerId"=v."ownerId"
  AND c."accountId"=v."accountId" AND c."tradeId"=v."tradeId" AND c.version=v.version
  LEFT JOIN account_trade_version_settlements s ON s."ownerId"=v."ownerId"
  AND s."accountId"=v."accountId" AND s."tradeId"=v."tradeId" AND s.version=v.version
  LEFT JOIN accounting_instruments si ON si."ownerId"=s."ownerId" AND si.id=s."instrumentId"`;

/** No payment row means the trade was stated in USD. */
function projectPayment(row: VersionRow): TradePayment | undefined {
  if (row.paidCurrency === null || row.paidCurrency === undefined) return undefined;
  if (!isPaidCurrency(row.paidCurrency) || !row.paidRateDate || !isRateSource(row.paidRateSource))
    throw new FifoHistoryError();
  return {
    currency: row.paidCurrency,
    gross: parseDecimal(row.paidGross, true),
    fee: parseDecimal(row.paidFee, false),
    rateDate: row.paidRateDate,
    perUsd: parseDecimal(row.paidPerUsd, true),
    rateSource: row.paidRateSource,
  };
}

/** No settlement row means the trade was settled with money from outside (before M9). */
function projectSettlement(row: VersionRow): TradeSettlement | undefined {
  if (row.settlementInstrumentId === null || row.settlementInstrumentId === undefined)
    return undefined;
  if (!row.settlementName || row.settlementInstrumentId === row.instrumentId)
    throw new FifoHistoryError();
  return {
    instrumentId: row.settlementInstrumentId,
    instrumentName: row.settlementName,
    instrumentSymbol: row.settlementSymbol,
    quantity: parseDecimal(row.settlementQuantity, false),
  };
}

export function projectTradeVersion(row: VersionRow): TradeVersion {
  const paid = projectPayment(row);
  const settlement = projectSettlement(row);
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
    ...(paid ? { paid } : {}),
    ...(settlement ? { settlement } : {}),
    ...(row.comment ? { comment: row.comment } : {}),
  };
}
export async function readOwnedAccount(
  manager: EntityManager,
  owner: string,
  id: string,
  lock = false,
): Promise<AccountRow> {
  if (lock) await lockAccountingOwner(manager, owner);
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

/** Load immutable initial inventory inside the caller's existing transaction. */
export async function readBaseline(
  manager: EntityManager,
  owner: string,
  id: string,
  journal: JournalRow,
): Promise<readonly FifoCarryInInput[]> {
  if (journal.originKind === 'declared-empty') return [];
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Baseline read requires transaction');
  if (!Number.isSafeInteger(journal.openingRevision) || journal.openingRevision < 1)
    throw new FifoHistoryError();
  const rows: (Omit<FifoCarryInInput, 'acquiredAt'> & { acquiredAt: Date })[] = await manager.query(
    `SELECT l.id AS "lotId",l."openingRevision",l.ordinal,l."instrumentId",
      i.name AS "instrumentName",i.symbol AS "instrumentSymbol",l."acquiredAt",
      l."orderWithinTimestamp",l."originalQuantity",l."originalCostUsd",
      l."remainingQuantity" AS "carriedQuantity"
    FROM account_carry_in_lots l JOIN accounting_instruments i
      ON i."ownerId"=l."ownerId" AND i.id=l."instrumentId"
    WHERE l."ownerId"=$1 AND l."accountId"=$2 AND l."openingRevision"=$3
    ORDER BY l.ordinal LIMIT 101`,
    [owner, id, journal.openingRevision],
  );
  if (rows.length < 1 || rows.length > 100) throw new FifoHistoryError();
  return rows.map((row, index) => {
    if (row.ordinal !== index + 1 || row.acquiredAt > journal.coverageFrom)
      throw new FifoHistoryError();
    const lot: FifoCarryInInput = {
      ...row,
      acquiredAt: row.acquiredAt.toISOString(),
      originalQuantity: parseDecimal(row.originalQuantity, true),
      originalCostUsd: parseDecimal(row.originalCostUsd, false),
      carriedQuantity: parseDecimal(row.carriedQuantity, true),
    };
    deriveCarryInAmounts(lot.originalQuantity, lot.originalCostUsd, lot.carriedQuantity);
    return lot;
  });
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
  comment?: string;
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
  if (next.paid) {
    await manager.query(
      `INSERT INTO account_trade_version_payments
      ("ownerId","accountId","tradeId",version,currency,gross,fee,"rateDate","perUsd","rateSource")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        owner,
        id,
        next.tradeId,
        next.version,
        next.paid.currency,
        next.paid.gross,
        next.paid.fee,
        next.paid.rateDate,
        next.paid.perUsd,
        next.paid.rateSource,
      ],
    );
  }
  if (next.settlement)
    await manager.query(
      `INSERT INTO account_trade_version_settlements
      ("ownerId","accountId","tradeId",version,"instrumentId",quantity)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        owner,
        id,
        next.tradeId,
        next.version,
        next.settlement.instrumentId,
        next.settlement.quantity,
      ],
    );
  if (next.comment)
    await manager.query(
      `INSERT INTO account_trade_version_comments ("ownerId","accountId","tradeId",version,comment)
      VALUES ($1,$2,$3,$4,$5)`,
      [owner, id, next.tradeId, next.version, next.comment],
    );
  await manager.query(
    'UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
    [owner, id, next.tradeId, next.version],
  );
  return projectTradeVersion({
    ...saved,
    instrumentName: next.instrumentName,
    instrumentSymbol: next.instrumentSymbol,
    paidCurrency: next.paid?.currency ?? null,
    paidGross: next.paid?.gross ?? null,
    paidFee: next.paid?.fee ?? null,
    paidRateDate: next.paid?.rateDate ?? null,
    paidPerUsd: next.paid?.perUsd ?? null,
    paidRateSource: next.paid?.rateSource ?? null,
    comment: next.comment ?? null,
    settlementInstrumentId: next.settlement?.instrumentId ?? null,
    settlementName: next.settlement?.instrumentName ?? null,
    settlementSymbol: next.settlement?.instrumentSymbol ?? null,
    settlementQuantity: next.settlement?.quantity ?? null,
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
