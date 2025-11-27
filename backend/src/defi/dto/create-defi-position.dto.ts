import { IsEnum, IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { DeFiPlatform, PositionType } from '../../entities/defi-position.entity';

export class CreateDeFiPositionDto {
  @IsEnum(DeFiPlatform)
  platform: DeFiPlatform;

  @IsEnum(PositionType)
  positionType: PositionType;

  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  positionData?: any;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsNumber()
  apy?: number;

  @IsOptional()
  @IsString()
  description?: string;
}
