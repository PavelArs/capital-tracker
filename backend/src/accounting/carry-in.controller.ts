import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { CarryInService } from './carry-in.service';

@Controller('accounting/accounts/:id/trade-journal/carry-in')
export class CarryInController {
  constructor(private readonly carryIn: CarryInService) {}

  @Get()
  state(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.carryIn.state(owner.userId, id);
  }

  @Post('preview')
  @HttpCode(200)
  preview(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Body() input: unknown) {
    return this.carryIn.preview(owner.userId, id, input);
  }

  @Post()
  async initialize(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.carryIn.initialize(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Get('lots')
  listLots(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query() query: unknown) {
    return this.carryIn.listLots(owner.userId, id, query);
  }
}
