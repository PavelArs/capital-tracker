import type { UuidPage } from './accounting.api';
import apiClient from './client';
import type { TradeExecution, TradeSummary, TradeVersion } from './trades.api';

export type CsvState = 'draft' | 'committed' | 'rolled-back';
export type CsvField =
  | 'instrument'
  | 'side'
  | 'occurredAt'
  | 'order'
  | 'quantity'
  | 'grossUsd'
  | 'feeUsd'
  | 'currency';
export interface CsvSettings {
  format: {
    delimiter: ',' | ';';
    decimalSeparator: '.' | ',';
    timestampMode: 'offset' | 'fixed-offset';
    fixedOffset?: string;
  };
  mapping: {
    columns: Record<Exclude<CsvField, 'currency'>, number> & { currency?: number };
    instruments: Array<{ source: string; instrumentId: string }>;
    sides: Array<{ source: string; side: 'buy' | 'sell' }>;
  };
  assertUsd: true;
}
export interface CsvIdentity {
  batchId: string;
  sha256: string;
  byteLength: number;
  createdAt: string;
}
export interface CsvBatch extends CsvIdentity {
  accountId: string;
  filename: string;
  state: CsvState;
}
export interface CsvError {
  code: string;
  line: number | null;
  column: number | null;
}
export interface CsvDocument {
  batchId: string;
  valid: true;
  headers: string[];
  rows: Array<{ ordinal: number; startLine: number; cells: string[] }>;
  error: null;
}
export type CsvInspection =
  | CsvDocument
  | {
      batchId: string;
      valid: false;
      headers: [];
      rows: [];
      error: CsvError;
    };
export interface CsvPreviewResult {
  batchId: string;
  parserVersion: string;
  journalRevision: number;
  canConfirm: boolean;
  rows: Array<{ ordinal: number; startLine: number; execution: TradeExecution | null }>;
  ignoredColumns: Array<{ index: number; header: string }>;
  rowErrors: Array<{ ordinal: number; field: CsvField; code: string }>;
  batchErrors: CsvError[];
  summaryBefore: TradeSummary;
  candidateSummary: TradeSummary | null;
  previewHash: string | null;
}
export interface CsvConfirm extends CsvSettings {
  requestId: string;
  expectedJournalRevision: number;
  parserVersion: string;
  previewHash: string;
}
export interface CsvRollback {
  requestId: string;
  expectedJournalRevision: number;
}
export interface CsvReceipt {
  accountId: string;
  batchId: string;
  requestId: string;
  kind: 'confirm' | 'rollback';
  rowCount: number;
  firstJournalRevision: number;
  lastJournalRevision: number;
  createdAt: string;
}
export interface CsvDetail {
  batch: CsvBatch;
  acceptedSettings: (CsvSettings & { parserVersion: string }) | null;
  confirmReceipt: CsvReceipt | null;
  rollbackReceipt: CsvReceipt | null;
  rollbackReview: {
    journalRevision: number;
    eligible: boolean;
    reason:
      | 'not-committed'
      | 'modified-trade'
      | 'version-cap'
      | 'insufficient-holdings'
      | 'connected-history'
      | 'connected-capacity'
      | null;
    removedTradeCount: number;
    additionalVersionCount: number;
    summaryBefore: TradeSummary;
    summaryAfter: TradeSummary | null;
  };
}
export interface CsvRows {
  batchId: string;
  batchState: CsvState;
  items: Array<{
    ordinal: number;
    startLine: number;
    tradeId: string;
    createVersion: TradeVersion;
    rollbackVersion: TradeVersion | null;
  }>;
  nextAfterOrdinal: number | null;
}

const base = (account: string) => `/accounting/accounts/${encodeURIComponent(account)}/csv-imports`;
const batchPath = (account: string, batch: string) =>
  `${base(account)}/${encodeURIComponent(batch)}`;

export const csvImportsApi = {
  upload: async (account: string, file: File): Promise<CsvIdentity> => {
    const bytes = new TextEncoder().encode(file.name);
    const name = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const body = new FormData();
    body.append('file', new Blob([file], { type: 'application/octet-stream' }), 'upload.csv');
    body.append('displayNameBase64url', name);
    return (
      await apiClient.post<CsvIdentity>(base(account), body, {
        headers: { 'Content-Type': undefined },
      })
    ).data;
  },
  list: async (account: string, cursor?: string): Promise<UuidPage<CsvBatch>> =>
    (
      await apiClient.get<UuidPage<CsvBatch>>(base(account), {
        params: { limit: 20, ...(cursor ? { cursor } : {}) },
      })
    ).data,
  detail: async (account: string, batch: string): Promise<CsvDetail> =>
    (await apiClient.get<CsvDetail>(batchPath(account, batch))).data,
  inspect: async (account: string, batch: string, delimiter: ',' | ';'): Promise<CsvInspection> =>
    (await apiClient.post<CsvInspection>(`${batchPath(account, batch)}/inspect`, { delimiter }))
      .data,
  preview: async (
    account: string,
    batch: string,
    settings: CsvSettings,
  ): Promise<CsvPreviewResult> =>
    (await apiClient.post<CsvPreviewResult>(`${batchPath(account, batch)}/preview`, settings)).data,
  confirm: async (account: string, batch: string, input: CsvConfirm): Promise<CsvReceipt> =>
    (await apiClient.post<CsvReceipt>(`${batchPath(account, batch)}/confirm`, input)).data,
  rollback: async (account: string, batch: string, input: CsvRollback): Promise<CsvReceipt> =>
    (await apiClient.post<CsvReceipt>(`${batchPath(account, batch)}/rollback`, input)).data,
  rows: async (
    account: string,
    batch: string,
    afterOrdinal = 0,
    batchState?: CsvState,
  ): Promise<CsvRows> =>
    (
      await apiClient.get<CsvRows>(`${batchPath(account, batch)}/rows`, {
        params: { limit: 20, afterOrdinal, ...(batchState ? { batchState } : {}) },
      })
    ).data,
};
