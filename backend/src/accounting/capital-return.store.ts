import type { EntityManager } from 'typeorm';
import type { FifoCapitalReturn } from './capital-return-types';
import { parseDecimal } from './input';
import { isPaidCurrency, isRateSource, type PaidCurrency, type RateSource } from './paid-currency';

export const CAPITAL_RETURN_LIMITS = { activeReturns: 1000, versions: 2000 } as const;
export type CapitalReturnKind = 'create' | 'void';
/** The rate the USD amount of a return paid in RUB or EUR was derived at (CUR-PAID-RUB). */
export interface CapitalReturnRate {
  rateDate: string;
  perUsd: string;
  rateSource: RateSource;
}
export interface CapitalReturnVersion extends FifoCapitalReturn {
  accountId: string;
  journalRevision: number;
  requestId: string;
  kind: CapitalReturnKind;
  createdAt: string;
  rate: CapitalReturnRate | null;
}
export interface CapitalReturnVersionRow
  extends Omit<CapitalReturnVersion, 'occurredAt' | 'createdAt' | 'rate' | 'paidCurrency'> {
  occurredAt: Date;
  createdAt: Date;
  canonicalPayload: string;
  paidCurrency: string | null;
  rateDate: string | null;
  perUsd: string | null;
  rateSource: string | null;
}

// Instrument identities and labels are immutable under the current catalog contract.
export const capitalReturnVersionSelect = `SELECT v.*,v."rateDate"::text AS "rateDate",
  i.name AS "instrumentName",i.symbol AS "instrumentSymbol",
  c.name AS "cashInstrumentName",c.symbol AS "cashInstrumentSymbol"
  FROM account_capital_return_versions v
  JOIN accounting_instruments i ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"
  JOIN accounting_instruments c ON c."ownerId"=v."ownerId" AND c.id=v."cashInstrumentId"`;
export const capitalReturnHeadJoin = `JOIN account_capital_returns r ON r."ownerId"=v."ownerId"
  AND r."accountId"=v."accountId" AND r.id=v."capitalReturnId" AND r."currentVersion"=v.version`;

function projectRate(row: CapitalReturnVersionRow): {
  paidCurrency: PaidCurrency | null;
  rate: CapitalReturnRate | null;
} {
  if (row.paidCurrency === null) return { paidCurrency: null, rate: null };
  if (
    !isPaidCurrency(row.paidCurrency) ||
    !row.rateDate ||
    !isRateSource(row.rateSource) ||
    row.perUsd === null
  )
    throw new Error('Capital return with a malformed rate');
  return {
    paidCurrency: row.paidCurrency,
    rate: {
      rateDate: row.rateDate,
      perUsd: parseDecimal(row.perUsd, true),
      rateSource: row.rateSource,
    },
  };
}

export function projectCapitalReturnVersion(row: CapitalReturnVersionRow): CapitalReturnVersion {
  const { paidCurrency, rate } = projectRate(row);
  return {
    accountId: row.accountId,
    capitalReturnId: row.capitalReturnId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    instrumentSymbol: row.instrumentSymbol,
    cashInstrumentId: row.cashInstrumentId,
    cashInstrumentName: row.cashInstrumentName,
    cashInstrumentSymbol: row.cashInstrumentSymbol,
    occurredAt: row.occurredAt.toISOString(),
    orderWithinTimestamp: row.orderWithinTimestamp,
    amount: parseDecimal(row.amount, true),
    amountUsd: parseDecimal(row.amountUsd, true),
    paidCurrency,
    rate,
  };
}

export function capitalReturnReceipt(row: CapitalReturnVersionRow) {
  return {
    accountId: row.accountId,
    journalRevision: row.journalRevision,
    capitalReturn: projectCapitalReturnVersion(row),
  };
}

/** The canonical request a record was written from, as an idempotent replay compares it. */
export function capitalReturnPayload(
  kind: CapitalReturnKind,
  value: {
    expectedJournalRevision: number;
    instrumentId: string;
    cashInstrumentId: string;
    occurredAt: string;
    orderWithinTimestamp: number;
    amount: string;
    amountUsd: string;
    paidCurrency: PaidCurrency | null;
    rate: CapitalReturnRate | null;
  },
): string {
  return JSON.stringify({ kind, ...value });
}

export async function readCapitalReturnReplay(
  manager: EntityManager,
  owner: string,
  account: string,
  request: string,
): Promise<CapitalReturnVersionRow | undefined> {
  const [row]: CapitalReturnVersionRow[] = await manager.query(
    `${capitalReturnVersionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3`,
    [owner, account, request],
  );
  return row;
}

export async function readCapitalReturnHead(
  manager: EntityManager,
  owner: string,
  account: string,
  id: string,
): Promise<CapitalReturnVersionRow | undefined> {
  const [row]: CapitalReturnVersionRow[] = await manager.query(
    `${capitalReturnVersionSelect} ${capitalReturnHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."capitalReturnId"=$3`,
    [owner, account, id],
  );
  return row;
}

export async function readCapitalReturnCounts(
  manager: EntityManager,
  owner: string,
  account?: string,
) {
  const parameters = account === undefined ? [owner] : [owner, account];
  const accountFilter = account === undefined ? '' : ' AND v."accountId"=$2';
  const [versions]: { count: number }[] = await manager.query(
    `SELECT count(*)::int AS count FROM account_capital_return_versions v
      WHERE v."ownerId"=$1${accountFilter}`,
    parameters,
  );
  const [heads]: { active: number; count: number }[] = await manager.query(
    `SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active
      FROM account_capital_return_versions v ${capitalReturnHeadJoin}
      WHERE v."ownerId"=$1${accountFilter}`,
    parameters,
  );
  return { versionCount: versions.count, activeCount: heads.active, headCount: heads.count };
}

export async function appendCapitalReturnVersion(
  manager: EntityManager,
  owner: string,
  value: Omit<CapitalReturnVersion, 'createdAt'> & { canonicalPayload: string },
) {
  if (value.kind === 'create') {
    await manager.query(
      'INSERT INTO account_capital_returns(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)',
      [value.capitalReturnId, owner, value.accountId],
    );
  }
  await manager.query(
    `INSERT INTO account_capital_return_versions
    ("ownerId","accountId","capitalReturnId",version,"journalRevision","requestId","canonicalPayload",kind,
     "instrumentId","cashInstrumentId","occurredAt","orderWithinTimestamp",amount,"amountUsd",
     "paidCurrency","rateDate","perUsd","rateSource")
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      owner,
      value.accountId,
      value.capitalReturnId,
      value.version,
      value.journalRevision,
      value.requestId,
      value.canonicalPayload,
      value.kind,
      value.instrumentId,
      value.cashInstrumentId,
      value.occurredAt,
      value.orderWithinTimestamp,
      value.amount,
      value.amountUsd,
      value.paidCurrency,
      value.rate?.rateDate ?? null,
      value.rate?.perUsd ?? null,
      value.rate?.rateSource ?? null,
    ],
  );
  if (value.kind !== 'create') {
    await manager.query(
      'UPDATE account_capital_returns SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
      [owner, value.accountId, value.capitalReturnId, value.version],
    );
  }
  // Read back through the select that states a date as text, as every other read does.
  const stored = await readCapitalReturnReplay(manager, owner, value.accountId, value.requestId);
  if (!stored) throw new Error('A capital return version just written was not found');
  return capitalReturnReceipt(stored);
}
