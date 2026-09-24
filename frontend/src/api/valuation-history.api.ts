import apiClient from './client';

export interface ValuationHistoryPoint {
  at: string;
  completeness: 'complete' | 'incomplete';
  missingPriceCount: number;
  pricedSubtotalUsd: string;
  totalValueUsd: string | null;
}

export interface ValuationHistorySeries {
  accountId: string;
  from: string;
  to: string;
  coverageFrom: string;
  journalRevision: number;
  originKind: 'declared-empty' | 'known-cost-carry-in';
  openingRevision: number | null;
  basis: 'current-effective-history';
  priceSource: 'manual';
  quoteCurrency: 'USD';
  pricePolicy: 'exact-instant';
  sampling: '24h-from-start-and-end';
  points: ValuationHistoryPoint[];
}

export const valuationHistoryApi = {
  series: async (accountId: string, from: string, to: string): Promise<ValuationHistorySeries> =>
    (
      await apiClient.get<ValuationHistorySeries>(
        `/accounting/accounts/${encodeURIComponent(accountId)}/valuation-history`,
        { params: { from, to } },
      )
    ).data,
};
