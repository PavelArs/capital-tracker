import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

// GET /fx-rates: Bank of Russia rates effective today (Moscow date), or on `?date=`, and the
// collector state.
export interface FxRatesReport {
  date: string;
  source: 'cbr';
  rates: {
    currency: Exclude<AccountingCurrency, 'RUB'>;
    rubPerUnit: string | null;
    date: string | null;
  }[];
  sync: null | {
    key: string;
    state: 'synced' | 'syncing' | 'delayed' | 'failed';
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextRunAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
}

export const fxRatesApi = {
  get: async (date?: string): Promise<FxRatesReport> => {
    const response = await apiClient.get<FxRatesReport>(
      '/fx-rates',
      date ? { params: { date } } : undefined,
    );
    return response.data;
  },
};
