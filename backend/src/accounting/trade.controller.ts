import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { TradeService } from './trade.service';

@Controller('accounting/accounts/:id')
export class TradeController {
  constructor(private readonly trades: TradeService) {}

  @Post('trade-journal')
  async initialize(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.trades.initialize(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('trades')
  async create(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.trades.create(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('trades/:tradeId/corrections')
  async correct(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.trades.correct(owner.userId, id, tradeId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('trades/:tradeId/voids')
  async voidTrade(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.trades.void(owner.userId, id, tradeId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Get('trade-journal')
  getJournal(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.trades.getJournal(owner.userId, id);
  }

  @Get('trades')
  listTrades(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.trades.listTrades(owner.userId, id, query);
  }

  @Get('trade-lots')
  listLots(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query() query: unknown) {
    return this.trades.listLots(owner.userId, id, query);
  }

  @Get('trade-realizations')
  listRealizations(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.trades.listRealizations(owner.userId, id, query);
  }

  @Get('trades/:tradeId/matches')
  listMatches(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Query() query: unknown,
  ) {
    return this.trades.listMatches(owner.userId, id, tradeId, query);
  }

  @Get('trades/:tradeId/versions')
  listVersions(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Query() query: unknown,
  ) {
    return this.trades.listVersions(owner.userId, id, tradeId, query);
  }
}
