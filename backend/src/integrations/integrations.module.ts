import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { BrokerIntegration } from '../entities/broker-integration.entity';
import { BankIntegration } from '../entities/bank-integration.entity';
import { User } from '../entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrokerIntegration, BankIntegration, User]),
    SubscriptionsModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

