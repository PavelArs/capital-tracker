import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

export interface OwnerSettings {
  mainCurrency: AccountingCurrency;
}

export const ownerSettingsApi = {
  get: async (): Promise<OwnerSettings> => {
    const response = await apiClient.get<OwnerSettings>('/owner-settings');
    return response.data;
  },
  update: async (settings: OwnerSettings): Promise<OwnerSettings> => {
    const response = await apiClient.put<OwnerSettings>('/owner-settings', settings);
    return response.data;
  },
};
