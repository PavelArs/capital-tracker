import { PartialType } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';

/**
 * DTO for updating an existing asset (all fields optional)
 */
export class UpdateAssetDto extends PartialType(CreateAssetDto) {}
