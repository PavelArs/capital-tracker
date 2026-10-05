import apiClient from './client';
import type { HistoryPeriod } from './portfolio-history.api';
import type { AccountingCurrency } from './portfolio-valuation.api';

// Exact decimal strings from GET /accounting/portfolio/assets/:id/history (ASSET-CHART): the
// asset's value and the known cost of what was held at each instant of the period, then now.
export interface AssetHistoryPoint {
  at: string;
  quantity: string;
  /** Null when the asset had no price or rate then; nothing held is "0". */
  value: string | null;
  complete: boolean;
  /** Cost basis of the held lots whose purchase price and rate are known. */
  cost: string;
  costComplete: boolean;
}

export interface AssetHistory {
  instrumentId: string;
  period: HistoryPeriod;
  currency: AccountingCurrency;
  mainCurrency: AccountingCurrency;
  from: string;
  at: string;
  points: AssetHistoryPoint[];
}

export const assetHistoryApi = {
  get: async (
    instrumentId: string,
    period: HistoryPeriod,
    currency?: AccountingCurrency,
  ): Promise<AssetHistory> => {
    const response = await apiClient.get<AssetHistory>(
      `/accounting/portfolio/assets/${encodeURIComponent(instrumentId)}/history`,
      { params: currency ? { period, currency } : { period } },
    );
    return response.data;
  },
};
