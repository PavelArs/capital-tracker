import apiClient from './client';

// GET /fx-rates: Bank of Russia rates effective today (Moscow date) and the collector state.
export interface FxRatesReport {
  date: string;
  source: 'cbr';
  rates: { currency: 'USD' | 'EUR'; rubPerUnit: string | null; date: string | null }[];
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
  get: async (): Promise<FxRatesReport> => {
    const response = await apiClient.get<FxRatesReport>('/fx-rates');
    return response.data;
  },
};
