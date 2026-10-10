import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ChainClassificationService } from './chain-classification.service';

@Controller('accounting/chain-transactions')
export class ChainClassificationController {
  constructor(private readonly classifications: ChainClassificationService) {}

  @Get('needs-classification')
  count(@CurrentUser() owner: OwnerIdentity) {
    return this.classifications.needsClassificationCount(owner.userId);
  }

  @Post(':addressId/:txid/classifications')
  async classify(
    @CurrentUser() owner: OwnerIdentity,
    @Param('addressId') addressId: string,
    @Param('txid') txid: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.classifications.classify(owner.userId, addressId, txid, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  // BYBIT-GAP-DELETE: a record made by counting a Bybit balance difference can be deleted.
  @Post(':addressId/:txid/removal')
  @HttpCode(200)
  remove(
    @CurrentUser() owner: OwnerIdentity,
    @Param('addressId') addressId: string,
    @Param('txid') txid: string,
    @Body() input: unknown,
  ) {
    return this.classifications.removeCounted(owner.userId, addressId, txid, input);
  }
}
