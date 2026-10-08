import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AccountingModule } from './accounting/accounting.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssetsModule } from './assets/assets.module';
import { ApplicationThrottlerModule } from './auth/application-throttler.module';
import { AuthModule } from './auth/auth.module';
import { RedisCacheModule } from './cache/cache.module';
import { validateEnvironment } from './config/env.validation';
import { TypeOrmConfigService } from './config/typeorm.config';
import { CryptoModule } from './crypto/crypto.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { DisplayFxModule } from './display-fx/display-fx.module';
import { FxRatesModule } from './fx-rates/fx-rates.module';
import { HealthModule } from './health/health.module';
import { LiabilitiesModule } from './liabilities/liabilities.module';
import { MetricsModule } from './metrics/metrics.module';
import { OwnerExportModule } from './owner-export/owner-export.module';
import { OwnerSettingsModule } from './owner-settings/owner-settings.module';
import { PortfolioSnapshotsModule } from './portfolio-snapshots/portfolio-snapshots.module';
import { PricesModule } from './prices/prices.module';
import { GlobalExceptionFilter } from './shared/filters';
import { SyncStatusModule } from './sync-status/sync-status.module';
import { WalletAddressesModule } from './wallet-addresses/wallet-addresses.module';

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
    ApplicationThrottlerModule,
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
    DisplayFxModule,
    FxRatesModule,
    MetricsModule,
    OwnerExportModule,
    OwnerSettingsModule,
    HealthModule,
    PortfolioSnapshotsModule,
    PricesModule,
    SyncStatusModule,
    WalletAddressesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
