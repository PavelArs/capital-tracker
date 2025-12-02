import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for user registration
 */
export class RegisterDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    description: 'User password (must contain at least one letter and one number)',
    example: 'SecurePass123',
    minLength: 6,
    maxLength: 100,
  })
  @IsString({ message: 'Password must be a string' })
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)/, {
    message: 'Password must contain at least one letter and one number',
  })
  password!: string;

  @ApiPropertyOptional({
    description: 'User first name',
    example: 'John',
    minLength: 1,
    maxLength: 50,
  })
  @IsOptional()
  @IsString({ message: 'First name must be a string' })
  @MinLength(1, { message: 'First name must not be empty' })
  @MaxLength(50, { message: 'First name must not exceed 50 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  firstName?: string;

  @ApiPropertyOptional({
    description: 'User last name',
    example: 'Doe',
    minLength: 1,
    maxLength: 50,
  })
  @IsOptional()
  @IsString({ message: 'Last name must be a string' })
  @MinLength(1, { message: 'Last name must not be empty' })
  @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  lastName?: string;

  @ApiProperty({
    description: 'Invitation code required for registration',
    example: 'INVITE123',
  })
  @IsString({ message: 'Invitation code must be a string' })
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  invitationCode!: string;
}
