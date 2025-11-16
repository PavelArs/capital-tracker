import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { BrokerType } from '../../entities/broker-integration.entity';

export class CreateBrokerIntegrationDto {
  @IsEnum(BrokerType)
  brokerType: BrokerType;

  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  credentials?: any;

  @IsOptional()
  @IsObject()
  config?: any;
}

