import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { BrokerSetupService } from './broker-setup.service';

@Controller('brokers/tbank')
export class BrokerSetupController {
  constructor(private readonly setup: BrokerSetupService) {}

  @Post('accounts')
  @HttpCode(200)
  accounts(@CurrentUser() owner: OwnerIdentity, @Body() body: unknown) {
    return this.setup.accounts(owner.userId, body);
  }

  @Post('connect')
  async connect(
    @CurrentUser() owner: OwnerIdentity,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.setup.connect(owner.userId, body);
    response.status(result.connections.some((item) => item.created) ? 201 : 200);
    return result;
  }
}
