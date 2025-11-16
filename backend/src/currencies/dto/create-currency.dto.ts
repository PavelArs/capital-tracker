import { IsString, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { CurrencyType } from '../../entities/currency.entity';

export class CreateCurrencyDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  symbol: string;

  @IsEnum(CurrencyType)
  @IsOptional()
  type?: CurrencyType;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsString()
  @IsOptional()
  contractAddress?: string; // Ethereum contract address for ERC-20 tokens
}

