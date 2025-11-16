import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { CryptoUpdateService } from './crypto-update.service';
import { CryptoPricesService } from './crypto-prices.service';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CryptoWallet]),
    CurrenciesModule,
    SubscriptionsModule,
  ],
  controllers: [CryptoController],
  providers: [CryptoService, CryptoUpdateService, CryptoPricesService],
  exports: [CryptoService, CryptoUpdateService, CryptoPricesService],
})
export class CryptoModule {}

