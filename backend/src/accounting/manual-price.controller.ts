import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ManualPriceService } from './manual-price.service';

@Controller('accounting/instruments/:id/usd-prices')
export class ManualPriceController {
  constructor(private readonly prices: ManualPriceService) {}

  @Get()
  list(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query() query: unknown) {
    return this.prices.list(owner.userId, id, query);
  }

  @Get('history')
  history(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query() query: unknown) {
    return this.prices.history(owner.userId, id, query);
  }

  @Post()
  async set(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.prices.set(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('void')
  async void(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.prices.void(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
}
