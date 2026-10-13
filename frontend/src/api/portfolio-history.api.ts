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

// Profit to date after inflation (INFL-REAL): every deposit and withdrawal is carried to today
// by the inflation since its day, in the currency of the history. `invested` is that money in
// today's currency, `profit` the value less it. Null when a deposit lies before the inflation
// history, a deposit had no rate, or (own rate) no rate is set for the currency.
export interface RealProfit {
  invested: string;
  profit: string | null;
  profitPercent: string | null;
  /** The span reaches past the latest published month, or rests on the owner's own rate. */
  estimated: boolean;
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
  // Profit or loss to date, whatever the period: value − invested, and its share of invested
  // (null when invested is not above zero).
  profit: string | null;
  profitPercent: string | null;
  // The period's change split into money added or taken out and the market:
  // marketEffect = change − netFlow; marketReturnPercent = marketEffect / (start + deposits).
  deposits: string | null;
  withdrawals: string | null;
  netFlow: string | null;
  marketEffect: string | null;
  marketReturnPercent: string | null;
  // Absent in an answer the browser saved before this was added.
  real?: { official: RealProfit | null; personal: RealProfit | null };
  points: HistoryPoint[];
}

// The first read after a change (or after the day's interest is posted) waits for the server to
// rebuild the stored snapshots, which can take longer than the client's usual ten seconds.
const HISTORY_TIMEOUT_MS = 30_000;

export const portfolioHistoryApi = {
  get: async (period: HistoryPeriod, currency?: AccountingCurrency): Promise<PortfolioHistory> => {
    const response = await apiClient.get<PortfolioHistory>('/accounting/portfolio/history', {
      params: currency ? { period, currency } : { period },
      timeout: HISTORY_TIMEOUT_MS,
    });
    return response.data;
  },
};
