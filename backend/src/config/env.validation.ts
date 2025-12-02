import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  validateSync,
} from 'class-validator';
import { plainToInstance, Transform } from 'class-transformer';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10))
  @IsOptional()
  PORT: number = 3000;

  // Database
  @IsString()
  @IsOptional()
  DB_HOST: string = 'localhost';

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  @IsOptional()
  DB_PORT: number = 5432;

  @IsString()
  @IsOptional()
  DB_USERNAME: string = 'postgres';

  @IsString()
  @IsOptional()
  DB_PASSWORD: string = 'postgres';

  @IsString()
  @IsOptional()
  DB_NAME: string = 'capital_tracker';

  // JWT
  @IsString()
  JWT_SECRET!: string;

  @IsNumber()
  @IsOptional()
  JWT_EXPIRES_IN: number = 60 * 60 * 24 * 7;

  // Frontend URL for CORS
  @IsString()
  @IsOptional()
  FRONTEND_URL: string = 'http://localhost:3001';

  // Email Configuration (optional)
  @IsString()
  @IsOptional()
  SMTP_HOST?: string;

  @IsNumber()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  @IsOptional()
  SMTP_PORT?: number;

  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASSWORD?: string;

  @IsString()
  @IsOptional()
  SMTP_FROM?: string;

  // Development flags
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  SKIP_EMAIL_VERIFICATION: boolean = false;

  @IsString()
  @IsOptional()
  DEV_INVITATION_CODE: string = 'DEV2024';

  // Redis
  @IsString()
  @IsOptional()
  REDIS_HOST: string = 'localhost';

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsNumber()
  @Transform(({ value }) => (value ? parseInt(value, 10) : 600000)) // 10 minutes in milliseconds
  @IsOptional()
  EXCHANGE_RATES_CACHE_TTL: number = 600000;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
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
