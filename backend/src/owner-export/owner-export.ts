import type { RewardOperationInput } from '../accounting/operation-list';
import type { TradePurpose } from '../accounting/trade-purpose';
import { chainAsset, feeAsset, formatUnits } from '../wallet-addresses/chain-assets';
import { type CsvCell, csvFile } from './csv';
import type { ZipFile } from './zip';

// export-owner-data (M19, PR-EXP-1): the owner's data as one CSV per entity (EXP-CSV) and a
// versioned JSON backup (EXP-JSON). Amounts are exact decimals and times ISO 8601 in UTC.

export interface ExportAsset {
  id: string;
  name: string;
  symbol: string | null;
  assetType: string;
  valuationCurrency: string;
  priceSource: string;
  createdAt: string;
}
export interface ExportAccount {
  id: string;
  name: string;
  createdAt: string;
}
export interface ExportWallet {
  id: string;
  network: string;
  address: string;
  label: string | null;
  accountId: string | null;
  accountName: string | null;
  createdAt: string;
}
/** One journal entry at its last recorded content; a voided one keeps what it said before. */
export interface ExportOperation {
  /** As the Transactions list names it: `trade:<id>`, `transfer:<id>` and so on. */
  id: string;
  kind: 'trade' | 'transfer' | 'swap' | 'reward' | 'opening' | 'flow';
  type: string;
  direction: 'in' | 'out' | 'internal';
  status: 'active' | 'voided';
  /** Csv: imported from a CSV file; chain: produced by classifying a chain transaction. */
  source: 'manual' | 'csv' | 'chain';
  occurredAt: string;
  orderWithinTimestamp: number;
  accountId: string | null;
  accountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  asset: string | null;
  assetName: string;
  /** TOKEN-CHAIN: the blockchain of a token a chain transaction moved; null otherwise. */
  assetNetwork: string | null;
  quantity: string;
  counterAsset: string | null;
  counterQuantity: string | null;
  counterAssetNetwork: string | null;
  valueUsd: string | null;
  costBasisUsd: string | null;
  feeUsd: string | null;
  feeAsset: string | null;
  feeQuantity: string | null;
  paidCurrency: string | null;
  paidAmount: string | null;
  paidFee: string | null;
  paidPerUsd: string | null;
  paidRateDate: string | null;
  paidRateSource: string | null;
  settlementAsset: string | null;
  settlementQuantity: string | null;
  comment: string | null;
  chainTxid: string | null;
  version: number | null;
  recordedAt: string;
}
/** A raw chain transaction leg in base units and the owner's current answer for it. */
export interface ExportChainTransaction {
  walletId: string;
  network: string;
  address: string;
  walletLabel: string | null;
  accountName: string | null;
  txid: string;
  asset: string | null;
  blockHeight: number;
  blockTime: string;
  direction: string;
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
  stakeUnits: string;
  classificationStatus: 'unclassified' | 'classified' | 'hidden' | null;
  classificationType: string | null;
  classificationDetails: unknown;
  classificationComment: string | null;
  automatic: boolean | null;
  linkedAddressId: string | null;
  operationId: string | null;
  classificationVersion: number | null;
  classifiedAt: string | null;
}
export interface ExportData {
  assets: readonly ExportAsset[];
  accounts: readonly ExportAccount[];
  wallets: readonly ExportWallet[];
  operations: readonly ExportOperation[];
  chain: readonly ExportChainTransaction[];
}

const purposeTypes: Record<TradePurpose, string> = {
  income: 'income',
  expense: 'expense',
  'gift-received': 'gift',
  'gift-sent': 'gift',
  fee: 'fee',
};
const rewardTypes: Record<RewardOperationInput['category'], string> = {
  staking: 'staking-reward',
  airdrop: 'airdrop',
  other: 'reward',
  unclassified: 'reward',
};
export const tradeType = (side: 'buy' | 'sell', purpose: TradePurpose | null) =>
  purpose ? purposeTypes[purpose] : side;
export const rewardType = (category: RewardOperationInput['category']) => rewardTypes[category];

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byCreation = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  byText(a.createdAt, b.createdAt) || byText(a.id, b.id);

function table<T>(
  name: string,
  columns: readonly (readonly [string, (row: T) => CsvCell])[],
  rows: readonly T[],
): ZipFile {
  return {
    name,
    data: csvFile(
      columns.map(([header]) => header),
      rows.map((row) => columns.map(([, value]) => value(row))),
    ),
  };
}

const operationColumns: readonly (readonly [string, (row: ExportOperation) => CsvCell])[] = [
  ['id', (row) => row.id],
  ['kind', (row) => row.kind],
  ['type', (row) => row.type],
  ['direction', (row) => row.direction],
  ['status', (row) => row.status],
  ['source', (row) => row.source],
  ['occurred_at', (row) => row.occurredAt],
  ['order_within_timestamp', (row) => row.orderWithinTimestamp],
  ['account_id', (row) => row.accountId],
  ['account', (row) => row.accountName],
  ['to_account_id', (row) => row.toAccountId],
  ['to_account', (row) => row.toAccountName],
  ['asset', (row) => row.asset],
  ['asset_name', (row) => row.assetName],
  ['asset_network', (row) => row.assetNetwork],
  ['quantity', (row) => row.quantity],
  ['counter_asset', (row) => row.counterAsset],
  ['counter_quantity', (row) => row.counterQuantity],
  ['counter_asset_network', (row) => row.counterAssetNetwork],
  ['value_usd', (row) => row.valueUsd],
  ['cost_basis_usd', (row) => row.costBasisUsd],
  ['fee_usd', (row) => row.feeUsd],
  ['fee_asset', (row) => row.feeAsset],
  ['fee_quantity', (row) => row.feeQuantity],
  ['paid_currency', (row) => row.paidCurrency],
  ['paid_amount', (row) => row.paidAmount],
  ['paid_fee', (row) => row.paidFee],
  ['paid_per_usd', (row) => row.paidPerUsd],
  ['paid_rate_date', (row) => row.paidRateDate],
  ['paid_rate_source', (row) => row.paidRateSource],
  ['settlement_asset', (row) => row.settlementAsset],
  ['settlement_quantity', (row) => row.settlementQuantity],
  ['comment', (row) => row.comment],
  ['chain_txid', (row) => row.chainTxid],
  ['version', (row) => row.version],
  ['recorded_at', (row) => row.recordedAt],
];

