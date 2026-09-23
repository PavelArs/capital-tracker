import apiClient from './client';
import type { TradeSummary } from './trades.api';

export interface HistoricalPosition {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costUsd: string;
}

export interface HistoricalSnapshot {
  accountId: string;
  at: string;
  coverageFrom: string;
  journalRevision: number;
  basis: 'current-effective-history';
  originKind: 'declared-empty' | 'known-cost-carry-in';
  openingRevision: number | null;
  initialCostUsd: string;
  summary: TradeSummary;
  items: HistoricalPosition[];
  nextOffset: number | null;
}

export const historicalAccountingApi = {
  snapshot: async (
    accountId: string,
    at: string,
    offset = 0,
    journalRevision?: number,
  ): Promise<HistoricalSnapshot> =>
    (
      await apiClient.get<HistoricalSnapshot>(
        `/accounting/accounts/${encodeURIComponent(accountId)}/trade-journal/history`,
        {
          params: {
            at,
            offset,
            limit: 50,
            ...(journalRevision === undefined ? {} : { journalRevision }),
          },
        },
      )
    ).data,
};
