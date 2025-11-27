import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new capital (portfolio/account)
 */
export class CreateCapitalDto {
  @ApiProperty({
    description: 'Capital name',
    example: 'Personal Portfolio',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Capital description',
    example: 'My primary investment portfolio',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
