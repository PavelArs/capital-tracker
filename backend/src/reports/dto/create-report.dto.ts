import { IsEnum, IsString, IsOptional, IsObject, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportType, ReportFormat } from '../../entities/report.entity';

/**
 * DTO for creating a new financial report
 */
export class CreateReportDto {
  @ApiProperty({
    description: 'Report type',
    enum: ReportType,
    example: ReportType.FINANCIAL_SUMMARY,
  })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiProperty({
    description: 'Report name',
    example: 'Q4 2024 Financial Summary',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Report description',
    example: 'Comprehensive financial overview for Q4 2024',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Report output format',
    enum: ReportFormat,
    example: ReportFormat.PDF,
    default: ReportFormat.PDF,
  })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @ApiPropertyOptional({
    description: 'Capital/portfolio ID to generate report for',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  capitalId?: string;

  @ApiPropertyOptional({
    description: 'Report generation parameters',
    example: { startDate: '2024-01-01', endDate: '2024-03-31', currency: 'USD' },
  })
  @IsOptional()
  @IsObject()
  parameters?: any;
}
