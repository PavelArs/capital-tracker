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
import { RecommendationType } from '../../entities/ai-recommendation.entity';

export class CreateAiRecommendationDto {
  @IsEnum(RecommendationType, { message: 'Invalid recommendation type' })
  type!: RecommendationType;

  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title must not exceed 255 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  title!: string;

  @IsString({ message: 'Description must be a string' })
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  description!: string;

  @IsOptional()
  @IsObject({ message: 'Data must be an object' })
  data?: Record<string, unknown>;

  @IsOptional()
  @IsNumber({}, { message: 'Priority must be a number' })
  @Min(1, { message: 'Priority must be at least 1' })
  @Max(10, { message: 'Priority must not exceed 10' })
  priority?: number;
}
