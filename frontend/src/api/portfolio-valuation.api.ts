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

/**
 * Cost and profit after inflation (INFL-REAL-PF): each held lot carried to today by the
 * inflation since its day. Null when a lot has no cost, rate or inflation figure.
 */
export interface RealReading {
  costBasis: string;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  /** Some span reaches past the latest published month, or rests on the owner's own rate. */
  estimated: boolean;
  /** Own-rate reading only: false when the currency has no own rate and this is the official one. */
  ownRate?: boolean;
}
export interface RealReadings {
  official: RealReading | null;
  personal: RealReading | null;
}

/** One purchase carried to today (INFL-REAL-LOTS): the reading of one lot of one asset. */
export interface LotReading extends RealReading {
  /** What prices rose by since the day the lot was acquired, in percent. */
  inflationPercent: string;
}

export interface LotAfterInflation {
  accountId: string;
  accountName: string;
  acquiredAt: string;
  quantity: string;
  /** Null when the lot has no cost, or none can be stated in the report currency. */
  paid: string | null;
  value: string | null;
  nominalPnl: string | null;
  real: {
    official: LotReading | null;
    personal: LotReading | null;
  };
}

export interface AssetLots {
  instrumentId: string;
  currency: AccountingCurrency;
  /** False while an account whose history starts later may hold more lots than are listed. */
  complete: boolean;
  /** Newest first. */
  lots: LotAfterInflation[];
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
  /** The price's change since the same moment a day earlier; null when either is unknown. */
  priceChange24hPercent: string | null;
  value: string | null;
  allocationPercent: string | null;
  costBasis: string | null;
  knownCostSubtotal: string;
  unknownCostQuantity: string;
  missingRateQuantity: string;
  /** The quantity whose cost is known, the part that known-part figures below cover. */
  knownCostQuantity: string;
  averageBuyPrice: string | null;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  /** Value less cost over the coins whose cost is known; the rest is left out. */
  knownUnrealizedPnl: string | null;
  knownUnrealizedReturnPercent: string | null;
  realizedPnl: string | null;
  knownRealizedSubtotal: string;
  unknownRealizedCount: number;
  holdings: AssetHolding[];
  /** Absent in an answer the browser saved before this was added. */
  real?: RealReadings;
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
  /** What the bank deposits are worth, part of the value; none by default. */
  depositsValue: string;
  /** Deposits whose currency has no fresh Bank of Russia rate; left out of the value. */
  unratedDepositCount: number;
  costBasis: string | null;
  knownCostSubtotal: string;
  unknownCostCount: number;
  missingRateCount: number;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  knownUnrealizedPnl: string | null;
  knownUnrealizedReturnPercent: string | null;
  realizedPnl: string | null;
  knownRealizedSubtotal: string;
  unknownRealizedCount: number;
  assets: AssetValuation[];
  /** Absent in an answer the browser saved before this was added. */
  real?: RealReadings;
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
  /** The held lots of one asset with their cost and profit after inflation, newest first. */
  lots: async (instrumentId: string, currency?: AccountingCurrency): Promise<AssetLots> => {
    const response = await apiClient.get<AssetLots>(
      `/accounting/portfolio/assets/${encodeURIComponent(instrumentId)}/lots`,
      { params: currency ? { currency } : undefined },
    );
    return response.data;
  },
};
