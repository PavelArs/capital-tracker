import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { WalletAddressService } from './wallet-address.service';

@Controller('wallet-addresses')
export class WalletAddressController {
  constructor(private readonly addresses: WalletAddressService) {}

  @Get()
  list(@CurrentUser() owner: OwnerIdentity) {
    return this.addresses.list(owner.userId);
  }

  @Post()
  async register(
    @CurrentUser() owner: OwnerIdentity,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.addresses.register(owner.userId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post(':id/sync')
  @HttpCode(200)
  sync(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.addresses.sync(owner.userId, id);
  }

  @Get(':id/transactions')
  transactions(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.addresses.transactions(owner.userId, id, query);
  }
}
