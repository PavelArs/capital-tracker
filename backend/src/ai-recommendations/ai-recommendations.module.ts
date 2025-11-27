import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiRecommendationsController } from './ai-recommendations.controller';
import { AiRecommendationsService } from './ai-recommendations.service';
import { AiRecommendation } from '../entities/ai-recommendation.entity';
import { User } from '../entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [TypeOrmModule.forFeature([AiRecommendation, User]), SubscriptionsModule],
  controllers: [AiRecommendationsController],
  providers: [AiRecommendationsService],
  exports: [AiRecommendationsService],
})
export class AiRecommendationsModule {}
