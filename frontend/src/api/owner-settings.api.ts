import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

/** INS-RULES: what the Dashboard insights watch; percentages are exact decimal strings. */
export interface InsightRules {
  /** The share of the portfolio wanted in an asset. */
  targets: { instrumentId: string; percent: string }[];
  /** Percentage points an asset may stray from its target before it is worth a look. */
  driftPoints: string;
  /** Review an asset whose return on known cost rises to this percent; null: off. */
  gainReviewPercent: string | null;
  /** Review an asset whose return on known cost falls this percent below cost; null: off. */
  lossReviewPercent: string | null;
}

export interface OwnerSettings {
  mainCurrency: AccountingCurrency;
  /** Incoming wallet transactions worth less (USD) skip classification; null: off. */
  dustThresholdUsd: string | null;
  /** What the Dashboard insights watch; null: none set. */
  insightRules: InsightRules | null;
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
