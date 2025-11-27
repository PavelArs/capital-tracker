import apiClient from './client';
import type { CryptoWallet, CreateCryptoWalletDto } from '@shared/types';

export interface CryptoPrices {
  BTC: { usd: number } | number;
  ETH: { usd: number } | number;
  SOL?: { usd: number } | number;
  BNB?: { usd: number } | number;
  MATIC?: { usd: number } | number;
  AVAX?: { usd: number } | number;
  lastUpdated?: string;
}

export interface TokenPrices {
  [contractAddress: string]: number;
}

export const cryptoApi = {
  getAll: async (): Promise<CryptoWallet[]> => {
    const response = await apiClient.get<CryptoWallet[]>('/crypto');
    return response.data;
  },

  getById: async (id: string): Promise<CryptoWallet> => {
    const response = await apiClient.get<CryptoWallet>(`/crypto/${id}`);
    return response.data;
  },

  create: async (data: CreateCryptoWalletDto): Promise<CryptoWallet> => {
    const response = await apiClient.post<CryptoWallet>('/crypto', data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/crypto/${id}`);
  },

  updateBalance: async (id: string): Promise<CryptoWallet> => {
    const response = await apiClient.patch<CryptoWallet>(`/crypto/${id}/update-balance`);
    return response.data;
  },

  getPrices: async (): Promise<CryptoPrices> => {
    const response = await apiClient.get<CryptoPrices>('/crypto/prices');
    return response.data;
  },

  getTokenPrices: async (contractAddresses: string[]): Promise<TokenPrices> => {
    const response = await apiClient.post<TokenPrices>('/crypto/token-prices', {
      contractAddresses,
    });
    return response.data;
  },
};
