import apiClient from './client';
import type { Metrics, MetricsHistory } from '@shared/types';

export const metricsApi = {
  get: async (currency: string = 'USD'): Promise<Metrics> => {
    const response = await apiClient.get<Metrics>('/metrics', {
      params: { currency },
    });
    return response.data;
  },

  // Alias for get
  getMetrics: async (currency: string = 'USD'): Promise<Metrics> => {
    const response = await apiClient.get<Metrics>('/metrics', {
      params: { currency },
    });
    return response.data;
  },

  getHistory: async (currency: string = 'USD', days: number = 30): Promise<MetricsHistory[]> => {
    const response = await apiClient.get<MetricsHistory[]>('/metrics/history', {
      params: { currency, days },
    });
    return response.data;
  },
};
