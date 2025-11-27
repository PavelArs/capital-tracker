import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CapitalsController } from './capitals.controller';
import { CapitalsService } from './capitals.service';
import { Capital } from '../entities/capital.entity';
import { User } from '../entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [TypeOrmModule.forFeature([Capital, User]), SubscriptionsModule],
  controllers: [CapitalsController],
  providers: [CapitalsService],
  exports: [CapitalsService],
})
export class CapitalsModule {}
