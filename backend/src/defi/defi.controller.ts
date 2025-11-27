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
import { DefiService } from './defi.service';
import { CreateDeFiPositionDto } from './dto/create-defi-position.dto';
import { UpdateDeFiPositionDto } from './dto/update-defi-position.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('defi')
@ApiBearerAuth('JWT-auth')
@Controller('defi')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class DefiController {
  constructor(private readonly defiService: DefiService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Create a DeFi position',
    description:
      'Add a new DeFi position for tracking (lending, staking, liquidity pools, etc.). Requires PRO subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'DeFi position created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateDeFiPositionDto) {
    return this.defiService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get all DeFi positions',
    description: 'Retrieve all DeFi positions belonging to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'DeFi positions retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.defiService.findAll(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get DeFi position by ID',
    description: 'Retrieve a specific DeFi position by its ID',
  })
  @ApiParam({ name: 'id', description: 'DeFi position UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'DeFi position retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'DeFi position not found',
    type: ErrorResponseDto,
  })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.defiService.findOne(id, user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Update a DeFi position',
    description: 'Update an existing DeFi position by its ID',
  })
  @ApiParam({ name: 'id', description: 'DeFi position UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'DeFi position updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'DeFi position not found',
    type: ErrorResponseDto,
  })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateDeFiPositionDto,
  ) {
    return this.defiService.update(id, user.userId, updateDto);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Sync DeFi position',
    description: 'Synchronize DeFi position data from the blockchain',
  })
  @ApiParam({ name: 'id', description: 'DeFi position UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'DeFi position synced successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'DeFi position not found',
    type: ErrorResponseDto,
  })
  async syncPosition(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.defiService.syncPosition(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Delete a DeFi position',
    description: 'Remove a DeFi position from tracking',
  })
  @ApiParam({ name: 'id', description: 'DeFi position UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'DeFi position deleted successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'DeFi position not found',
    type: ErrorResponseDto,
  })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.defiService.remove(id, user.userId);
    return { message: 'DeFi position deleted successfully' };
  }
}
