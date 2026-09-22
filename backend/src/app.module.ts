import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import { LoggerModule } from 'nestjs-pino';
import { AccountingModule } from './accounting/accounting.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { AuthClientSourceService } from './auth/client-source';
import { AuthClientSourceModule } from './auth/client-source.module';
import { RedisCacheModule } from './cache/cache.module';
import { validateEnvironment } from './config/env.validation';
import { TypeOrmConfigService } from './config/typeorm.config';
import { CryptoModule } from './crypto/crypto.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { HealthModule } from './health/health.module';
import { LiabilitiesModule } from './liabilities/liabilities.module';
import { MetricsModule } from './metrics/metrics.module';
import { GlobalExceptionFilter } from './shared/filters';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      cache: true,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                  },
                },
            level: isProduction ? 'info' : 'debug',
            serializers: {
              // Never serialize query parameters or arbitrary request headers.
              req: (req: {
                id?: string;
                method?: string;
                url?: string;
                remoteAddress?: string;
              }) => ({
                id: req.id,
                method: req.method,
                url: req.url?.split('?')[0],
                remoteAddress: req.remoteAddress,
              }),
            },
            autoLogging: {
              ignore: (req: { url?: string }) => req.url === '/health',
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.headers["x-csrf-token"]',
                'req.body.password',
                'req.body.newPassword',
              ],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [AuthClientSourceModule],
      inject: [AuthClientSourceService],
      useFactory: (sources: AuthClientSourceService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        getTracker: (request, context) => sources.tracker(request as Request, context),
      }),
    }),
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
    }),
    ScheduleModule.forRoot({ cronJobs: process.env.BACKGROUND_JOBS_ENABLED !== 'false' }),
    RedisCacheModule,
    AuthModule,
    AccountingModule,
    AssetsModule,
    LiabilitiesModule,
    CryptoModule,
    CurrenciesModule,
    MetricsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
