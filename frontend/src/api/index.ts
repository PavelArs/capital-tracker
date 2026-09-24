// API client and utilities
export { default as api, default as apiClient, setErrorHandler } from './client';

// API modules
export { authApi } from './auth.api';
export { assetsApi } from './assets.api';
export { cryptoApi } from './crypto.api';
export { metricsApi } from './metrics.api';
export { currenciesApi } from './currencies.api';

// Re-export types from API modules
export type { ConversionResult } from './currencies.api';
export type { CryptoPrices, TokenPrices } from './crypto.api';
