import apiClient from './client';
import type { ValuationPosition } from './historical-valuation.api';

export interface ManualPortfolioValuationAccount {
  accountId: string;
  name: string;
  coverage: 'covered' | 'missing-journal' | 'before-coverage';
  coverageFrom: string | null;
  journalRevision: number | null;
  completeness: 'complete' | 'incomplete';
  missingPriceCount: number | null;
  pricedSubtotalUsd: string | null;
  totalValueUsd: string | null;
  items: ValuationPosition[];
}

export interface ManualPortfolioValuationResponse {
  at: string;
  accountIds: string[];
  scope: 'selected-manual-accounts';
  basis: 'current-effective-history';
  priceSource: 'manual';
  quoteCurrency: 'USD';
  pricePolicy: 'exact-instant';
  completeness: 'complete' | 'incomplete';
  unavailableAccountCount: number;
  missingPriceCount: number;
  pricedSubtotalUsd: string;
  totalValueUsd: string | null;
  accounts: ManualPortfolioValuationAccount[];
}

export const manualPortfolioValuationApi = {
  preview: async (at: string, accountIds: string[]): Promise<ManualPortfolioValuationResponse> =>
    (
      await apiClient.post<ManualPortfolioValuationResponse>(
        '/accounting/manual-valuation-preview',
        {
          at,
          accountIds,
        },
      )
    ).data,
};
