import { IsBoolean, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for toggling currency visibility
 */
export class ToggleCurrencyDto {
  @ApiProperty({
    description: 'Currency ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  currencyId: string;

  @ApiProperty({
    description: 'Whether the currency should be hidden',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  isHidden: boolean;
}
