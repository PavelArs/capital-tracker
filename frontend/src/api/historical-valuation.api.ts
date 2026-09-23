import apiClient from './client';

export interface ValuationPosition {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costUsd: string;
  price: { priceUsd: string; observedAt: string; revision: number } | null;
  valueUsd: string | null;
}

export interface HistoricalValuationSnapshot {
  accountId: string;
  at: string;
  coverageFrom: string;
  journalRevision: number;
  basis: 'current-effective-history';
  originKind: 'declared-empty' | 'known-cost-carry-in';
  openingRevision: number | null;
  priceSource: 'manual';
  quoteCurrency: 'USD';
  pricePolicy: 'exact-instant';
  completeness: 'complete' | 'incomplete';
  missingPriceCount: number;
  pricedSubtotalUsd: string;
  totalValueUsd: string | null;
  items: ValuationPosition[];
}

export const historicalValuationApi = {
  snapshot: async (accountId: string, at: string): Promise<HistoricalValuationSnapshot> =>
    (
      await apiClient.get<HistoricalValuationSnapshot>(
        `/accounting/accounts/${encodeURIComponent(accountId)}/valuation`,
        { params: { at } },
      )
    ).data,
};
