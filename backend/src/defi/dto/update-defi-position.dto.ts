import { PartialType } from '@nestjs/swagger';
import { CreateDeFiPositionDto } from './create-defi-position.dto';

/**
 * DTO for updating an existing DeFi position (all fields optional)
 */
export class UpdateDeFiPositionDto extends PartialType(CreateDeFiPositionDto) {}
