import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for forgot password request
 */
export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address to send password reset link',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;
}
