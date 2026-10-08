import { Transform, Type } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

// The service accepts exactly six ASCII digits; anything else is a 400 that spends no guess.
export class RecoveryCodesDto {
  @IsString()
  @MaxLength(16)
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.code)
  code!: string;
}
