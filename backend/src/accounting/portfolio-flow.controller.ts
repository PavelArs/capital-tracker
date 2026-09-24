import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { PortfolioFlowService } from './portfolio-flow.service';

@Controller('accounting/portfolio')
export class PortfolioFlowController {
  constructor(private readonly flows: PortfolioFlowService) {}

  @Post('xirr-preview')
  @HttpCode(200)
  previewXirr(@CurrentUser() owner: OwnerIdentity, @Body() input: unknown) {
    return this.flows.previewXirr(owner.userId, input);
  }

  @Post('twr-preview')
  @HttpCode(200)
  previewTwr(@CurrentUser() owner: OwnerIdentity, @Body() input: unknown) {
    return this.flows.previewTwr(owner.userId, input);
  }

  @Post('profit-preview')
  @HttpCode(200)
  previewProfit(@CurrentUser() owner: OwnerIdentity, @Body() input: unknown) {
    return this.flows.previewProfit(owner.userId, input);
  }

  @Get('cash-flow-journal')
  getJournal(@CurrentUser() owner: OwnerIdentity) {
    return this.flows.getJournal(owner.userId);
  }

  @Post('cash-flow-journal')
  async initialize(
    @CurrentUser() owner: OwnerIdentity,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.flows.initialize(owner.userId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('cash-flows')
  async create(
    @CurrentUser() owner: OwnerIdentity,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.flows.create(owner.userId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('cash-flows/:flowId/corrections')
  async correct(
    @CurrentUser() owner: OwnerIdentity,
    @Param('flowId') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.flows.correct(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post('cash-flows/:flowId/voids')
  async voidFlow(
    @CurrentUser() owner: OwnerIdentity,
    @Param('flowId') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.flows.void(owner.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Get('cash-flows')
  list(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.flows.list(owner.userId, query);
  }

  @Get('cash-flows/:flowId/versions')
  versions(
    @CurrentUser() owner: OwnerIdentity,
    @Param('flowId') id: string,
    @Query() query: unknown,
  ) {
    return this.flows.versions(owner.userId, id, query);
  }
}
