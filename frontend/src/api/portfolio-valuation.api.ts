import apiClient from './client';
import type { AssetType, PriceSource, ValuationCurrency } from './portfolio-assets.api';

// Exact decimal strings from GET /accounting/portfolio (portfolio-valuation, PV-1..4).
export interface AssetPrice {
  priceUsd: string;
  observedAt: string | null;
  source: string;
  status: 'fresh' | 'stale' | 'manual' | 'fixed';
}

export interface AssetHolding {
  accountId: string;
  accountName: string;
  quantity: string;
  valueUsd: string | null;
}

export interface AssetValuation {
  instrumentId: string;
  name: string;
  symbol: string | null;
  assetType: AssetType;
  valuationCurrency: ValuationCurrency;
  priceSource: PriceSource;
  quantity: string;
  price: AssetPrice | null;
  missingPrice: 'no-price' | 'no-rate' | null;
  valueUsd: string | null;
  allocationPercent: string | null;
  costBasisUsd: string | null;
  knownCostSubtotalUsd: string;
  unknownCostQuantity: string;
  averageBuyPriceUsd: string | null;
  unrealizedPnlUsd: string | null;
  unrealizedReturnPercent: string | null;
  realizedPnlUsd: string | null;
  knownRealizedSubtotalUsd: string;
  unknownRealizedCount: number;
  holdings: AssetHolding[];
}

export interface AllocationSlice {
  key: string;
  label: string;
  valueUsd: string;
  percent: string | null;
}

export interface PortfolioValuation {
  at: string;
  quoteCurrency: 'USD';
  completeness: 'complete' | 'incomplete';
  totalValueUsd: string | null;
  pricedSubtotalUsd: string;
  missingPriceCount: number;
  stalePriceCount: number;
  unavailableAccountCount: number;
  costBasisUsd: string | null;
  knownCostSubtotalUsd: string;
  unknownCostCount: number;
  unrealizedPnlUsd: string | null;
  unrealizedReturnPercent: string | null;
  realizedPnlUsd: string | null;
  knownRealizedSubtotalUsd: string;
  unknownRealizedCount: number;
  assets: AssetValuation[];
  allocation: {
    complete: boolean;
    byAsset: AllocationSlice[];
    byType: AllocationSlice[];
    byAccount: AllocationSlice[];
  };
  accounts: {
    accountId: string;
    name: string;
    coverage: 'covered' | 'not-started' | 'before-coverage';
    pricedValueUsd: string | null;
    missingPriceCount: number;
  }[];
}

export const portfolioValuationApi = {
  get: async (): Promise<PortfolioValuation> => {
    const response = await apiClient.get<PortfolioValuation>('/accounting/portfolio');
    return response.data;
  },
};
