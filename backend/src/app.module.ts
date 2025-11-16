import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AssetsModule } from './assets/assets.module';
import { LiabilitiesModule } from './liabilities/liabilities.module';
import { CryptoModule } from './crypto/crypto.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { MetricsModule } from './metrics/metrics.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { DefiModule } from './defi/defi.module';
import { AiRecommendationsModule } from './ai-recommendations/ai-recommendations.module';
import { CapitalsModule } from './capitals/capitals.module';
import { ReportsModule } from './reports/reports.module';
import { TypeOrmConfigService } from './config/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    AssetsModule,
    LiabilitiesModule,
    CryptoModule,
    CurrenciesModule,
    MetricsModule,
    SubscriptionsModule,
    IntegrationsModule,
    DefiModule,
    AiRecommendationsModule,
    CapitalsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

