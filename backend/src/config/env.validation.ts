import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

import { parseTrustedProxyIps } from '../auth/client-source';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsIn(['true', 'false'])
  @IsOptional()
  DISPLAY_FX_ENABLED = 'false';

  @IsIn(['true', 'false'])
  @IsOptional()
  DISPLAY_FX_TRUST_PROXY = 'false';

  @IsIn(['true', 'false'])
  @IsOptional()
  PRICE_COLLECTION_ENABLED = 'false';

  @IsString()
  @IsOptional()
  COINGECKO_DEMO_API_KEY?: string;

  // Free Etherscan key for Ethereum wallet history (Q6); without it Ethereum wallets say so.
  @IsString()
  @IsOptional()
  ETHERSCAN_API_KEY?: string;

  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsOptional()
  PORT = 3000;

  // Database
  @IsString()
  @IsOptional()
  DB_HOST = 'localhost';

  @IsNumber()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsOptional()
  DB_PORT = 5432;

  @IsString()
  @IsOptional()
  DB_USERNAME = 'postgres';

  @IsString()
  @IsOptional()
  DB_PASSWORD = 'postgres';

  @IsString()
  @IsOptional()
  DB_NAME = 'capital_tracker';

  @IsString()
  TRUSTED_PROXY_IPS!: string;

  // Frontend URL for CORS
  @IsString()
  FRONTEND_URL!: string;

  @IsString()
  MFA_KEY_FILE!: string;

  @IsString()
  MFA_KEY_ID!: string;

  // Redis
  @IsString()
  @IsOptional()
  REDIS_HOST = 'localhost';

  @IsNumber()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsOptional()
  REDIS_PORT = 6379;

  @IsNumber()
  @Transform(({ value }) => (value ? Number.parseInt(value, 10) : 600000)) // 10 minutes in milliseconds
  @IsOptional()
  EXCHANGE_RATES_CACHE_TTL = 600000;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  parseTrustedProxyIps(config.TRUSTED_PROXY_IPS);
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => {
        const constraints = error.constraints;
        return constraints ? Object.values(constraints).join(', ') : '';
      })
      .filter(Boolean)
      .join('; ');

    throw new Error(`Environment validation error: ${errorMessages}`);
  }

  return validatedConfig;
}
