// User & Auth types
export type SubscriptionType = 'free' | 'pro' | 'enterprise';

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  subscriptionType: SubscriptionType;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationCode {
  id: string;
  code: string;
  isUsed: boolean;
  usedAt: string | null;
  createdAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  invitationCode: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

// Asset types
export type AssetType = 'stock' | 'flow';
export type IncomeType = 'active' | 'passive';

export type AssetCategory =
  | 'real_estate'
  | 'investments'
  | 'savings'
  | 'crypto'
  | 'vehicle'
  | 'equipment'
  | 'salary'
  | 'dividends'
  | 'freelance'
  | 'rent_income'
  | 'pension'
  | 'other';

export interface Asset {
  id: string;
  userId: string;
  name: string;
  assetType: AssetType;
  category: AssetCategory;
  incomeType?: IncomeType;
  amount: number;
  currencyId: string;
  currency?: Currency;
  date: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetDto {
  name: string;
  assetType: AssetType;
  category: AssetCategory;
  incomeType?: IncomeType;
  amount: number;
  currencyId: string;
  date: string;
  description?: string;
}

export interface UpdateAssetDto extends Partial<CreateAssetDto> {}

// Liability types
export type LiabilityCategory =
  | 'subscriptions'
  | 'regular_expenses'
  | 'loans'
  | 'mortgage'
  | 'credit_card'
  | 'other';

export type LiabilityType = 'recurring' | 'one_time';

export interface Liability {
  id: string;
  userId: string;
  name: string;
  category: LiabilityCategory;
  liabilityType: LiabilityType;
  amount: number;
  currencyId: string;
  currency?: Currency;
  date: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLiabilityDto {
  name: string;
  category: LiabilityCategory;
  liabilityType: LiabilityType;
  amount: number;
  currencyId: string;
  date: string;
  description?: string;
}

export interface UpdateLiabilityDto extends Partial<CreateLiabilityDto> {}

// Crypto types
export type CryptoType = 'bitcoin' | 'ethereum' | 'solana' | 'bnb' | 'polygon' | 'avalanche';

export interface CryptoWallet {
  id: string;
  userId: string;
  type: CryptoType;
  address: string;
  balance: number;
  balanceUSD?: number;
  tokens?: CryptoToken[];
  lastUpdated?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CryptoToken {
  symbol: string;
  name: string;
  balance: number;
  balanceUSD: number;
  contractAddress: string;
}

export interface CreateCryptoWalletDto {
  type: CryptoType;
  address: string;
}

// Currency types
export type CurrencyType = 'fiat' | 'crypto' | 'stablecoin';

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: CurrencyType;
  exchangeRateToUSD?: number;
  isSystem?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
  contractAddress?: string;
}

// Metrics types
export interface Metrics {
  currency: string;
  netWorth: number;
  totalStockAssets: number;
  totalFlowIncome: number;
  totalActiveIncome: number;
  totalPassiveIncome: number;
  cryptoValue: number;
  totalLiabilities: number;
  monthlyExpenses: number;
  runway: number | null;
  flRatio: number | null;
  stockAssetDistribution: Record<string, number>;
  flowIncomeDistribution: Record<string, number>;
  liabilityDistribution: Record<string, number>;
}

export interface MetricsHistory {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

// API response types
export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}

// Async state type for managing loading/error states
export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };
