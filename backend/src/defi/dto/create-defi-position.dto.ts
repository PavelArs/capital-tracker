import { IsEnum, IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeFiPlatform, PositionType } from '../../entities/defi-position.entity';

/**
 * DTO for creating a new DeFi position
 */
export class CreateDeFiPositionDto {
  @ApiProperty({
    description: 'DeFi platform',
    enum: DeFiPlatform,
    example: DeFiPlatform.AAVE,
  })
  @IsEnum(DeFiPlatform)
  platform: DeFiPlatform;

  @ApiProperty({
    description: 'Type of DeFi position',
    enum: PositionType,
    example: PositionType.LENDING,
  })
  @IsEnum(PositionType)
  positionType: PositionType;

  @ApiProperty({
    description: 'Position name',
    example: 'USDC Lending on Aave',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Platform-specific position data',
    example: { poolAddress: '0x...', tokenSymbol: 'USDC' },
  })
  @IsOptional()
  @IsObject()
  positionData?: any;

  @ApiPropertyOptional({
    description: 'Current position value in USD',
    example: 5000.0,
  })
  @IsOptional()
  @IsNumber()
  value?: number;

  @ApiPropertyOptional({
    description: 'Annual Percentage Yield',
    example: 5.25,
  })
  @IsOptional()
  @IsNumber()
  apy?: number;

  @ApiPropertyOptional({
    description: 'Position description',
    example: 'Lending USDC to earn interest',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
