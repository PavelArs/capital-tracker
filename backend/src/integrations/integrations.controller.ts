import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { IntegrationsService } from './integrations.service';
import { CreateBrokerIntegrationDto } from './dto/create-broker-integration.dto';
import { CreateBankIntegrationDto } from './dto/create-bank-integration.dto';

@Controller('integrations')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class IntegrationsController {
  constructor(private integrationsService: IntegrationsService) {}

  // Broker Integrations
  @Post('brokers')
  @RequireSubscription(SubscriptionType.PRO)
  async createBrokerIntegration(
    @Request() req,
    @Body() createDto: CreateBrokerIntegrationDto,
  ) {
    return this.integrationsService.createBrokerIntegration(
      req.user.userId,
      createDto,
    );
  }

  @Get('brokers')
  @RequireSubscription(SubscriptionType.PRO)
  async getBrokerIntegrations(@Request() req) {
    return this.integrationsService.getBrokerIntegrations(req.user.userId);
  }

  @Get('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async getBrokerIntegration(@Request() req, @Param('id') id: string) {
    return this.integrationsService.getBrokerIntegration(id, req.user.userId);
  }

  @Put('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async updateBrokerIntegration(
    @Request() req,
    @Param('id') id: string,
    @Body() updateData: any,
  ) {
    return this.integrationsService.updateBrokerIntegration(
      id,
      req.user.userId,
      updateData,
    );
  }

  @Post('brokers/:id/sync')
  @RequireSubscription(SubscriptionType.PRO)
  async syncBrokerIntegration(@Request() req, @Param('id') id: string) {
    return this.integrationsService.syncBrokerIntegration(id, req.user.userId);
  }

  @Delete('brokers/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async deleteBrokerIntegration(@Request() req, @Param('id') id: string) {
    await this.integrationsService.deleteBrokerIntegration(id, req.user.userId);
    return { message: 'Broker integration deleted successfully' };
  }

  // Bank Integrations
  @Post('banks')
  @RequireSubscription(SubscriptionType.PRO)
  async createBankIntegration(
    @Request() req,
    @Body() createDto: CreateBankIntegrationDto,
  ) {
    return this.integrationsService.createBankIntegration(
      req.user.userId,
      createDto,
    );
  }

  @Get('banks')
  @RequireSubscription(SubscriptionType.PRO)
  async getBankIntegrations(@Request() req) {
    return this.integrationsService.getBankIntegrations(req.user.userId);
  }

  @Get('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async getBankIntegration(@Request() req, @Param('id') id: string) {
    return this.integrationsService.getBankIntegration(id, req.user.userId);
  }

  @Put('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async updateBankIntegration(
    @Request() req,
    @Param('id') id: string,
    @Body() updateData: any,
  ) {
    return this.integrationsService.updateBankIntegration(
      id,
      req.user.userId,
      updateData,
    );
  }

  @Post('banks/:id/sync')
  @RequireSubscription(SubscriptionType.PRO)
  async syncBankIntegration(@Request() req, @Param('id') id: string) {
    return this.integrationsService.syncBankIntegration(id, req.user.userId);
  }

  @Delete('banks/:id')
  @RequireSubscription(SubscriptionType.PRO)
  async deleteBankIntegration(@Request() req, @Param('id') id: string) {
    await this.integrationsService.deleteBankIntegration(id, req.user.userId);
    return { message: 'Bank integration deleted successfully' };
  }
}

