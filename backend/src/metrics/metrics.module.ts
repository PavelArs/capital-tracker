import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { Asset } from '../entities/asset.entity';
import { Liability } from '../entities/liability.entity';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { CurrenciesModule } from '../currencies/currencies.module';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, Liability, CryptoWallet]),
    CurrenciesModule,
    CryptoModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}

