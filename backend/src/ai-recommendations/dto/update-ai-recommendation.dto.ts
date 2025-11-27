import { PartialType } from '@nestjs/mapped-types';
import { CreateAiRecommendationDto } from './create-ai-recommendation.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { RecommendationStatus } from '../../entities/ai-recommendation.entity';

export class UpdateAiRecommendationDto extends PartialType(CreateAiRecommendationDto) {
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;
}
