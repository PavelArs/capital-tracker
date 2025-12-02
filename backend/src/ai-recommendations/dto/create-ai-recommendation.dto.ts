import {
  IsEnum,
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecommendationType } from '../../entities/ai-recommendation.entity';

/**
 * DTO for creating a new AI recommendation
 */
export class CreateAiRecommendationDto {
  @ApiProperty({
    description: 'Recommendation type',
    enum: RecommendationType,
    example: RecommendationType.DIVERSIFICATION,
  })
  @IsEnum(RecommendationType, { message: 'Invalid recommendation type' })
  type!: RecommendationType;

  @ApiProperty({
    description: 'Recommendation title',
    example: 'Diversify your portfolio with international stocks',
    maxLength: 255,
  })
  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title must not exceed 255 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  title!: string;

  @ApiProperty({
    description: 'Detailed recommendation description',
    example:
      'Your portfolio is heavily concentrated in US tech stocks. Consider adding international exposure to reduce risk.',
    maxLength: 2000,
  })
  @IsString({ message: 'Description must be a string' })
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  description!: string;

  @ApiPropertyOptional({
    description: 'Additional structured data for the recommendation',
    example: { suggestedAllocation: 0.15, assetClasses: ['international_stocks'] },
  })
  @IsOptional()
  @IsObject({ message: 'Data must be an object' })
  data?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Priority score (1-10, higher is more important)',
    example: 7,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Priority must be a number' })
  @Min(1, { message: 'Priority must be at least 1' })
  @Max(10, { message: 'Priority must not exceed 10' })
  priority?: number;
}
