import { IsEnum, IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { RecommendationType } from '../../entities/ai-recommendation.entity';

export class CreateAiRecommendationDto {
  @IsEnum(RecommendationType)
  type: RecommendationType;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsObject()
  data?: any;

  @IsOptional()
  @IsNumber()
  priority?: number;
}

