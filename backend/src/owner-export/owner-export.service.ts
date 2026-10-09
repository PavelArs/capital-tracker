import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { deriveCarryInAmounts } from '../accounting/fifo';
import { parseUuid } from '../accounting/input';
import { isTradePurpose } from '../accounting/trade-purpose';
import { stakeMoves } from '../wallet-addresses/stake-tables';
import { backupTables, legacyTables } from './backup-tables';
import {
  backupDocument,
  type ExportAccount,
  type ExportAsset,
  type ExportChainTransaction,
  type ExportOperation,
  type ExportWallet,
  exportFiles,
  rewardType,
  tradeType,
} from './owner-export';
import { zipArchive } from './zip';

export interface ExportDownload {
  filename: string;
  contentType: string;
  data: Buffer;
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const iso = (value: unknown) => (value as Date).toISOString();
const day = (at: Date) => at.toISOString().slice(0, 10);
const exact = (column: string) => `trim_scale(${column})::text`;

/** The legacy screens' rows (M20) belong to their "userId"; currencies to no one. */
const legacyOwner = (table: (typeof legacyTables)[number]) =>
  table === 'currencies' ? null : 'userId';
/** The shared legacy currency list: only the currencies the owner's legacy rows name. */
const legacyCurrencies = `t.id IN (SELECT "currencyId" FROM assets WHERE "userId"=$1
  UNION SELECT "currencyId" FROM liabilities WHERE "userId"=$1
  UNION SELECT "currencyId" FROM user_currency_preferences WHERE "userId"=$1)`;

/** The last version that is not a void: what a voided entry said before it left the books. */
const lastContent = (versions: string, key: string) =>
  `JOIN LATERAL (SELECT * FROM ${versions} c WHERE c."ownerId"=h."ownerId" AND c."${key}"=h.id
    AND c.kind<>'void' ORDER BY c.version DESC LIMIT 1) v ON true
   JOIN ${versions} head ON head."ownerId"=h."ownerId" AND head."${key}"=h.id
    AND head.version=h."currentVersion"`;
/** The chain transaction whose classification produced the entry (M12), if any. */
const producedBy = (column: string) =>
  `(SELECT x.txid FROM chain_transaction_classification_versions x
    WHERE x."ownerId"=h."ownerId" AND x."${column}"=h.id ORDER BY x."createdAt" DESC LIMIT 1)`;
const named = (alias: string, column: string) =>
  `LEFT JOIN accounting_instruments ${alias} ON ${alias}."ownerId"=h."ownerId" AND ${alias}.id=v."${column}"`;

function base(row: Row, kind: ExportOperation['kind']) {
  return {
    id: `${kind}:${row.id}`,
    kind,
    status: row.headKind === 'void' ? 'voided' : 'active',
    occurredAt: iso(row.occurredAt),
    orderWithinTimestamp: Number(row.orderWithinTimestamp),
    accountId: text(row.accountId),
    accountName: text(row.accountName),
    toAccountId: null,
    toAccountName: null,
    asset: text(row.symbol),
    assetName: String(row.assetName),
    quantity: String(row.quantity),
    counterAsset: null,
    counterQuantity: null,
    valueUsd: null,
    costBasisUsd: null,
    feeUsd: null,
    feeAsset: null,
    feeQuantity: null,
    paidCurrency: null,
    paidAmount: null,
    paidFee: null,
    paidPerUsd: null,
    paidRateDate: null,
    paidRateSource: null,
    settlementAsset: null,
    settlementQuantity: null,
    comment: null,
    chainTxid: text(row.chainTxid),
    version: row.version === null ? null : Number(row.version),
    recordedAt: iso(row.recordedAt),
  } satisfies Omit<ExportOperation, 'type' | 'direction' | 'source'>;
}
/** What the carried part of a lot cost, as the Transactions list shows it. */
const carriedCost = (row: Row) =>
  deriveCarryInAmounts(
    String(row.originalQuantity),
    String(row.originalCostUsd),
    String(row.quantity),
  ).carriedCostUsd;
const chainOr = (row: Row, other: 'manual' | 'csv') => (row.chainTxid ? 'chain' : other);
/** A fee in an asset; a zero fee is no fee. */
const fee = (row: Row) =>
  row.feeQuantity === null || row.feeQuantity === '0'
    ? { feeAsset: null, feeQuantity: null }
    : { feeAsset: text(row.feeSymbol ?? row.feeName), feeQuantity: text(row.feeQuantity) };

@Injectable()
export class OwnerExportService {
  constructor(private readonly source: DataSource) {}

