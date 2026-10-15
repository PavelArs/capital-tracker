import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { BrokerConnectionsService } from './broker-connections.service';

@Controller('brokers/:accountId/connection')
export class BrokerConnectionsController {
  constructor(private readonly connections: BrokerConnectionsService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity, @Param('accountId') accountId: string) {
    return this.connections.read(owner.userId, accountId);
  }

  @Get('positions')
  positions(@CurrentUser() owner: OwnerIdentity, @Param('accountId') accountId: string) {
    return this.connections.positions(owner.userId, accountId);
  }

  @Get('operations')
  operations(@CurrentUser() owner: OwnerIdentity, @Param('accountId') accountId: string) {
    return this.connections.operations(owner.userId, accountId);
  }

  @Get('import-preview')
  importPreview(@CurrentUser() owner: OwnerIdentity, @Param('accountId') accountId: string) {
    return this.connections.importPreview(owner.userId, accountId);
  }

  @Post('check')
  @HttpCode(200)
  check(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ) {
    return this.connections.check(owner.userId, accountId, body);
  }

  @Put()
  connect(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ) {
    return this.connections.connect(owner.userId, accountId, body);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() owner: OwnerIdentity, @Param('accountId') accountId: string) {
    await this.connections.disconnect(owner.userId, accountId);
  }
}
