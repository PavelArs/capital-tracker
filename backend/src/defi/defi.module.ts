import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefiController } from './defi.controller';
import { DefiService } from './defi.service';
import { DeFiPosition } from '../entities/defi-position.entity';
import { User } from '../entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeFiPosition, User]), SubscriptionsModule],
  controllers: [DefiController],
  providers: [DefiService],
  exports: [DefiService],
})
export class DefiModule {}
