import apiClient from './client';
import type { Currency } from '@shared/types';

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  lastUpdated: string;
}

export interface ConversionResult {
  from: string;
  to: string;
  amount: number;
  result: number;
  rate: number;
}

export const currenciesApi = {
  getAll: async (): Promise<Currency[]> => {
    const response = await apiClient.get<Currency[]>('/currencies');
    return response.data;
  },

  getList: async (): Promise<Currency[]> => {
    const response = await apiClient.get<Currency[]>('/currencies/list');
    return response.data;
  },

  getExchangeRates: async (base: string = 'USD'): Promise<ExchangeRates> => {
    const response = await apiClient.get<ExchangeRates>('/currencies/rates', {
      params: { base },
    });
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
    const response = await apiClient.post<{ message: string }>('/currencies/hide', { currencyId });
    return response.data;
  },

  show: async (currencyId: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/currencies/show', { currencyId });
    return response.data;
  },

  toggle: async (currencyId: string, isHidden: boolean): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/currencies/toggle', {
      currencyId,
      isHidden,
    });
    return response.data;
  },
};
