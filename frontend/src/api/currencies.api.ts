import type { Currency } from '@shared/types';
import apiClient from './client';

export interface ConversionResult {
  from: string;
  to: string;
  amount: number;
  result: number;
  rate: number;
}

export const currenciesApi = {
  getList: async (): Promise<Currency[]> => {
    const response = await apiClient.get<Currency[]>('/currencies/list');
    return response.data;
  },

  convert: async (amount: number, from: string, to: string): Promise<number> => {
    const response = await apiClient.get<number | ConversionResult>('/currencies/convert', {
      params: { amount, from, to },
    });
    // API may return a number directly or a ConversionResult object
    const data = response.data;
    if (typeof data === 'number') {
      return data;
    }
    return data.result;
  },

  getHidden: async (): Promise<Currency[]> => {
    const response = await apiClient.get<Currency[]>('/currencies/hidden');
    return response.data;
  },

  hide: async (currencyId: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/currencies/hide', {
      currencyId,
      isHidden: true,
    });
    return response.data;
  },

  show: async (currencyId: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/currencies/show', {
      currencyId,
      isHidden: false,
    });
    return response.data;
  },
};
