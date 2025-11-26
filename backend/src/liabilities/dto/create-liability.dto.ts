import {
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
  IsOptional,
  IsUUID,
  IsPositive,
} from "class-validator";
import { Type } from "class-transformer";
import {
  LiabilityCategory,
  LiabilityFrequency,
} from "../../entities/liability.entity";

export class CreateLiabilityDto {
  @IsString()
  name: string;

  @IsEnum(LiabilityCategory)
  category: LiabilityCategory;

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

  @IsOptional()
  @IsEnum(LiabilityFrequency)
  frequency?: LiabilityFrequency | null;

  @IsOptional()
  @IsDateString()
  deadline?: string | null;
}
