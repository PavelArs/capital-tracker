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
import { IntegrationsService } from './integrations.service';
import { CreateBrokerIntegrationDto } from './dto/create-broker-integration.dto';
import { CreateBankIntegrationDto } from './dto/create-bank-integration.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('integrations')
@ApiBearerAuth('JWT-auth')
@Controller('integrations')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  // Broker Integrations
  @Post('brokers')
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Create broker integration',
    description:
      'Connect a broker account for automatic portfolio sync. Requires PRO subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'Broker integration created successfully',
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
  async createBrokerIntegration(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateBrokerIntegrationDto,
  ) {
    return this.integrationsService.createBrokerIntegration(user.userId, createDto);
  }

  @Get('brokers')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get all broker integrations',
    description: 'Retrieve all broker integrations for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Broker integrations retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async getBrokerIntegrations(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.getBrokerIntegrations(user.userId);
  }

  @Get('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get broker integration by ID',
    description: 'Retrieve a specific broker integration by its ID',
  })
  @ApiParam({ name: 'id', description: 'Broker integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Broker integration retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Broker integration not found',
    type: ErrorResponseDto,
  })
  async getBrokerIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.getBrokerIntegration(id, user.userId);
  }

  @Put('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Update broker integration',
    description: 'Update an existing broker integration',
  })
  @ApiParam({ name: 'id', description: 'Broker integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Broker integration updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Broker integration not found',
    type: ErrorResponseDto,
  })
  async updateBrokerIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateData: Record<string, unknown>,
  ) {
    return this.integrationsService.updateBrokerIntegration(id, user.userId, updateData);
  }

  @Post('brokers/:id/sync')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Sync broker integration',
    description: 'Manually trigger synchronization with the broker',
  })
  @ApiParam({ name: 'id', description: 'Broker integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Broker integration synced successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Broker integration not found',
    type: ErrorResponseDto,
  })
  async syncBrokerIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.syncBrokerIntegration(id, user.userId);
  }

  @Delete('brokers/:id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Delete broker integration',
    description: 'Remove a broker integration',
  })
  @ApiParam({ name: 'id', description: 'Broker integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Broker integration deleted successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Broker integration not found',
    type: ErrorResponseDto,
  })
  async deleteBrokerIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.integrationsService.deleteBrokerIntegration(id, user.userId);
    return { message: 'Broker integration deleted successfully' };
  }

  // Bank Integrations
  @Post('banks')
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Create bank integration',
    description:
      'Connect a bank account for automatic transaction sync. Requires PRO subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'Bank integration created successfully',
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
  async createBankIntegration(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateBankIntegrationDto,
  ) {
    return this.integrationsService.createBankIntegration(user.userId, createDto);
  }

  @Get('banks')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get all bank integrations',
    description: 'Retrieve all bank integrations for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Bank integrations retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async getBankIntegrations(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.getBankIntegrations(user.userId);
  }

  @Get('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get bank integration by ID',
    description: 'Retrieve a specific bank integration by its ID',
  })
  @ApiParam({ name: 'id', description: 'Bank integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bank integration retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Bank integration not found',
    type: ErrorResponseDto,
  })
  async getBankIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.getBankIntegration(id, user.userId);
  }

  @Put('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Update bank integration',
    description: 'Update an existing bank integration',
  })
  @ApiParam({ name: 'id', description: 'Bank integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bank integration updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Bank integration not found',
    type: ErrorResponseDto,
  })
  async updateBankIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateData: Record<string, unknown>,
  ) {
    return this.integrationsService.updateBankIntegration(id, user.userId, updateData);
  }

  @Post('banks/:id/sync')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Sync bank integration',
    description: 'Manually trigger synchronization with the bank',
  })
  @ApiParam({ name: 'id', description: 'Bank integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bank integration synced successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Bank integration not found',
    type: ErrorResponseDto,
  })
  async syncBankIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.syncBankIntegration(id, user.userId);
  }

  @Delete('banks/:id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Delete bank integration',
    description: 'Remove a bank integration',
  })
  @ApiParam({ name: 'id', description: 'Bank integration UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bank integration deleted successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Bank integration not found',
    type: ErrorResponseDto,
  })
  async deleteBankIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.integrationsService.deleteBankIntegration(id, user.userId);
    return { message: 'Bank integration deleted successfully' };
  }
}
