import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { AccountingService } from './accounting.service';
import { parseHistoryQuery, parseListQuery } from './input';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Post('accounts')
  async createAccount(
    @CurrentUser() owner: OwnerIdentity,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounting.createAccount(owner.userId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
  @Post('instruments')
  async createInstrument(
    @CurrentUser() owner: OwnerIdentity,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounting.createInstrument(owner.userId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
  @Post('accounts/:id/openings')
  async saveOpening(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounting.saveOpening(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
  @Get('accounts')
  listAccounts(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.accounting.listAccounts(owner.userId, parseListQuery(query));
  }
  @Get('instruments')
  listInstruments(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.accounting.listInstruments(owner.userId, parseListQuery(query));
  }
  @Get('accounts/:id')
  getAccount(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.accounting.getAccount(owner.userId, id);
  }
  @Get('accounts/:id/openings')
  listOpenings(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.accounting.listOpenings(owner.userId, id, parseHistoryQuery(query));
  }
}
