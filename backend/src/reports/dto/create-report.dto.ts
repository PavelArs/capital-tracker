import { IsEnum, IsString, IsOptional, IsObject, IsUUID } from 'class-validator';
import { ReportType, ReportFormat } from '../../entities/report.entity';

export class CreateReportDto {
  @IsEnum(ReportType)
  type: ReportType;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @IsOptional()
  @IsUUID()
  capitalId?: string;

  @IsOptional()
  @IsObject()
  parameters?: any;
}

