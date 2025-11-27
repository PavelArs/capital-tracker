import type { Currency } from '@shared/types';
import type { LiabilityFormData, CategoryOption } from '../types';

export const DEFAULT_CURRENCIES: Currency[] = [
  { id: '1', code: 'USD', name: 'US Dollar', symbol: '$', type: 'fiat', exchangeRateToUSD: 1, isSystem: true },
  { id: '2', code: 'EUR', name: 'Euro', symbol: '€', type: 'fiat', exchangeRateToUSD: 1.08, isSystem: true },
  { id: '3', code: 'RUB', name: 'Russian Ruble', symbol: '₽', type: 'fiat', exchangeRateToUSD: 0.011, isSystem: true },
  { id: '4', code: 'BTC', name: 'Bitcoin', symbol: '₿', type: 'crypto', exchangeRateToUSD: 60000, isSystem: true },
  { id: '5', code: 'ETH', name: 'Ethereum', symbol: 'Ξ', type: 'crypto', exchangeRateToUSD: 3000, isSystem: true },
  { id: '6', code: 'USDT', name: 'Tether', symbol: '₮', type: 'stablecoin', exchangeRateToUSD: 1, isSystem: true },
];

export const LIABILITY_CATEGORIES: CategoryOption[] = [
  { value: 'subscriptions', labelKey: 'liabilities.categories.subscriptions' },
  { value: 'regular_expenses', labelKey: 'liabilities.categories.regularExpenses' },
  { value: 'loans', labelKey: 'liabilities.categories.loans' },
  { value: 'mortgage', labelKey: 'liabilities.categories.mortgage' },
  { value: 'credit_card', labelKey: 'liabilities.categories.creditCard' },
  { value: 'other', labelKey: 'liabilities.categories.other' },
];

export const REGULAR_CATEGORIES = ['subscriptions', 'regular_expenses'];
export const NON_REGULAR_CATEGORIES = ['loans', 'mortgage', 'credit_card', 'other'];

export const FREQUENCY_OPTIONS: CategoryOption[] = [
  { value: 'daily', labelKey: 'liabilities.frequencies.daily' },
  { value: 'weekly', labelKey: 'liabilities.frequencies.weekly' },
  { value: 'monthly', labelKey: 'liabilities.frequencies.monthly' },
  { value: 'quarterly', labelKey: 'liabilities.frequencies.quarterly' },
  { value: 'yearly', labelKey: 'liabilities.frequencies.yearly' },
];

export const CHART_COLORS = [
  '#FF6384',
  '#36A2EB',
  '#FFCE56',
  '#4BC0C0',
  '#9966FF',
  '#FF9F40',
];

export const getInitialFormData = (currencyId: string): LiabilityFormData => ({
  name: '',
  category: 'subscriptions',
  amount: '',
  currencyId,
  date: new Date().toISOString().split('T')[0],
  description: '',
  frequency: 'monthly',
  deadline: '',
});

