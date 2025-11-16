import {
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
  IsOptional,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";
import { AssetCategory, AssetType, IncomeType } from "../../entities/asset.entity";

export class CreateAssetDto {
  @IsString()
  name: string;

  @IsEnum(AssetType)
  assetType: AssetType;

  @IsEnum(AssetCategory)
  category: AssetCategory;

  @ValidateIf((o) => o.assetType === AssetType.FLOW)
  @IsEnum(IncomeType)
  @IsOptional()
  incomeType?: IncomeType; // Обязательно для FLOW активов

  @IsNumber()
  @Type(() => Number)
  amount: number;

  @IsString()
  currency: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  description?: string;
}
