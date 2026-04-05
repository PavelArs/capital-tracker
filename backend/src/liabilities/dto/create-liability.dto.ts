import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { LiabilityCategory, LiabilityFrequency } from '../../entities/liability.entity';

/**
 * DTO for creating a new liability
 */
export class CreateLiabilityDto {
  @ApiProperty({
    description: 'Liability name',
    example: 'Monthly Rent',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Liability category',
    enum: LiabilityCategory,
    example: LiabilityCategory.REGULAR_EXPENSES,
  })
  @IsEnum(LiabilityCategory)
  category: LiabilityCategory;

  @ApiProperty({
    description: 'Liability amount',
    example: 1500.0,
    minimum: 0,
  })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    description: 'Currency ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID()
  currencyId: string;

  @ApiProperty({
    description: 'Liability date (ISO 8601 format)',
    example: '2024-01-15',
    format: 'date',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description: 'Liability description',
    example: 'Monthly apartment rent payment',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Payment frequency for recurring liabilities',
    enum: LiabilityFrequency,
    example: LiabilityFrequency.MONTHLY,
  })
  @IsOptional()
  @IsEnum(LiabilityFrequency)
  frequency?: LiabilityFrequency | null;

  @ApiPropertyOptional({
    description: 'Payment deadline (ISO 8601 format)',
    example: '2024-12-31',
    format: 'date',
  })
  @IsOptional()
  @IsDateString()
  deadline?: string | null;
}