function coins(row: ExportChainTransaction) {
  const moved = chainAsset(row.network, row.asset);
  const native = feeAsset(row.network, row.asset);
  return {
    asset: moved.symbol,
    received: formatUnits(BigInt(row.receivedUnits), moved),
    sent: formatUnits(BigInt(row.sentUnits), moved),
    feeAsset: native.symbol,
    fee: formatUnits(BigInt(row.feeUnits), native),
    staked: BigInt(row.stakeUnits) === 0n ? null : formatUnits(BigInt(row.stakeUnits), native),
  };
}

const chainColumns: readonly (readonly [
  string,
  (row: ExportChainTransaction & ReturnType<typeof coins>) => CsvCell,
])[] = [
  ['wallet_id', (row) => row.walletId],
  ['network', (row) => row.network],
  ['address', (row) => row.address],
  ['wallet_label', (row) => row.walletLabel],
  ['account', (row) => row.accountName],
  ['txid', (row) => row.txid],
  ['block_height', (row) => row.blockHeight],
  ['block_time', (row) => row.blockTime],
  ['direction', (row) => row.direction],
  ['asset', (row) => row.asset],
  ['received', (row) => row.received],
  ['sent', (row) => row.sent],
  ['fee_asset', (row) => row.feeAsset],
  ['fee', (row) => row.fee],
  ['staked', (row) => row.staked],
  ['classification_status', (row) => row.classificationStatus ?? 'unclassified'],
  ['classification_type', (row) => row.classificationType],
  [
    'classification_details',
    (row) =>
      row.classificationDetails === null ? null : JSON.stringify(row.classificationDetails),
  ],
  ['comment', (row) => row.classificationComment],
  ['automatic', (row) => row.automatic],
  ['linked_wallet_id', (row) => row.linkedAddressId],
  ['operation_id', (row) => row.operationId],
  ['classification_version', (row) => row.classificationVersion],
  ['classified_at', (row) => row.classifiedAt],
];

/** EXP-CSV: one CSV per entity, in a fixed order, ready to put in one archive. */
export function exportFiles(data: ExportData): ZipFile[] {
  const operations = [...data.operations].sort(
    (a, b) =>
      byText(a.occurredAt, b.occurredAt) ||
      a.orderWithinTimestamp - b.orderWithinTimestamp ||
      byText(a.id, b.id),
  );
  const chain = [...data.chain]
    .sort(
      (a, b) =>
        byText(a.blockTime, b.blockTime) ||
        byText(a.network, b.network) ||
        byText(a.address, b.address) ||
        byText(a.txid, b.txid) ||
        byText(a.asset ?? '', b.asset ?? ''),
    )
    .map((row) => ({ ...row, ...coins(row) }));
  return [
    table(
      'assets.csv',
      [
        ['id', (row: ExportAsset) => row.id],
        ['name', (row) => row.name],
        ['symbol', (row) => row.symbol],
        ['type', (row) => row.assetType],
        ['valuation_currency', (row) => row.valuationCurrency],
        ['price_source', (row) => row.priceSource],
        ['created_at', (row) => row.createdAt],
      ],
      [...data.assets].sort(byCreation),
    ),
    table(
      'accounts.csv',
      [
        ['id', (row: ExportAccount) => row.id],
        ['name', (row) => row.name],
        ['created_at', (row) => row.createdAt],
      ],
      [...data.accounts].sort(byCreation),
    ),
    table(
      'wallets.csv',
      [
        ['id', (row: ExportWallet) => row.id],
        ['network', (row) => row.network],
        ['address', (row) => row.address],
        ['label', (row) => row.label],
        ['account_id', (row) => row.accountId],
        ['account', (row) => row.accountName],
        ['created_at', (row) => row.createdAt],
      ],
      [...data.wallets].sort(byCreation),
    ),
    table('operations.csv', operationColumns, operations),
    table('chain-transactions.csv', chainColumns, chain),
  ];
}

export const BACKUP_FORMAT = 'capital-tracker-backup';
export const BACKUP_FORMAT_VERSION = 1;

/**
 * EXP-JSON: every backed-up table under its name. Each row is the JSON text PostgreSQL wrote,
 * kept as is, so 30-place amounts stay exact instead of passing through a JS number.
 */
export function backupDocument(
  exportedAt: string,
  tables: readonly { name: string; rows: readonly string[] }[],
): string {
  const head = JSON.stringify({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
  });
  const body = tables
    .map(({ name, rows }) => `${JSON.stringify(name)}:[${rows.join(',')}]`)
    .join(',');
  return `${head.slice(0, -1)},"tables":{${body}}}\n`;
}
