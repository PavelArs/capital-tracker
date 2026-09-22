import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * DTO for user login
 */
export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.email === 'string' ? obj.email.toLowerCase().trim() : obj.email,
  )
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'Owner-password-example-42!',
  })
  @IsString({ message: 'Password must be a string' })
  @MinLength(1, { message: 'Password is required' })
  @Type(() => Object)
  // Credentials must retain their original types despite global implicit DTO conversion.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.password)
  password!: string;
}
