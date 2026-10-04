import type { Instrument } from './accounting.api';
import apiClient from './client';

export type AssetType = 'crypto' | 'fiat' | 'manual';
export type ValuationCurrency = 'USD' | 'EUR' | 'RUB';
export type PriceSource = 'market' | 'manual' | 'fixed';

// An accounting instrument with its classification (asset-classification, AST-1).
export interface PortfolioAsset extends Instrument {
  assetType: AssetType;
  valuationCurrency: ValuationCurrency;
  priceSource: PriceSource;
}

export interface NewPortfolioAsset {
  requestId: string;
  name: string;
  symbol?: string;
  assetType: AssetType;
  valuationCurrency?: ValuationCurrency;
}

interface AssetPage {
  items: PortfolioAsset[];
  nextCursor: string | null;
}

export const portfolioAssetsApi = {
  listPage: async (cursor?: string): Promise<AssetPage> => {
    const response = await apiClient.get<AssetPage>('/accounting/instruments', {
      params: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  },

  // Follows every cursor so no asset beyond the first page is hidden.
  listAll: async (): Promise<PortfolioAsset[]> => {
    const assets: PortfolioAsset[] = [];
    let cursor: string | undefined;
    do {
      const page = await portfolioAssetsApi.listPage(cursor);
      assets.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return assets;
  },

  create: async (input: NewPortfolioAsset): Promise<PortfolioAsset> => {
    const response = await apiClient.post<PortfolioAsset>('/accounting/instruments', input);
    return response.data;
  },
};
