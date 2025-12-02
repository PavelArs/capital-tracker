import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

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
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePass123',
  })
  @IsString({ message: 'Password must be a string' })
  @MinLength(1, { message: 'Password is required' })
  password!: string;
}
