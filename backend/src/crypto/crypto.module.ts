import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrenciesModule } from '../currencies/currencies.module';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
import { CryptoPricesService } from './crypto-prices.service';
import { CryptoUpdateService } from './crypto-update.service';

@Module({
  imports: [TypeOrmModule.forFeature([CryptoWallet]), CurrenciesModule],
  controllers: [CryptoController],
  providers: [CryptoService, CryptoUpdateService, CryptoPricesService],
  exports: [CryptoService, CryptoUpdateService, CryptoPricesService],
})
export class CryptoModule {}
