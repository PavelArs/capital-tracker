import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

export type HistoryPeriod = '24H' | '7D' | '1M' | '3M' | '1Y' | 'ALL';
export const historyPeriods: readonly HistoryPeriod[] = ['24H', '7D', '1M', '3M', '1Y', 'ALL'];

// Exact decimal strings from GET /accounting/portfolio/history (record-portfolio-snapshots):
// stored snapshots of the period, then the current value. A null value had no rate.
// `invested` is net invested up to the point: deposits minus withdrawals at each one's
// date's rate (split-market-and-flows); null when a flow had no rate.
export interface HistoryPoint {
  at: string;
  value: string | null;
  complete: boolean;
  invested: string | null;
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
  invested: string | null;
  // The period's change split into money added or taken out and the market:
  // marketEffect = change − netFlow; marketReturnPercent = marketEffect / (start + deposits).
  deposits: string | null;
  withdrawals: string | null;
  netFlow: string | null;
  marketEffect: string | null;
  marketReturnPercent: string | null;
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
