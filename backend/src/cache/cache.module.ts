import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { ExchangeRatesCacheService } from './exchange-rates-cache.service';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);

        return {
          store: await redisStore({
            socket: {
              host: redisHost,
              port: redisPort,
            },
            ttl: 600000, // Default 10 minutes TTL
          }),
        };
      },
    }),
  ],
  providers: [ExchangeRatesCacheService],
  exports: [CacheModule, ExchangeRatesCacheService],
})
export class RedisCacheModule {}
