import { useState, useCallback, useRef, useEffect } from 'react';
import { currenciesApi } from '@api';
import { CACHE_TTL } from '../constants';
import type { ExchangeRateCache } from '../types';

export function useCurrencyConversion() {
  const [exchangeRateCache, setExchangeRateCache] = useState<ExchangeRateCache>({});
  const exchangeRateCacheRef = useRef<ExchangeRateCache>({});
  const pendingRequestsRef = useRef<Record<string, Promise<number>>>({});

  // Sync ref with state for immediate access
  useEffect(() => {
    exchangeRateCacheRef.current = exchangeRateCache;
  }, [exchangeRateCache]);

  const clearCache = useCallback(() => {
    setExchangeRateCache({});
    exchangeRateCacheRef.current = {};
    pendingRequestsRef.current = {};
  }, []);

  const getExchangeRate = useCallback(
    async (fromCurrency: string, toCurrency: string): Promise<number> => {
      if (fromCurrency === toCurrency) return 1;

      const cacheKey = `${fromCurrency}-${toCurrency}`;
      const now = Date.now();
      const cached = exchangeRateCacheRef.current[cacheKey];

      if (cached && now - cached.timestamp < CACHE_TTL) {
        return cached.rate;
      }

      if (cacheKey in pendingRequestsRef.current) {
        return pendingRequestsRef.current[cacheKey];
      }

      const requestPromise = (async () => {
        try {
          // currenciesApi.convert returns the converted amount directly (number)
          // For 1 unit conversion, this equals the rate
          const rate = await currenciesApi.convert(1, fromCurrency, toCurrency);
          const cacheEntry = { rate, timestamp: Date.now() };
          exchangeRateCacheRef.current[cacheKey] = cacheEntry;
          setExchangeRateCache((prev) => ({ ...prev, [cacheKey]: cacheEntry }));
          return rate;
        } catch (error) {
          console.error(`Error fetching exchange rate ${fromCurrency}→${toCurrency}:`, error);
          if (cached) return cached.rate;
          return 1;
        } finally {
          delete pendingRequestsRef.current[cacheKey];
        }
      })();

      pendingRequestsRef.current[cacheKey] = requestPromise;
      return requestPromise;
    },
    []
  );

  const convertAmount = useCallback(
    async (amount: number, fromCurrency: string, toCurrency: string): Promise<number> => {
      if (fromCurrency === toCurrency) return amount;
      try {
        const rate = await getExchangeRate(fromCurrency, toCurrency);
        return amount * rate;
      } catch (error) {
        console.error('Error converting currency:', error);
        return amount;
      }
    },
    [getExchangeRate]
  );

  return { getExchangeRate, convertAmount, clearCache };
}
