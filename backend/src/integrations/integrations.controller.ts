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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { IntegrationsService } from './integrations.service';
import { CreateBrokerIntegrationDto } from './dto/create-broker-integration.dto';
import { CreateBankIntegrationDto } from './dto/create-bank-integration.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('integrations')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  // Broker Integrations
  @Post('brokers')
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  async createBrokerIntegration(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateBrokerIntegrationDto,
  ) {
    return this.integrationsService.createBrokerIntegration(user.userId, createDto);
  }

  @Get('brokers')
  @RequireSubscription(SubscriptionType.PRO)
  async getBrokerIntegrations(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.getBrokerIntegrations(user.userId);
  }

  @Get('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async getBrokerIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.integrationsService.getBrokerIntegration(id, user.userId);
  }

  @Put('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
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
  async syncBrokerIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.integrationsService.syncBrokerIntegration(id, user.userId);
  }

  @Delete('brokers/:id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  async deleteBrokerIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    await this.integrationsService.deleteBrokerIntegration(id, user.userId);
    return { message: 'Broker integration deleted successfully' };
  }

  // Bank Integrations
  @Post('banks')
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  async createBankIntegration(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateBankIntegrationDto,
  ) {
    return this.integrationsService.createBankIntegration(user.userId, createDto);
  }

  @Get('banks')
  @RequireSubscription(SubscriptionType.PRO)
  async getBankIntegrations(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.getBankIntegrations(user.userId);
  }

  @Get('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async getBankIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.integrationsService.getBankIntegration(id, user.userId);
  }

  @Put('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
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
  async syncBankIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.integrationsService.syncBankIntegration(id, user.userId);
  }

  @Delete('banks/:id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  async deleteBankIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    await this.integrationsService.deleteBankIntegration(id, user.userId);
    return { message: 'Bank integration deleted successfully' };
  }
}