  /** EXP-CSV: assets, accounts, wallets, operations and chain classifications, one CSV each. */
  async archive(ownerId: string, now = new Date()): Promise<ExportDownload> {
    const owner = parseUuid(ownerId);
    const data = await this.snapshot(async (manager) => ({
      assets: await this.assets(manager, owner),
      accounts: await this.accounts(manager, owner),
      wallets: await this.wallets(manager, owner),
      operations: await this.operations(manager, owner),
      chain: await this.chain(manager, owner),
    }));
    return {
      filename: `capital-tracker-export-${day(now)}.zip`,
      contentType: 'application/zip',
      data: zipArchive(exportFiles(data), now),
    };
  }

  /** EXP-JSON: every backed-up table of the owner, with a format version and no secrets. */
  async backup(ownerId: string, now = new Date()): Promise<ExportDownload> {
    const owner = parseUuid(ownerId);
    const tables = await this.snapshot(async (manager) => {
      await manager.query(`SET LOCAL TimeZone='UTC'`);
      const columns: { table: string; column: string; type: string }[] = await manager.query(
        `SELECT table_name AS table, column_name AS column, data_type AS type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name = ANY($1) ORDER BY ordinal_position`,
        [[...backupTables, ...legacyTables]],
      );
      const read = [];
      for (const [name, ownerColumn] of [
        ...backupTables.map((name) => [name, 'ownerId'] as const),
        ...legacyTables.map((name) => [name, legacyOwner(name)] as const),
      ]) {
        const own = columns.filter((column) => column.table === name);
        if (ownerColumn && !own.some((column) => column.column === ownerColumn))
          throw new Error(`Backup table without an owner: ${name}`);
        // Exact decimals as strings and bytes as base64; names come from the catalog.
        const fields = own
          .filter((column) => column.column !== ownerColumn)
          .map(({ column, type }) => {
            const value = `t."${column.replaceAll('"', '""')}"`;
            const json =
              type === 'numeric'
                ? `${exact(value)}`
                : type === 'bytea'
                  ? `encode(${value}, 'base64')`
                  : value;
            return `'${column.replaceAll("'", "''")}', ${json}`;
          });
        const rows: { row: string }[] = await manager.query(
          `SELECT jsonb_build_object(${fields.join(', ')})::text AS row
            FROM "${name}" t WHERE ${ownerColumn ? `t."${ownerColumn}"=$1` : legacyCurrencies}
            ORDER BY 1`,
          [owner],
        );
        read.push({ name, rows: rows.map(({ row }) => row) });
      }
      return read;
    });
    return {
      filename: `capital-tracker-backup-${day(now)}.json`,
      contentType: 'application/json',
      data: Buffer.from(backupDocument(now.toISOString(), tables), 'utf8'),
    };
  }

