import { PartialType } from '@nestjs/mapped-types';
import { CreateCapitalDto } from './create-capital.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateCapitalDto extends PartialType(CreateCapitalDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
