import {
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
  IsOptional,
  ValidateIf,
  IsUUID,
  IsPositive,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetCategory, AssetType, IncomeType } from '../../entities/asset.entity';

/**
 * DTO for creating a new asset
 */
export class CreateAssetDto {
  @ApiProperty({
    description: 'Asset name',
    example: 'Company Stock Portfolio',
    maxLength: 255,
  })
  @IsString({ message: 'Name must be a string' })
  @MaxLength(255, { message: 'Name must not exceed 255 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  name!: string;

  @ApiProperty({
    description: 'Type of asset (stock for balance sheet items, flow for income)',
    enum: AssetType,
    example: AssetType.STOCK,
  })
  @IsEnum(AssetType, { message: 'Invalid asset type' })
  assetType!: AssetType;

  @ApiProperty({
    description: 'Asset category',
    enum: AssetCategory,
    example: AssetCategory.INVESTMENTS,
  })
  @IsEnum(AssetCategory, { message: 'Invalid asset category' })
  category!: AssetCategory;

  @ApiPropertyOptional({
    description: 'Income type (required for flow assets)',
    enum: IncomeType,
    example: IncomeType.PASSIVE,
  })
  @ValidateIf((o: CreateAssetDto) => o.assetType === AssetType.FLOW)
  @IsEnum(IncomeType, { message: 'Invalid income type' })
  @IsOptional()
  incomeType?: IncomeType;

  @ApiProperty({
    description: 'Asset amount/value',
    example: 10000.5,
    minimum: 0,
  })
  @IsNumber({}, { message: 'Amount must be a number' })
  @IsPositive({ message: 'Amount must be positive' })
  @Type(() => Number)
  amount!: number;

  @ApiProperty({
    description: 'Currency ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Currency ID must be a valid UUID' })
  currencyId!: string;

  @ApiProperty({
    description: 'Asset date (ISO 8601 format)',
    example: '2024-01-15',
    format: 'date',
  })
  @IsDateString({}, { message: 'Date must be a valid date string' })
  date!: string;

  @ApiPropertyOptional({
    description: 'Asset description',
    example: 'Monthly dividend from tech stocks',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @MaxLength(1000, { message: 'Description must not exceed 1000 characters' })
  @Transform(({ value }: { value: string | undefined }) => value?.trim())
  description?: string;
}
