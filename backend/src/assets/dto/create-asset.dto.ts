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
import { AssetCategory, AssetType, IncomeType } from '../../entities/asset.entity';

export class CreateAssetDto {
  @IsString({ message: 'Name must be a string' })
  @MaxLength(255, { message: 'Name must not exceed 255 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  name!: string;

  @IsEnum(AssetType, { message: 'Invalid asset type' })
  assetType!: AssetType;

  @IsEnum(AssetCategory, { message: 'Invalid asset category' })
  category!: AssetCategory;

  @ValidateIf((o: CreateAssetDto) => o.assetType === AssetType.FLOW)
  @IsEnum(IncomeType, { message: 'Invalid income type' })
  @IsOptional()
  incomeType?: IncomeType;

  @IsNumber({}, { message: 'Amount must be a number' })
  @IsPositive({ message: 'Amount must be positive' })
  @Type(() => Number)
  amount!: number;

  @IsUUID('4', { message: 'Currency ID must be a valid UUID' })
  currencyId!: string;

  @IsDateString({}, { message: 'Date must be a valid date string' })
  date!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @MaxLength(1000, { message: 'Description must not exceed 1000 characters' })
  @Transform(({ value }: { value: string | undefined }) => value?.trim())
  description?: string;
}
