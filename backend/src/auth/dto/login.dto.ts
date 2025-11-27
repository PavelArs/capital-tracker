import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;

  @IsString({ message: 'Password must be a string' })
  @MinLength(1, { message: 'Password is required' })
  password!: string;
}
