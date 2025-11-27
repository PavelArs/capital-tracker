import { IsString, IsOptional } from 'class-validator';

export class CreateCapitalDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
