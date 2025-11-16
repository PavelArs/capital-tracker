import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { BankType } from '../../entities/bank-integration.entity';

export class CreateBankIntegrationDto {
  @IsEnum(BankType)
  bankType: BankType;

  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  credentials?: any;

  @IsOptional()
  @IsObject()
  config?: any;
}

