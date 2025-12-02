import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ExchangeRatesCacheService } from '../cache/exchange-rates-cache.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly cacheService: ExchangeRatesCacheService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const isHealthy = await this.cacheService.isHealthy();

      if (!isHealthy) {
        return indicator.down({ message: 'Redis connection failed' });
      }

      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error.message });
    }
  }
}
