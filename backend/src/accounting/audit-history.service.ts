import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  type AuditFilter,
  type AuditHistory,
  type AuditRow,
  encodeCursor,
  parseAuditQuery,
  projectEvent,
} from './audit-history';
import { parseUuid } from './input';

const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const changeOf = (column: string) =>
  `CASE ${column} WHEN 'create' THEN 'created' WHEN 'void' THEN 'deleted' ELSE 'changed' END`;
/** The app wrote the version itself: a classification it made without asking (D7). */
const madeByApp = (column: string, id: string) =>
  `(v.version = 1 AND EXISTS (SELECT 1 FROM chain_transaction_classification_versions k
      WHERE k."ownerId" = v."ownerId" AND k."${column}" = ${id} AND k.automatic IS TRUE))`;
const symbol = (alias: string) => `coalesce(${alias}.symbol, ${alias}.name)`;

// Every version row of every journal, one SELECT each, in a common shape. Reads only: a
// version is never edited, so there is nothing here to lock.
const sources = `
  SELECT 'trade' AS entity, v."tradeId"::text AS "entityId", v.version,
      ${changeOf('v.kind')} AS change, v."createdAt", v."occurredAt", a.name AS account,
      CASE WHEN v.version = 1 AND r."tradeId" IS NOT NULL THEN 'csv'
        WHEN ${madeByApp('tradeId', 'v."tradeId"')} THEN 'automatic' ELSE 'owner' END AS actor,
      jsonb_build_object('side', v.side, 'asset', ${symbol('i')}, 'quantity', v.quantity::text,
        'grossUsd', v."grossUsd"::text, 'feeUsd', v."feeUsd"::text,
        'occurredAt', ${iso('v."occurredAt"')}, 'paidGross', p.gross::text,
        'paidCurrency', p.currency, 'comment', c.comment) AS snapshot
    FROM account_trade_versions v
    JOIN manual_accounts a ON a."ownerId" = v."ownerId" AND a.id = v."accountId"
    JOIN accounting_instruments i ON i."ownerId" = v."ownerId" AND i.id = v."instrumentId"
    LEFT JOIN account_trade_version_payments p ON p."ownerId" = v."ownerId"
      AND p."accountId" = v."accountId" AND p."tradeId" = v."tradeId" AND p.version = v.version
    LEFT JOIN account_trade_version_comments c ON c."ownerId" = v."ownerId"
      AND c."accountId" = v."accountId" AND c."tradeId" = v."tradeId" AND c.version = v.version
    LEFT JOIN account_csv_import_rows r ON r."ownerId" = v."ownerId"
      AND r."accountId" = v."accountId" AND r."tradeId" = v."tradeId"
    WHERE v."ownerId" = $1
  UNION ALL
  SELECT 'transfer', v."transferId"::text, v.version, ${changeOf('v.kind')}, v."createdAt",
      v."occurredAt", a.name,
      CASE WHEN ${madeByApp('transferId', 'v."transferId"')} THEN 'automatic' ELSE 'owner' END,
      jsonb_build_object('asset', ${symbol('i')}, 'quantity', v.quantity::text, 'to', b.name,
        'feeQuantity', v."feeQuantity"::text, 'feeAsset', ${symbol('fi')},
        'occurredAt', ${iso('v."occurredAt"')})
    FROM owned_transfer_versions v
    JOIN owned_transfers t ON t."ownerId" = v."ownerId" AND t.id = v."transferId"
    JOIN manual_accounts a ON a."ownerId" = t."ownerId" AND a.id = t."fromAccountId"
    JOIN manual_accounts b ON b."ownerId" = t."ownerId" AND b.id = t."toAccountId"
    JOIN accounting_instruments i ON i."ownerId" = v."ownerId" AND i.id = v."instrumentId"
    LEFT JOIN accounting_instruments fi ON fi."ownerId" = v."ownerId"
      AND fi.id = v."feeInstrumentId"
    WHERE v."ownerId" = $1
  UNION ALL
  SELECT 'swap', v."swapId"::text, v.version, ${changeOf('v.kind')}, v."createdAt",
      v."occurredAt", a.name,
      CASE WHEN ${madeByApp('swapId', 'v."swapId"')} THEN 'automatic' ELSE 'owner' END,
      jsonb_build_object('gave', v."outgoingQuantity"::text, 'gaveAsset', ${symbol('o')},
        'got', v."incomingQuantity"::text, 'gotAsset', ${symbol('n')},
        'considerationUsd', v."considerationUsd"::text, 'feeQuantity', v."feeQuantity"::text,
        'feeAsset', ${symbol('fi')}, 'occurredAt', ${iso('v."occurredAt"')})
    FROM account_swap_versions v
    JOIN manual_accounts a ON a."ownerId" = v."ownerId" AND a.id = v."accountId"
    JOIN accounting_instruments o ON o."ownerId" = v."ownerId" AND o.id = v."outgoingInstrumentId"
    JOIN accounting_instruments n ON n."ownerId" = v."ownerId" AND n.id = v."incomingInstrumentId"
    LEFT JOIN accounting_instruments fi ON fi."ownerId" = v."ownerId"
      AND fi.id = v."feeInstrumentId"
    WHERE v."ownerId" = $1
  UNION ALL
  SELECT 'reward', v."rewardId"::text, v.version, ${changeOf('v.kind')}, v."createdAt",
      v."occurredAt", a.name,
      CASE WHEN ${madeByApp('rewardId', 'v."rewardId"')} THEN 'automatic' ELSE 'owner' END,
      jsonb_build_object('category', v.category, 'asset', ${symbol('i')},
        'quantity', v.quantity::text, 'incomeValueUsd', v."incomeValueUsd"::text,
        'acquisitionBasisUsd', v."acquisitionBasisUsd"::text,
        'occurredAt', ${iso('v."occurredAt"')})
    FROM account_reward_versions v
    JOIN manual_accounts a ON a."ownerId" = v."ownerId" AND a.id = v."accountId"
    JOIN accounting_instruments i ON i."ownerId" = v."ownerId" AND i.id = v."instrumentId"
    WHERE v."ownerId" = $1
  UNION ALL
  SELECT 'flow', v."flowId"::text, v.version, ${changeOf('v.kind')}, v."createdAt",
      v."occurredAt", NULL, 'owner',
      jsonb_build_object('direction', v.direction, 'amountUsd', v."amountUsd"::text,
        'occurredAt', ${iso('v."occurredAt"')})
    FROM portfolio_flow_versions v
    WHERE v."ownerId" = $1
  UNION ALL
  SELECT 'price', v."instrumentId"::text || '@' || ${iso('v."observedAt"')},
      (row_number() OVER (PARTITION BY v."instrumentId", v."observedAt" ORDER BY v.revision))::int,
      CASE WHEN v.kind = 'void' THEN 'deleted'
        WHEN row_number() OVER (PARTITION BY v."instrumentId", v."observedAt"
          ORDER BY v.revision) = 1 THEN 'created' ELSE 'changed' END,
      v."createdAt", v."observedAt", NULL, 'owner',
      jsonb_build_object('asset', ${symbol('i')}, 'price', v."priceUsd"::text,
        'occurredAt', ${iso('v."observedAt"')})
    FROM manual_usd_price_versions v
    JOIN accounting_instruments i ON i."ownerId" = v."ownerId" AND i.id = v."instrumentId"
    WHERE v."ownerId" = $1
  UNION ALL
  SELECT 'classification', v."addressId"::text || ':' || v.txid, v.version,
      CASE WHEN v.status = 'deleted' THEN 'deleted' WHEN v.version = 1 THEN 'created'
        ELSE 'changed' END, v."createdAt", t."blockTime",
      a.name, CASE WHEN v.automatic IS TRUE THEN 'automatic' ELSE 'owner' END,
      jsonb_build_object('status', v.status, 'type', v.type, 'comment', v.comment,
        'details', md5(v.details::text), 'direction', t.direction, 'network', w.network,
        'asset', t.asset)
    FROM chain_transaction_classification_versions v
    JOIN wallet_addresses w ON w."ownerId" = v."ownerId" AND w.id = v."addressId"
    JOIN wallet_address_transactions t ON t."addressId" = v."addressId" AND t.txid = v.txid
    LEFT JOIN manual_accounts a ON a."ownerId" = w."ownerId" AND a.id = w."accountId"
    WHERE v."ownerId" = $1`;

