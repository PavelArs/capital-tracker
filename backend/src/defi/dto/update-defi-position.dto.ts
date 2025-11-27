import { PartialType } from '@nestjs/mapped-types';
import { CreateDeFiPositionDto } from './create-defi-position.dto';

export class UpdateDeFiPositionDto extends PartialType(CreateDeFiPositionDto) {}
