import { PartialType } from '@nestjs/swagger';
import { CreateAiRecommendationDto } from './create-ai-recommendation.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RecommendationStatus } from '../../entities/ai-recommendation.entity';

/**
 * DTO for updating an existing AI recommendation
 */
export class UpdateAiRecommendationDto extends PartialType(CreateAiRecommendationDto) {
  @ApiPropertyOptional({
    description: 'Recommendation status',
    enum: RecommendationStatus,
    example: RecommendationStatus.ACCEPTED,
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;
}
