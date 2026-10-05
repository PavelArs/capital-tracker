import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

export type HistoryPeriod = '24H' | '7D' | '1M' | '3M' | '1Y' | 'ALL';
export const historyPeriods: readonly HistoryPeriod[] = ['24H', '7D', '1M', '3M', '1Y', 'ALL'];

// Exact decimal strings from GET /accounting/portfolio/history (record-portfolio-snapshots):
// stored snapshots of the period, then the current value. A null value had no rate.
export interface HistoryPoint {
  at: string;
  value: string | null;
  complete: boolean;
}

export interface PortfolioHistory {
  period: HistoryPeriod;
  currency: AccountingCurrency;
  mainCurrency: AccountingCurrency;
  from: string;
  at: string;
  value: string | null;
  complete: boolean;
  change: string | null;
  changePercent: string | null;
  points: HistoryPoint[];
}

export const portfolioHistoryApi = {
  get: async (period: HistoryPeriod, currency?: AccountingCurrency): Promise<PortfolioHistory> => {
    const response = await apiClient.get<PortfolioHistory>('/accounting/portfolio/history', {
      params: currency ? { period, currency } : { period },
    });
    return response.data;
  },
};
