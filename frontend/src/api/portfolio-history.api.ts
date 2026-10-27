import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

export type HistoryPeriod = '24H' | '7D' | '1M' | '3M' | '1Y' | 'ALL';

/** Why the market part of the period's change is unknown. */
export type MarketMissing =
  | 'no-start'
  | 'flow-without-rate'
  | 'value-unknown'
  | 'deposit-without-rate'
  | 'priced-later'
  | 'unpriced-changed';
export const historyPeriods: readonly HistoryPeriod[] = ['24H', '7D', '1M', '3M', '1Y', 'ALL'];

// Exact decimal strings from GET /accounting/portfolio/history (record-portfolio-snapshots):
// stored snapshots of the period, then the current value. A null value had no rate.
// `invested` is net invested up to the point: deposits minus withdrawals at each one's
// date's rate (split-market-and-flows), leaving out a flow without a rate (INVESTED-RATED).
export interface HistoryPoint {
  at: string;
  value: string | null;
  complete: boolean;
  invested: string | null;
}

// Profit to date after inflation (INFL-REAL): every deposit and withdrawal is carried to today
// by the inflation since its day, in the currency of the history. `invested` is that money in
// today's currency, `profit` the value less it; a deposit without a rate is left out, as in
// the nominal figure. Null when a deposit lies before the inflation history or a price or rate
// of the value is missing. With no own rate set, the own-rate reading is the official one.
export interface RealProfit {
  invested: string;
  profit: string | null;
  profitPercent: string | null;
  /** The span reaches past the latest published month, or rests on the owner's own rate. */
  estimated: boolean;
  /** Own-rate reading only: false when the currency has no own rate and this is the official one. */
  ownRate?: boolean;
}

export interface PortfolioHistory {
  period: HistoryPeriod;
  currency: AccountingCurrency;
  mainCurrency: AccountingCurrency;
  from: string;
  at: string;
  value: string | null;
  complete: boolean;
  /** Current unpriced assets excluded consistently from value, flows and P&L. */
  excludedAssetCount?: number;
  excludedDepositCount?: number;
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
  // Why marketEffect is unknown; null when it is known. Absent in an answer saved before it.
  marketMissing?: MarketMissing | null;
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
