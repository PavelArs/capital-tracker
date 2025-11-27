import { describe, it, expect, vi, beforeEach } from 'vitest';
import { currenciesApi } from './currencies.api';
import apiClient from './client';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('currenciesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should fetch all currencies', async () => {
      const mockCurrencies = [
        { id: '1', code: 'USD', name: 'US Dollar' },
        { id: '2', code: 'EUR', name: 'Euro' },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockCurrencies });

      const result = await currenciesApi.getAll();

      expect(apiClient.get).toHaveBeenCalledWith('/currencies');
      expect(result).toEqual(mockCurrencies);
    });
  });

  describe('getList', () => {
    it('should fetch currencies list', async () => {
      const mockCurrencies = [{ id: '1', code: 'USD' }];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockCurrencies });

      const result = await currenciesApi.getList();

      expect(apiClient.get).toHaveBeenCalledWith('/currencies/list');
      expect(result).toEqual(mockCurrencies);
    });
  });

  describe('getExchangeRates', () => {
    it('should fetch exchange rates with default base currency', async () => {
      const mockRates = { base: 'USD', rates: { EUR: 0.92 }, lastUpdated: '2024-01-15' };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockRates });

      const result = await currenciesApi.getExchangeRates();

      expect(apiClient.get).toHaveBeenCalledWith('/currencies/rates', { params: { base: 'USD' } });
      expect(result).toEqual(mockRates);
    });

    it('should fetch exchange rates with custom base currency', async () => {
      const mockRates = { base: 'EUR', rates: { USD: 1.09 }, lastUpdated: '2024-01-15' };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockRates });

      const result = await currenciesApi.getExchangeRates('EUR');

      expect(apiClient.get).toHaveBeenCalledWith('/currencies/rates', { params: { base: 'EUR' } });
      expect(result).toEqual(mockRates);
    });
  });

  describe('convert', () => {
    it('should convert amount and return number when API returns number', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: 92 });

      const result = await currenciesApi.convert(100, 'USD', 'EUR');

      expect(apiClient.get).toHaveBeenCalledWith('/currencies/convert', {
        params: { amount: 100, from: 'USD', to: 'EUR' },
      });
      expect(result).toBe(92);
    });

    it('should convert amount and return result when API returns ConversionResult', async () => {
      const conversionResult = {
        from: 'USD',
        to: 'EUR',
        amount: 100,
        result: 92,
        rate: 0.92,
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: conversionResult });

      const result = await currenciesApi.convert(100, 'USD', 'EUR');

      expect(result).toBe(92);
    });
  });

  describe('getHidden', () => {
    it('should fetch hidden currencies', async () => {
      const mockHidden = [{ id: '1', code: 'RUB' }];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockHidden });

      const result = await currenciesApi.getHidden();

      expect(apiClient.get).toHaveBeenCalledWith('/currencies/hidden');
      expect(result).toEqual(mockHidden);
    });
  });

  describe('hide', () => {
    it('should hide a currency', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { message: 'Currency hidden' } });

      const result = await currenciesApi.hide('currency-1');

      expect(apiClient.post).toHaveBeenCalledWith('/currencies/hide', { currencyId: 'currency-1' });
      expect(result).toEqual({ message: 'Currency hidden' });
    });
  });

  describe('show', () => {
    it('should show a hidden currency', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { message: 'Currency shown' } });

      const result = await currenciesApi.show('currency-1');

      expect(apiClient.post).toHaveBeenCalledWith('/currencies/show', { currencyId: 'currency-1' });
      expect(result).toEqual({ message: 'Currency shown' });
    });
  });

  describe('toggle', () => {
    it('should toggle currency visibility', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { message: 'Currency toggled' } });

      const result = await currenciesApi.toggle('currency-1', true);

      expect(apiClient.post).toHaveBeenCalledWith('/currencies/toggle', {
        currencyId: 'currency-1',
        isHidden: true,
      });
      expect(result).toEqual({ message: 'Currency toggled' });
    });
  });
});

