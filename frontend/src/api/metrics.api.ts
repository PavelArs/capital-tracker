import type { Metrics, MetricsHistory } from '@shared/types';
import apiClient from './client';

export const metricsApi = {
  getMetrics: async (currency = 'USD'): Promise<Metrics> => {
    const response = await apiClient.get<Metrics>('/metrics', {
      params: { currency },
    });
    return response.data;
  },

  getHistory: async (currency = 'USD', days = 30): Promise<MetricsHistory[]> => {
    const response = await apiClient.get<MetricsHistory[]>('/metrics/history', {
      params: { currency, days },
    });
    return response.data;
  },
};
