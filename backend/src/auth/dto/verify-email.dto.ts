import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for email verification
 */
export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token',
    example: 'verification_token_123...',
  })
  @IsString({ message: 'Token must be a string' })
  token!: string;
}
