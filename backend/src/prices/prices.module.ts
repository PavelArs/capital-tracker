import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BybitMarketClient } from './bybit-market';
import { CoinGeckoClient, KrakenClient } from './price-providers';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

@Module({
  controllers: [PricesController],
  providers: [
    PricesService,
    { provide: KrakenClient, useFactory: () => new KrakenClient() },
    { provide: BybitMarketClient, useFactory: () => new BybitMarketClient() },
    {
      provide: CoinGeckoClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CoinGeckoClient({ demoKey: config.get<string>('COINGECKO_DEMO_API_KEY') || undefined }),
    },
  ],
})
export class PricesModule {}
