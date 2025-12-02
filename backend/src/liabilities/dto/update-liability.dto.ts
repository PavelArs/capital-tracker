import { PartialType } from '@nestjs/swagger';
import { CreateLiabilityDto } from './create-liability.dto';

/**
 * DTO for updating an existing liability (all fields optional)
 */
export class UpdateLiabilityDto extends PartialType(CreateLiabilityDto) {}
