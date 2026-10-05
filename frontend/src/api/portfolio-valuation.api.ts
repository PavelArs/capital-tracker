import apiClient from './client';
import type { AssetType, PriceSource, ValuationCurrency } from './portfolio-assets.api';

export type AccountingCurrency = 'USD' | 'EUR' | 'RUB';
export const accountingCurrencies: readonly AccountingCurrency[] = ['USD', 'EUR', 'RUB'];

// Exact decimal strings from GET /accounting/portfolio (portfolio-valuation, PV-1..4), stated
// in one accounting currency at Bank of Russia rates (account-in-three-currencies, CUR-*).
export interface AssetPrice {
  value: string;
  observedAt: string | null;
  source: string;
  status: 'fresh' | 'stale' | 'manual' | 'fixed';
}

export interface AssetHolding {
  accountId: string;
  accountName: string;
  quantity: string;
  value: string | null;
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
  value: string | null;
  allocationPercent: string | null;
  costBasis: string | null;
  knownCostSubtotal: string;
  unknownCostQuantity: string;
  missingRateQuantity: string;
  averageBuyPrice: string | null;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  realizedPnl: string | null;
  knownRealizedSubtotal: string;
  unknownRealizedCount: number;
  holdings: AssetHolding[];
}

export interface AllocationSlice {
  key: string;
  label: string;
  value: string;
  percent: string | null;
}

export interface FxRate {
  currency: 'USD' | 'EUR';
  date: string;
  rubPerUnit: string;
}

export interface PortfolioValuation {
  at: string;
  currency: AccountingCurrency;
  mainCurrency: AccountingCurrency;
  rates: FxRate[];
  completeness: 'complete' | 'incomplete';
  totalValue: string | null;
  pricedSubtotal: string;
  missingPriceCount: number;
  stalePriceCount: number;
  unavailableAccountCount: number;
  costBasis: string | null;
  knownCostSubtotal: string;
  unknownCostCount: number;
  missingRateCount: number;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  realizedPnl: string | null;
  knownRealizedSubtotal: string;
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
    pricedValue: string | null;
    missingPriceCount: number;
  }[];
}

export const portfolioValuationApi = {
  /** Without a currency the owner's main currency is used. */
  get: async (currency?: AccountingCurrency): Promise<PortfolioValuation> => {
    const response = await apiClient.get<PortfolioValuation>('/accounting/portfolio', {
      params: currency ? { currency } : undefined,
    });
    return response.data;
  },
};
