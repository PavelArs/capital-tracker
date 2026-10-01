import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { AssetRewardService } from './asset-reward.service';

@Controller('accounting/accounts/:accountId/rewards')
export class AssetRewardController {
  constructor(private readonly rewards: AssetRewardService) {}

  @Post()
  async create(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.rewards.create(owner.userId, account, input);
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
    const result = await this.rewards.correct(owner.userId, account, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post(':id/void')
  async voidReward(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.rewards.void(owner.userId, account, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Get()
  list(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Query() query: unknown,
  ) {
    return this.rewards.list(owner.userId, account, query);
  }

  @Get(':id/versions')
  versions(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.rewards.listVersions(owner.userId, account, id, query);
  }
}
