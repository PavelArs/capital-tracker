import {
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
  IsOptional,
  ValidateIf,
  IsUUID,
  IsPositive,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AssetCategory,
  AssetType,
  IncomeType,
} from "../../entities/asset.entity";

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
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @IsUUID()
  currencyId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  description?: string;
}
