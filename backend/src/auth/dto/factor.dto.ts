import { Transform, Type } from 'class-transformer';
import { IsIn, IsString, MaxLength } from 'class-validator';

export class FactorDto {
  @IsIn(['totp', 'recovery'])
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.kind)
  kind!: 'totp' | 'recovery';

  @IsString()
  @MaxLength(35)
  @Type(() => Object)
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.code)
  code!: string;
}
