import { PartialType } from '@nestjs/swagger';
import { CreateCapitalDto } from './create-capital.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for updating an existing capital (all fields optional)
 */
export class UpdateCapitalDto extends PartialType(CreateCapitalDto) {
  @ApiPropertyOptional({
    description: 'Whether the capital is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
