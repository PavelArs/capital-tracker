import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

export interface CachedExchangeRates {
  rates: Record<string, number>;
  baseCurrency: string;
  cachedAt: number;
}

export const EXCHANGE_RATES_CACHE_KEY_PREFIX = 'exchange_rates';
export const CRYPTO_RATES_CACHE_KEY = 'crypto_rates';
export const DEFAULT_CACHE_TTL = 600000; // 10 minutes in milliseconds

@Injectable()
export class ExchangeRatesCacheService {
  private readonly cacheTtl: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectPinoLogger(ExchangeRatesCacheService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    this.cacheTtl = this.configService.get<number>('EXCHANGE_RATES_CACHE_TTL', DEFAULT_CACHE_TTL);
  }

  /**
   * Get cached exchange rates for a specific base currency
   */
  async getExchangeRates(baseCurrency: string): Promise<CachedExchangeRates | null> {
    const cacheKey = this.buildCacheKey(baseCurrency);

    try {
      const cached = await this.cacheManager.get<CachedExchangeRates>(cacheKey);

      if (cached) {
        this.logger.debug(
          { baseCurrency, cacheKey, cachedAt: cached.cachedAt },
          'Exchange rates cache hit',
        );
        return cached;
      }

      this.logger.debug({ baseCurrency, cacheKey }, 'Exchange rates cache miss');
      return null;
    } catch (error) {
      this.logger.error(
        { error: error.message, baseCurrency, cacheKey },
        'Failed to get exchange rates from cache',
      );
      return null;
    }
  }

  /**
   * Cache exchange rates for a specific base currency
   */
  async setExchangeRates(baseCurrency: string, rates: Record<string, number>): Promise<void> {
    const cacheKey = this.buildCacheKey(baseCurrency);

    const cacheData: CachedExchangeRates = {
      rates,
      baseCurrency,
      cachedAt: Date.now(),
    };

    try {
      await this.cacheManager.set(cacheKey, cacheData, this.cacheTtl);

      this.logger.info(
        { baseCurrency, cacheKey, ttl: this.cacheTtl, ratesCount: Object.keys(rates).length },
        'Exchange rates cached successfully',
      );
    } catch (error) {
      this.logger.error(
        { error: error.message, baseCurrency, cacheKey },
        'Failed to cache exchange rates',
      );
    }
  }

  /**
   * Get cached crypto rates
   */
  async getCryptoRates(): Promise<Record<string, number> | null> {
    try {
      const cached = await this.cacheManager.get<Record<string, number>>(CRYPTO_RATES_CACHE_KEY);

      if (cached) {
        this.logger.debug({ cacheKey: CRYPTO_RATES_CACHE_KEY }, 'Crypto rates cache hit');
        return cached;
      }

      this.logger.debug({ cacheKey: CRYPTO_RATES_CACHE_KEY }, 'Crypto rates cache miss');
      return null;
    } catch (error) {
      this.logger.error(
        { error: error.message, cacheKey: CRYPTO_RATES_CACHE_KEY },
        'Failed to get crypto rates from cache',
      );
      return null;
    }
  }

  /**
   * Cache crypto rates
   */
  async setCryptoRates(rates: Record<string, number>): Promise<void> {
    try {
      await this.cacheManager.set(CRYPTO_RATES_CACHE_KEY, rates, this.cacheTtl);

      this.logger.info(
        {
          cacheKey: CRYPTO_RATES_CACHE_KEY,
          ttl: this.cacheTtl,
          ratesCount: Object.keys(rates).length,
        },
        'Crypto rates cached successfully',
      );
    } catch (error) {
      this.logger.error(
        { error: error.message, cacheKey: CRYPTO_RATES_CACHE_KEY },
        'Failed to cache crypto rates',
      );
    }
  }

  /**
   * Invalidate all exchange rates cache
   */
  async invalidateAll(): Promise<void> {
    try {
      // Delete specific known keys
      await this.cacheManager.del(this.buildCacheKey('USD'));
      await this.cacheManager.del(CRYPTO_RATES_CACHE_KEY);

      this.logger.info('Exchange rates cache invalidated');
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to invalidate exchange rates cache');
    }
  }

  /**
   * Check if cache is available and working
   */
  async isHealthy(): Promise<boolean> {
    const testKey = 'health_check_test';

    try {
      await this.cacheManager.set(testKey, 'ok', 5000);
      const result = await this.cacheManager.get(testKey);
      await this.cacheManager.del(testKey);

      return result === 'ok';
    } catch (error) {
      this.logger.error({ error: error.message }, 'Cache health check failed');
      return false;
    }
  }

  /**
   * Get cache TTL in milliseconds
   */
  getCacheTtl(): number {
    return this.cacheTtl;
  }

  private buildCacheKey(baseCurrency: string): string {
    return `${EXCHANGE_RATES_CACHE_KEY_PREFIX}:${baseCurrency.toUpperCase()}`;
  }
}