interface Row extends Omit<AuditRow, 'snapshot' | 'previous'> {
  snapshot: Record<string, string | null>;
  previous: Record<string, string | null> | null;
}

@Injectable()
export class AuditHistoryService {
  constructor(private readonly source: DataSource) {}

  async read(ownerId: string, rawQuery: unknown, now = new Date()): Promise<AuditHistory> {
    const owner = parseUuid(ownerId);
    let filter: AuditFilter;
    try {
      filter = parseAuditQuery(rawQuery);
    } catch {
      throw new BadRequestException('Invalid audit history input');
    }
    const parameters: unknown[] = [owner];
    const add = (value: unknown) => `$${parameters.push(value)}`;
    const conditions: string[] = [];
    if (filter.entity) conditions.push(`entity = ${add(filter.entity)}`);
    if (filter.change) conditions.push(`change = ${add(filter.change)}`);
    if (filter.actor) conditions.push(`actor = ${add(filter.actor)}`);
    if (filter.from)
      conditions.push(`("createdAt" AT TIME ZONE 'UTC')::date >= ${add(filter.from)}::date`);
    if (filter.to)
      conditions.push(`("createdAt" AT TIME ZONE 'UTC')::date <= ${add(filter.to)}::date`);
    if (filter.before) {
      const at = add(filter.before.at);
      const key = add(filter.before.key);
      conditions.push(`("createdAt" < ${at}::timestamptz
        OR ("createdAt" = ${at}::timestamptz AND key COLLATE "C" < ${key} COLLATE "C"))`);
    }
    const limit = add(filter.limit + 1);
    const rows: Row[] = await this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return manager.query(
        `WITH versions AS (${sources}),
          compared AS (
            SELECT versions.*,
              versions.entity || ':' || versions."entityId" || ':' || lpad(versions.version::text, 6, '0') AS key,
              lag(versions.snapshot) OVER (PARTITION BY versions.entity, versions."entityId"
                ORDER BY versions.version) AS previous
            FROM versions)
          SELECT entity, "entityId", version, change, actor, "createdAt", "occurredAt", account,
              snapshot, previous
            FROM compared
            ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
            ORDER BY "createdAt" DESC, key COLLATE "C" DESC
            LIMIT ${limit}`,
        parameters,
      );
    });
    const page = rows.slice(0, filter.limit).map(projectEvent);
    const last = page.at(-1);
    return {
      at: now.toISOString(),
      events: page,
      next: rows.length > filter.limit && last ? encodeCursor(last) : null,
    };
  }
}
