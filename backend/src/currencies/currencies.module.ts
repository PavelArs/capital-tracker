import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { CurrencyUpdateService } from './currency-update.service';
import { Currency } from '../entities/currency.entity';
import { UserCurrencyPreference } from '../entities/UserCurrencyPreference.entity';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Currency, UserCurrencyPreference]),
    forwardRef(() => CryptoModule),
  ],
  controllers: [CurrenciesController],
  providers: [CurrenciesService, CurrencyUpdateService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
