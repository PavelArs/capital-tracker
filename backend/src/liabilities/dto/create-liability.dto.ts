import { IsString, IsEnum, IsNumber, IsDateString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { LiabilityCategory, LiabilityFrequency } from '../../entities/liability.entity';

export class CreateLiabilityDto {
  @IsString()
  name: string;

  @IsEnum(LiabilityCategory)
  category: LiabilityCategory;

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

  @IsOptional()
  @IsEnum(LiabilityFrequency)
  frequency?: LiabilityFrequency | null;

  @IsOptional()
  @IsDateString()
  deadline?: string | null;
}

