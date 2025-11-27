import { describe, it, expect, vi, beforeEach } from 'vitest';
import { metricsApi } from './metrics.api';
import apiClient from './client';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('metricsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should fetch metrics with default currency', async () => {
      const mockMetrics = {
        netWorth: 100000,
        totalAssets: 150000,
        totalLiabilities: 50000,
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMetrics });

      const result = await metricsApi.get();

      expect(apiClient.get).toHaveBeenCalledWith('/metrics', { params: { currency: 'USD' } });
      expect(result).toEqual(mockMetrics);
    });

    it('should fetch metrics with custom currency', async () => {
      const mockMetrics = { netWorth: 92000 };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMetrics });

      const result = await metricsApi.get('EUR');

      expect(apiClient.get).toHaveBeenCalledWith('/metrics', { params: { currency: 'EUR' } });
      expect(result).toEqual(mockMetrics);
    });
  });

  describe('getMetrics', () => {
    it('should fetch metrics (alias for get)', async () => {
      const mockMetrics = { netWorth: 100000 };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMetrics });

      const result = await metricsApi.getMetrics();

      expect(apiClient.get).toHaveBeenCalledWith('/metrics', { params: { currency: 'USD' } });
      expect(result).toEqual(mockMetrics);
    });

    it('should fetch metrics with custom currency', async () => {
      const mockMetrics = { netWorth: 7500000 };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMetrics });

      const result = await metricsApi.getMetrics('RUB');

      expect(apiClient.get).toHaveBeenCalledWith('/metrics', { params: { currency: 'RUB' } });
      expect(result).toEqual(mockMetrics);
    });
  });

  describe('getHistory', () => {
    it('should fetch metrics history with default params', async () => {
      const mockHistory = [
        { date: '2024-01-15', netWorth: 100000 },
        { date: '2024-01-14', netWorth: 99000 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockHistory });

      const result = await metricsApi.getHistory();

      expect(apiClient.get).toHaveBeenCalledWith('/metrics/history', {
        params: { currency: 'USD', days: 30 },
      });
      expect(result).toEqual(mockHistory);
    });

    it('should fetch metrics history with custom params', async () => {
      const mockHistory = [{ date: '2024-01-15', netWorth: 92000 }];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockHistory });

      const result = await metricsApi.getHistory('EUR', 7);

      expect(apiClient.get).toHaveBeenCalledWith('/metrics/history', {
        params: { currency: 'EUR', days: 7 },
      });
      expect(result).toEqual(mockHistory);
    });
  });
});
