import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankType } from '../../entities/bank-integration.entity';

/**
 * DTO for creating a new bank integration
 */
export class CreateBankIntegrationDto {
  @ApiProperty({
    description: 'Bank type',
    enum: BankType,
    example: BankType.CHASE,
  })
  @IsEnum(BankType)
  bankType: BankType;

  @ApiProperty({
    description: 'Integration name/label',
    example: 'My Chase Account',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Bank API credentials (encrypted)',
    example: { apiKey: '***', accountId: '***' },
  })
  @IsOptional()
  @IsObject()
  credentials?: any;

  @ApiPropertyOptional({
    description: 'Additional configuration',
    example: { syncFrequency: 'daily', accountTypes: ['checking', 'savings'] },
  })
  @IsOptional()
  @IsObject()
  config?: any;
}
