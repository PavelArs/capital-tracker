import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { AssetsModule } from "./assets/assets.module";
import { LiabilitiesModule } from "./liabilities/liabilities.module";
import { CryptoModule } from "./crypto/crypto.module";
import { CurrenciesModule } from "./currencies/currencies.module";
import { MetricsModule } from "./metrics/metrics.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { DefiModule } from "./defi/defi.module";
import { AiRecommendationsModule } from "./ai-recommendations/ai-recommendations.module";
import { CapitalsModule } from "./capitals/capitals.module";
import { ReportsModule } from "./reports/reports.module";
import { HealthModule } from "./health/health.module";
import { TypeOrmConfigService } from "./config/typeorm.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get("NODE_ENV") === "production";
        return {
          pinoHttp: {
            transport: isProduction
              ? undefined
              : {
                  target: "pino-pretty",
                  options: {
                    singleLine: true,
                  },
                },
            level: isProduction ? "info" : "debug",
          },
        };
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),
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
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
