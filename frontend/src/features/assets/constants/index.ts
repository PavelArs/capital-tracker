import type { Currency } from '@shared/types';
import type { AssetFormData, CategoryOption } from '../types';

export const DEFAULT_CURRENCIES: Currency[] = [
  { id: '1', code: 'USD', name: 'US Dollar', symbol: '$', type: 'fiat', exchangeRateToUSD: 1, isSystem: true },
  { id: '2', code: 'EUR', name: 'Euro', symbol: '€', type: 'fiat', exchangeRateToUSD: 1.08, isSystem: true },
  { id: '3', code: 'RUB', name: 'Russian Ruble', symbol: '₽', type: 'fiat', exchangeRateToUSD: 0.011, isSystem: true },
  { id: '4', code: 'BTC', name: 'Bitcoin', symbol: '₿', type: 'crypto', exchangeRateToUSD: 60000, isSystem: true },
  { id: '5', code: 'ETH', name: 'Ethereum', symbol: 'Ξ', type: 'crypto', exchangeRateToUSD: 3000, isSystem: true },
  { id: '6', code: 'USDT', name: 'Tether', symbol: '₮', type: 'stablecoin', exchangeRateToUSD: 1, isSystem: true },
];

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const STOCK_CATEGORIES: CategoryOption[] = [
  { value: 'real_estate', labelKey: 'assets.categories.realEstate' },
  { value: 'investments', labelKey: 'assets.categories.investments' },
  { value: 'savings', labelKey: 'assets.categories.savings' },
  { value: 'crypto', labelKey: 'assets.categories.crypto' },
  { value: 'vehicle', labelKey: 'assets.categories.vehicle' },
  { value: 'equipment', labelKey: 'assets.categories.equipment' },
  { value: 'other', labelKey: 'assets.categories.other' },
];

export const FLOW_CATEGORIES: CategoryOption[] = [
  { value: 'salary', labelKey: 'assets.categories.salary' },
  { value: 'dividends', labelKey: 'assets.categories.dividends' },
  { value: 'freelance', labelKey: 'assets.categories.freelance' },
  { value: 'rent_income', labelKey: 'assets.categories.rentIncome' },
  { value: 'pension', labelKey: 'assets.categories.pension' },
  { value: 'other', labelKey: 'assets.categories.other' },
];

export const ACTIVE_INCOME_CATEGORIES = ['salary', 'freelance'];
export const PASSIVE_INCOME_CATEGORIES = ['dividends', 'rent_income', 'pension'];

export const CHART_COLORS = [
  '#FF6384',
  '#36A2EB',
  '#FFCE56',
  '#4BC0C0',
  '#9966FF',
  '#FF9F40',
  '#FF8A80',
  '#EA80FC',
  '#8C9EFF',
  '#82B1FF',
];

export const getInitialFormData = (currencyId: string): AssetFormData => ({
  name: '',
  assetType: 'stock',
  category: 'investments',
  incomeType: '',
  amount: '',
  currencyId,
  date: new Date().toISOString().split('T')[0],
  description: '',
});
