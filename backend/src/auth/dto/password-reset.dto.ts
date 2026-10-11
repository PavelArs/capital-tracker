import { Transform, Type } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class ResetRequestDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(254)
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.email === 'string' ? obj.email.toLowerCase().trim() : obj.email,
  )
  email!: string;
}

// The service answers any other token text as an invalid link.
export class ResetTokenDto {
  @IsString()
  @MaxLength(64)
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.token)
  token!: string;
}

export class ResetConfirmDto extends ResetTokenDto {
  // The password policy is the owner CLI's (15 to 128 characters), checked by the service.
  @IsString()
  @MaxLength(1024)
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.password)
  password!: string;
}
