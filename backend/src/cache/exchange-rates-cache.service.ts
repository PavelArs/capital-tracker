import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

// Only the Redis health check is used (health indicator and metrics); nothing caches rates here.
@Injectable()
export class ExchangeRatesCacheService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectPinoLogger(ExchangeRatesCacheService.name)
    private readonly logger: PinoLogger,
  ) {}

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
}
