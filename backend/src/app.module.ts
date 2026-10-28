import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AccountingModule } from './accounting/accounting.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApplicationThrottlerModule } from './auth/application-throttler.module';
import { AuthModule } from './auth/auth.module';
import { BrokersModule } from './brokers/brokers.module';
import { validateEnvironment } from './config/env.validation';
import { TypeOrmConfigService } from './config/typeorm.config';
import { DepositsModule } from './deposits/deposits.module';
import { FxRatesModule } from './fx-rates/fx-rates.module';
import { GoalsModule } from './goals/goals.module';
import { HealthModule } from './health/health.module';
import { InflationModule } from './inflation/inflation.module';
import { pinoHttpOptions } from './observability/logging';
import { ObservabilityModule } from './observability/observability.module';
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
          pinoHttp: pinoHttpOptions(isProduction),
        };
      },
    }),
    ApplicationThrottlerModule,
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
    }),
    ScheduleModule.forRoot({ cronJobs: process.env.BACKGROUND_JOBS_ENABLED !== 'false' }),
    AuthModule,
    AccountingModule,
    BrokersModule,
    DepositsModule,
    FxRatesModule,
    GoalsModule,
    InflationModule,
    OwnerExportModule,
    OwnerSettingsModule,
    HealthModule,
    ObservabilityModule,
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
