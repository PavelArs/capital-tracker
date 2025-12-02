import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrokerType } from '../../entities/broker-integration.entity';

/**
 * DTO for creating a new broker integration
 */
export class CreateBrokerIntegrationDto {
  @ApiProperty({
    description: 'Broker type',
    enum: BrokerType,
    example: BrokerType.INTERACTIVE_BROKERS,
  })
  @IsEnum(BrokerType)
  brokerType: BrokerType;

  @ApiProperty({
    description: 'Integration name/label',
    example: 'My Interactive Brokers Account',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Broker API credentials (encrypted)',
    example: { apiKey: '***', secretKey: '***' },
  })
  @IsOptional()
  @IsObject()
  credentials?: any;

  @ApiPropertyOptional({
    description: 'Additional configuration',
    example: { syncFrequency: 'hourly', includePositions: true },
  })
  @IsOptional()
  @IsObject()
  config?: any;
}
