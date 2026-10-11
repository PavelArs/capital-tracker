import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

export interface OwnerSettings {
  mainCurrency: AccountingCurrency;
  /** Incoming wallet transactions worth less (USD) skip classification; null: off. */
  dustThresholdUsd: string | null;
}

export const ownerSettingsApi = {
  get: async (): Promise<OwnerSettings> => {
    const response = await apiClient.get<OwnerSettings>('/owner-settings');
    return response.data;
  },
  /** Saves the settings given; the others keep their saved values. */
  update: async (settings: Partial<OwnerSettings>): Promise<OwnerSettings> => {
    const response = await apiClient.put<OwnerSettings>('/owner-settings', settings);
    return response.data;
  },
};
