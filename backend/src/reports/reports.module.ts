import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report } from '../entities/report.entity';
import { User } from '../entities/user.entity';
import { Asset } from '../entities/asset.entity';
import { Liability } from '../entities/liability.entity';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, User, Asset, Liability, CryptoWallet]),
    SubscriptionsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

