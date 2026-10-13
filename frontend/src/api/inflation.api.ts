import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

export interface InflationManualMonth {
  /** YYYY-MM */
  month: string;
  /** Price change over the month, percent as exact text. */
  changePercent: string;
}

export interface CurrencyInflation {
  currency: AccountingCurrency;
  /** The publisher the official series is read from; null while a currency has none. */
  officialSource: string | null;
  officialLastMonth: string | null;
  lastMonth: string | null;
  comparableFrom: string | null;
  /** Price change over the last twelve months with the owner's own months laid over, percent. */
  trailingYearPercent: string | null;
  /** The same from the published months alone, percent; what "official" means on screen. */
  officialTrailingYearPercent: string | null;
  estimatedMonthlyPercent: string | null;
  /** The owner's own yearly rate; null: not set, the official rate stands in. */
  personalRatePercent: string | null;
  manualMonths: InflationManualMonth[];
}

export interface InflationOverview {
  currencies: CurrencyInflation[];
  sync: {
    state: string;
    lastSuccessAt: string | null;
    errorMessage: string | null;
  } | null;
}

export const inflationApi = {
  overview: async (): Promise<InflationOverview> => {
    const response = await apiClient.get<InflationOverview>('/inflation');
    return response.data;
  },
  /** annualPercent null removes the owner's rate. */
  setPersonalRate: async (currency: AccountingCurrency, annualPercent: string | null) => {
    await apiClient.put(`/inflation/personal-rates/${currency}`, { annualPercent });
  },
  setMonth: async (currency: AccountingCurrency, month: string, changePercent: string) => {
    await apiClient.put(`/inflation/months/${currency}/${month}`, { changePercent });
  },
  removeMonth: async (currency: AccountingCurrency, month: string) => {
    await apiClient.delete(`/inflation/months/${currency}/${month}`);
  },
};
