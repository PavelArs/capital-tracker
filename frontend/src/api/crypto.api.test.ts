import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cryptoApi } from './crypto.api';
import apiClient from './client';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('cryptoApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should fetch all crypto wallets', async () => {
      const mockWallets = [
        { id: '1', address: '0x123', type: 'ethereum', balance: 2.5 },
        { id: '2', address: 'bc1xyz', type: 'bitcoin', balance: 0.5 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockWallets });

      const result = await cryptoApi.getAll();

      expect(apiClient.get).toHaveBeenCalledWith('/crypto');
      expect(result).toEqual(mockWallets);
    });

    it('should return empty array when no wallets', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

      const result = await cryptoApi.getAll();

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should fetch wallet by id', async () => {
      const mockWallet = { id: '1', address: '0x123', type: 'ethereum' };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockWallet });

      const result = await cryptoApi.getById('1');

      expect(apiClient.get).toHaveBeenCalledWith('/crypto/1');
      expect(result).toEqual(mockWallet);
    });
  });

  describe('create', () => {
    it('should create a new wallet', async () => {
      const newWallet = { address: '0xnew', type: 'ethereum' };
      const createdWallet = { id: '3', ...newWallet, balance: 0 };
      vi.mocked(apiClient.post).mockResolvedValue({ data: createdWallet });

      const result = await cryptoApi.create(newWallet as any);

      expect(apiClient.post).toHaveBeenCalledWith('/crypto', newWallet);
      expect(result).toEqual(createdWallet);
    });
  });

  describe('delete', () => {
    it('should delete a wallet', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined });

      await cryptoApi.delete('1');

      expect(apiClient.delete).toHaveBeenCalledWith('/crypto/1');
    });
  });

  describe('updateBalance', () => {
    it('should update wallet balance', async () => {
      const updatedWallet = { id: '1', balance: 3.0 };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: updatedWallet });

      const result = await cryptoApi.updateBalance('1');

      expect(apiClient.patch).toHaveBeenCalledWith('/crypto/1/update-balance');
      expect(result).toEqual(updatedWallet);
    });
  });

  describe('getPrices', () => {
    it('should fetch crypto prices', async () => {
      const mockPrices = {
        BTC: { usd: 50000 },
        ETH: { usd: 3000 },
        lastUpdated: '2024-01-15',
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockPrices });

      const result = await cryptoApi.getPrices();

      expect(apiClient.get).toHaveBeenCalledWith('/crypto/prices');
      expect(result).toEqual(mockPrices);
    });
  });

  describe('getTokenPrices', () => {
    it('should fetch token prices by contract addresses', async () => {
      const contractAddresses = ['0xtoken1', '0xtoken2'];
      const mockPrices = {
        '0xtoken1': 1.5,
        '0xtoken2': 2.3,
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockPrices });

      const result = await cryptoApi.getTokenPrices(contractAddresses);

      expect(apiClient.post).toHaveBeenCalledWith('/crypto/token-prices', {
        contractAddresses,
      });
      expect(result).toEqual(mockPrices);
    });
  });
});
