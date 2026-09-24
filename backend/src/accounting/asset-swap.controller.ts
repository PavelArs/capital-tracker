import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { AssetSwapService } from './asset-swap.service';

@Controller('accounting/accounts/:accountId/swaps')
export class AssetSwapController {
  constructor(private readonly swaps: AssetSwapService) {}

  @Post()
  async create(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.swaps.create(owner.userId, account, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post(':id/correct')
  async correct(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.swaps.correct(owner.userId, account, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post(':id/void')
  async voidSwap(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.swaps.void(owner.userId, account, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Get()
  list(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Query() query: unknown,
  ) {
    return this.swaps.list(owner.userId, account, query);
  }

  @Get(':id/versions')
  versions(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.swaps.listVersions(owner.userId, account, id, query);
  }

  @Get(':id/allocation')
  allocation(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.swaps.getAllocation(owner.userId, account, id, query);
  }
}