  private snapshot<T>(read: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return read(manager);
    });
  }

  private async assets(manager: EntityManager, owner: string): Promise<ExportAsset[]> {
    const rows: Row[] = await manager.query(
      `SELECT id, name, symbol, "assetType", "valuationCurrency", "priceSource", "createdAt"
        FROM accounting_instruments WHERE "ownerId"=$1`,
      [owner],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      symbol: text(row.symbol),
      assetType: String(row.assetType),
      valuationCurrency: String(row.valuationCurrency),
      priceSource: String(row.priceSource),
      createdAt: iso(row.createdAt),
    }));
  }

  private async accounts(manager: EntityManager, owner: string): Promise<ExportAccount[]> {
    const rows: Row[] = await manager.query(
      `SELECT id, name, "createdAt" FROM manual_accounts WHERE "ownerId"=$1`,
      [owner],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      createdAt: iso(row.createdAt),
    }));
  }

  private async wallets(manager: EntityManager, owner: string): Promise<ExportWallet[]> {
    const rows: Row[] = await manager.query(
      `SELECT w.id, w.network, w.address, w.label, w."accountId", a.name AS "accountName",
          w."createdAt"
        FROM wallet_addresses w
        LEFT JOIN manual_accounts a ON a."ownerId"=w."ownerId" AND a.id=w."accountId"
        WHERE w."ownerId"=$1`,
      [owner],
    );
    return rows.map((row) => ({
      id: String(row.id),
      network: String(row.network),
      address: String(row.address),
      label: text(row.label),
      accountId: text(row.accountId),
      accountName: text(row.accountName),
      createdAt: iso(row.createdAt),
    }));
  }

  /** Every journal entry, active and voided, at its last recorded content. */
  private async operations(manager: EntityManager, owner: string): Promise<ExportOperation[]> {
    const entry = `h.id, head.kind AS "headKind", v.version, v."occurredAt",
      v."orderWithinTimestamp", h."createdAt" AS "recordedAt"`;
    const trades: Row[] = await manager.query(
      `SELECT ${entry}, h."accountId", a.name AS "accountName", i.symbol, i.name AS "assetName",
          v.side, ${exact('v.quantity')} AS quantity, ${exact('v."grossUsd"')} AS "grossUsd",
          ${exact('v."feeUsd"')} AS "feeUsd", p.currency AS "paidCurrency",
          ${exact('p.gross')} AS "paidGross", ${exact('p.fee')} AS "paidFee",
          ${exact('p."perUsd"')} AS "paidPerUsd", p."rateDate"::text AS "paidRateDate",
          p."rateSource" AS "paidRateSource", m.comment, si.symbol AS "settlementSymbol",
          si.name AS "settlementName", ${exact('s.quantity')} AS "settlementQuantity", u.purpose,
          EXISTS (SELECT 1 FROM account_csv_import_rows r WHERE r."ownerId"=h."ownerId"
            AND r."accountId"=h."accountId" AND r."tradeId"=h.id) AS csv,
          ${producedBy('tradeId')} AS "chainTxid"
        FROM account_trades h
        ${lastContent('account_trade_versions', 'tradeId')}
        JOIN accounting_instruments i ON i."ownerId"=h."ownerId" AND i.id=v."instrumentId"
        JOIN manual_accounts a ON a."ownerId"=h."ownerId" AND a.id=h."accountId"
        LEFT JOIN account_trade_version_payments p ON p."ownerId"=v."ownerId"
          AND p."accountId"=v."accountId" AND p."tradeId"=v."tradeId" AND p.version=v.version
        LEFT JOIN account_trade_version_comments m ON m."ownerId"=v."ownerId"
          AND m."accountId"=v."accountId" AND m."tradeId"=v."tradeId" AND m.version=v.version
        LEFT JOIN account_trade_version_settlements s ON s."ownerId"=v."ownerId"
          AND s."accountId"=v."accountId" AND s."tradeId"=v."tradeId" AND s.version=v.version
        LEFT JOIN accounting_instruments si ON si."ownerId"=s."ownerId" AND si.id=s."instrumentId"
        LEFT JOIN account_trade_version_purposes u ON u."ownerId"=v."ownerId"
          AND u."accountId"=v."accountId" AND u."tradeId"=v."tradeId" AND u.version=v.version
        WHERE h."ownerId"=$1`,
      [owner],
    );
    const transfers: Row[] = await manager.query(
      `SELECT ${entry}, h."fromAccountId" AS "accountId", a.name AS "accountName",
          h."toAccountId", b.name AS "toAccountName", i.symbol, i.name AS "assetName",
          ${exact('v.quantity')} AS quantity, fi.symbol AS "feeSymbol", fi.name AS "feeName",
          ${exact('v."feeQuantity"')} AS "feeQuantity", ${producedBy('transferId')} AS "chainTxid"
        FROM owned_transfers h
        ${lastContent('owned_transfer_versions', 'transferId')}
        JOIN accounting_instruments i ON i."ownerId"=h."ownerId" AND i.id=v."instrumentId"
        ${named('fi', 'feeInstrumentId')}
        JOIN manual_accounts a ON a."ownerId"=h."ownerId" AND a.id=h."fromAccountId"
        JOIN manual_accounts b ON b."ownerId"=h."ownerId" AND b.id=h."toAccountId"
        WHERE h."ownerId"=$1`,
      [owner],
    );
    const swaps: Row[] = await manager.query(
      `SELECT ${entry}, h."accountId", a.name AS "accountName", i.symbol, i.name AS "assetName",
          n.symbol AS "counterSymbol", n.name AS "counterName",
          ${exact('v."outgoingQuantity"')} AS quantity,
          ${exact('v."incomingQuantity"')} AS "counterQuantity",
          ${exact('v."considerationUsd"')} AS "considerationUsd", fi.symbol AS "feeSymbol",
          fi.name AS "feeName", ${exact('v."feeQuantity"')} AS "feeQuantity",
          NULL AS "chainTxid"
        FROM account_swaps h
        ${lastContent('account_swap_versions', 'swapId')}
        JOIN accounting_instruments i ON i."ownerId"=h."ownerId" AND i.id=v."outgoingInstrumentId"
        JOIN accounting_instruments n ON n."ownerId"=h."ownerId" AND n.id=v."incomingInstrumentId"
        ${named('fi', 'feeInstrumentId')}
        JOIN manual_accounts a ON a."ownerId"=h."ownerId" AND a.id=h."accountId"
        WHERE h."ownerId"=$1`,
      [owner],
    );
    const rewards: Row[] = await manager.query(
      `SELECT ${entry}, h."accountId", a.name AS "accountName", i.symbol, i.name AS "assetName",
          v.category, ${exact('v.quantity')} AS quantity,
          ${exact('v."incomeValueUsd"')} AS "incomeValueUsd",
          ${exact('v."acquisitionBasisUsd"')} AS "acquisitionBasisUsd",
          ${producedBy('rewardId')} AS "chainTxid"
        FROM account_rewards h
        ${lastContent('account_reward_versions', 'rewardId')}
        JOIN accounting_instruments i ON i."ownerId"=h."ownerId" AND i.id=v."instrumentId"
        JOIN manual_accounts a ON a."ownerId"=h."ownerId" AND a.id=h."accountId"
        WHERE h."ownerId"=$1`,
      [owner],
    );
    // Known-cost carry-in lots of each journal's current opening, as the list shows them.
    const openings: Row[] = await manager.query(
      `SELECT h.id, NULL AS "headKind", NULL AS version, h."acquiredAt" AS "occurredAt",
          h."orderWithinTimestamp", h."createdAt" AS "recordedAt", h."accountId",
          a.name AS "accountName", i.symbol, i.name AS "assetName",
          ${exact('h."remainingQuantity"')} AS quantity,
          ${exact('h."originalQuantity"')} AS "originalQuantity",
          ${exact('h."originalCostUsd"')} AS "originalCostUsd", NULL AS "chainTxid"
        FROM account_trade_journals j
        JOIN account_carry_in_lots h ON h."ownerId"=j."ownerId" AND h."accountId"=j."accountId"
          AND h."openingRevision"=j."openingRevision"
        JOIN accounting_instruments i ON i."ownerId"=h."ownerId" AND i.id=h."instrumentId"
        JOIN manual_accounts a ON a."ownerId"=h."ownerId" AND a.id=h."accountId"
        WHERE j."ownerId"=$1 AND j."originKind"='known-cost-carry-in'`,
      [owner],
    );
    const flows: Row[] = await manager.query(
      `SELECT v."flowId" AS id, head.kind AS "headKind", v.version, v."occurredAt", 0 AS
          "orderWithinTimestamp", first."createdAt" AS "recordedAt", NULL AS "accountId",
          NULL AS "accountName", 'USD' AS symbol, 'US dollar' AS "assetName", v.direction,
          ${exact('v."amountUsd"')} AS quantity, NULL AS "chainTxid"
        FROM (SELECT DISTINCT ON ("flowId") * FROM portfolio_flow_versions WHERE "ownerId"=$1
          ORDER BY "flowId", version DESC) head
        JOIN LATERAL (SELECT * FROM portfolio_flow_versions c WHERE c."ownerId"=head."ownerId"
          AND c."flowId"=head."flowId" AND c.kind<>'void' ORDER BY c.version DESC LIMIT 1) v
          ON true
        JOIN portfolio_flow_versions first ON first."ownerId"=head."ownerId"
          AND first."flowId"=head."flowId" AND first.version=1`,
      [owner],
    );

    return [
      ...trades.map((row): ExportOperation => {
        const side = row.side === 'sell' ? 'sell' : 'buy';
        const purpose = isTradePurpose(row.purpose) ? row.purpose : null;
        return {
          ...base(row, 'trade'),
          type: tradeType(side, purpose),
          direction: side === 'buy' ? 'in' : 'out',
          source: chainOr(row, row.csv ? 'csv' : 'manual'),
          valueUsd: text(row.grossUsd),
          feeUsd: text(row.feeUsd),
          paidCurrency: text(row.paidCurrency),
          paidAmount: text(row.paidGross),
          paidFee: text(row.paidFee),
          paidPerUsd: text(row.paidPerUsd),
          paidRateDate: text(row.paidRateDate),
          paidRateSource: text(row.paidRateSource),
          settlementAsset: text(row.settlementSymbol ?? row.settlementName),
          settlementQuantity: text(row.settlementQuantity),
          comment: text(row.comment),
        };
      }),
      ...transfers.map(
        (row): ExportOperation => ({
          ...base(row, 'transfer'),
          type: 'transfer',
          direction: 'internal',
          source: chainOr(row, 'manual'),
          toAccountId: text(row.toAccountId),
          toAccountName: text(row.toAccountName),
          ...fee(row),
        }),
      ),
      ...swaps.map(
        (row): ExportOperation => ({
          ...base(row, 'swap'),
          type: 'swap',
          direction: 'internal',
          source: 'manual',
          counterAsset: text(row.counterSymbol ?? row.counterName),
          counterQuantity: text(row.counterQuantity),
          valueUsd: text(row.considerationUsd),
          ...fee(row),
        }),
      ),
      ...rewards.map(
        (row): ExportOperation => ({
          ...base(row, 'reward'),
          type: rewardType(row.category as Parameters<typeof rewardType>[0]),
          direction: 'in',
          source: chainOr(row, 'manual'),
          valueUsd: text(row.incomeValueUsd),
          costBasisUsd: text(row.acquisitionBasisUsd),
        }),
      ),
      ...openings.map(
        (row): ExportOperation => ({
          ...base(row, 'opening'),
          type: 'opening-balance',
          direction: 'in',
          source: 'manual',
          costBasisUsd: carriedCost(row),
        }),
      ),
      ...flows.map(
        (row): ExportOperation => ({
          ...base(row, 'flow'),
          type: row.direction === 'withdrawal' ? 'withdrawal' : 'deposit',
          direction: row.direction === 'withdrawal' ? 'out' : 'in',
          source: 'manual',
          valueUsd: text(row.quantity),
        }),
      ),
    ];
  }

  private async chain(manager: EntityManager, owner: string): Promise<ExportChainTransaction[]> {
    const rows: Row[] = await manager.query(
      `SELECT w.id AS "walletId", w.network, w.address, w.label AS "walletLabel",
          a.name AS "accountName", t.txid, t.asset, t."blockHeight", t."blockTime", t.direction,
          t."receivedUnits"::text AS "receivedUnits", t."sentUnits"::text AS "sentUnits",
          t."feeUnits"::text AS "feeUnits",
          coalesce((SELECT sum(m.units) FROM ${stakeMoves} m WHERE t.asset IS NULL
            AND m."ownerId"=t."ownerId" AND m."addressId"=t."addressId"
            AND m.txid=t.txid), 0)::text AS "stakeUnits",
          c.version AS "classificationVersion", c.status AS "classificationStatus",
          c.type AS "classificationType", c.details AS "classificationDetails",
          c.comment AS "classificationComment", c.automatic, c."linkedAddressId",
          c."tradeId", c."rewardId", c."transferId", c."createdAt" AS "classifiedAt"
        FROM wallet_addresses w
        JOIN wallet_address_transactions t ON t."ownerId"=w."ownerId" AND t."addressId"=w.id
        LEFT JOIN manual_accounts a ON a."ownerId"=w."ownerId" AND a.id=w."accountId"
        LEFT JOIN chain_transaction_classifications h ON h."ownerId"=t."ownerId"
          AND h."addressId"=t."addressId" AND h.txid=t.txid
        LEFT JOIN chain_transaction_classification_versions c ON c."ownerId"=h."ownerId"
          AND c."addressId"=h."addressId" AND c.txid=h.txid AND c.version=h."currentVersion"
        WHERE w."ownerId"=$1`,
      [owner],
    );
    return rows.map((row) => ({
      walletId: String(row.walletId),
      network: String(row.network),
      address: String(row.address),
      walletLabel: text(row.walletLabel),
      accountName: text(row.accountName),
      txid: String(row.txid),
      asset: text(row.asset),
      blockHeight: Number(row.blockHeight),
      blockTime: iso(row.blockTime),
      direction: String(row.direction),
      receivedUnits: String(row.receivedUnits),
      sentUnits: String(row.sentUnits),
      feeUnits: String(row.feeUnits),
      stakeUnits: String(row.stakeUnits),
      classificationStatus:
        (row.classificationStatus as ExportChainTransaction['classificationStatus']) ?? null,
      classificationType: text(row.classificationType),
      classificationDetails: row.classificationDetails ?? null,
      classificationComment: text(row.classificationComment),
      automatic:
        row.automatic === null || row.automatic === undefined ? null : row.automatic === true,
      linkedAddressId: text(row.linkedAddressId),
      operationId: row.tradeId
        ? `trade:${row.tradeId}`
        : row.rewardId
          ? `reward:${row.rewardId}`
          : row.transferId
            ? `transfer:${row.transferId}`
            : null,
      classificationVersion:
        row.classificationVersion === null ? null : Number(row.classificationVersion),
      classifiedAt: row.classifiedAt ? iso(row.classifiedAt) : null,
    }));
  }
}
