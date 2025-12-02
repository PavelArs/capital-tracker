import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('reports')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Create a new report',
    description: 'Create a new financial report configuration. Requires ENTERPRISE subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'Report created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'ENTERPRISE subscription required',
    type: ErrorResponseDto,
  })
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateReportDto) {
    return this.reportsService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Get all reports',
    description: 'Retrieve all reports belonging to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Reports retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'ENTERPRISE subscription required',
    type: ErrorResponseDto,
  })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.reportsService.findAll(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Get report by ID',
    description: 'Retrieve a specific report by its ID',
  })
  @ApiParam({ name: 'id', description: 'Report UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Report retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Report not found',
    type: ErrorResponseDto,
  })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reportsService.findOne(id, user.userId);
  }

  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Generate report',
    description: 'Generate a report with current data',
  })
  @ApiParam({ name: 'id', description: 'Report UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Report generated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Report not found',
    type: ErrorResponseDto,
  })
  async generateReport(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reportsService.generateReport(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Delete a report',
    description: 'Remove a report from the user account',
  })
  @ApiParam({ name: 'id', description: 'Report UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Report deleted successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Report not found',
    type: ErrorResponseDto,
  })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.reportsService.remove(id, user.userId);
    return { message: 'Report deleted successfully' };
  }
}
