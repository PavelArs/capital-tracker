import { IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsString({ message: 'Token must be a string' })
  token!: string;
}
