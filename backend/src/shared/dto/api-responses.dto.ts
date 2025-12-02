import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Generic success message response
 */
export class MessageResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Operation completed successfully',
  })
  message: string;
}

/**
 * Token response for authentication
 */
export class TokenResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}

/**
 * User profile response (without sensitive data)
 */
export class UserProfileResponseDto {
  @ApiProperty({
    description: 'User unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  email: string;

  @ApiPropertyOptional({
    description: 'User first name',
    example: 'John',
  })
  firstName?: string | null;

  @ApiPropertyOptional({
    description: 'User last name',
    example: 'Doe',
  })
  lastName?: string | null;

  @ApiProperty({
    description: 'User subscription type',
    example: 'free',
    enum: ['free', 'pro', 'enterprise'],
  })
  subscriptionType: string;

  @ApiProperty({
    description: 'Whether user email is verified',
    example: true,
  })
  emailVerified: boolean;

  @ApiProperty({
    description: 'Account creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: Date;
}

/**
 * Pagination metadata
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: 'Total number of items',
    example: 100,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Items per page',
    example: 10,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 10,
  })
  totalPages: number;
}

/**
 * Generic paginated response
 */
export class PaginatedResponseDto<T> {
  data: T[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Error response structure
 */
export class ErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Error message or array of validation messages',
    example: 'Bad Request',
  })
  message: string | string[];

  @ApiProperty({
    description: 'Error type',
    example: 'Bad Request',
  })
  error: string;

  @ApiProperty({
    description: 'Error timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Request path',
    example: '/api/auth/login',
  })
  path: string;
}

/**
 * Validation error response
 */
export class ValidationErrorResponseDto extends ErrorResponseDto {
  @ApiProperty({
    description: 'Validation error messages',
    example: ['email must be an email', 'password must be at least 6 characters'],
    type: [String],
  })
  message: string[];
}
