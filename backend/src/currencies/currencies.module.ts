import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../crypto/crypto.module';
import { UserCurrencyPreference } from '../entities/UserCurrencyPreference.entity';
import { Currency } from '../entities/currency.entity';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { CurrencyUpdateService } from './currency-update.service';

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
