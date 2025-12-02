import {
  Controller,
  Get,
  Post,
  Put,
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
import { CapitalsService } from './capitals.service';
import { CreateCapitalDto } from './dto/create-capital.dto';
import { UpdateCapitalDto } from './dto/update-capital.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('capitals')
@ApiBearerAuth('JWT-auth')
@Controller('capitals')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class CapitalsController {
  constructor(private readonly capitalsService: CapitalsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Create a new capital',
    description: 'Create a new capital/portfolio for tracking. Requires ENTERPRISE subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'Capital created successfully',
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
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateCapitalDto) {
    return this.capitalsService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Get all capitals',
    description: 'Retrieve all capitals/portfolios belonging to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Capitals retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'ENTERPRISE subscription required',
    type: ErrorResponseDto,
  })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.capitalsService.findAll(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Get capital by ID',
    description: 'Retrieve a specific capital/portfolio by its ID',
  })
  @ApiParam({ name: 'id', description: 'Capital UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Capital retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Capital not found',
    type: ErrorResponseDto,
  })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.capitalsService.findOne(id, user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Update a capital',
    description: 'Update an existing capital/portfolio by its ID',
  })
  @ApiParam({ name: 'id', description: 'Capital UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Capital updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Capital not found',
    type: ErrorResponseDto,
  })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateCapitalDto,
  ) {
    return this.capitalsService.update(id, user.userId, updateDto);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Set capital as default',
    description: 'Set a capital/portfolio as the default for the user',
  })
  @ApiParam({ name: 'id', description: 'Capital UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Capital set as default successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Capital not found',
    type: ErrorResponseDto,
  })
  async setDefault(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.capitalsService.setDefault(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  @ApiOperation({
    summary: 'Delete a capital',
    description: 'Remove a capital/portfolio from the user account',
  })
  @ApiParam({ name: 'id', description: 'Capital UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Capital deleted successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Capital not found',
    type: ErrorResponseDto,
  })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.capitalsService.remove(id, user.userId);
    return { message: 'Capital deleted successfully' };
  }
}
