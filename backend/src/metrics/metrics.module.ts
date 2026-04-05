import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../crypto/crypto.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { Asset } from '../entities/asset.entity';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { Liability } from '../entities/liability.entity';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

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
