import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ChainClassificationService } from './chain-classification.service';
import { OwnedTransferService } from './owned-transfer.service';

@Controller('accounting/transfers')
export class OwnedTransferController {
  constructor(
    private readonly transfers: OwnedTransferService,
    private readonly classifications: ChainClassificationService,
  ) {}

  @Post()
  async create(
    @CurrentUser() owner: OwnerIdentity,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transfers.create(owner.userId, input);
    await this.classifications.afterManualWrite(owner.userId, result);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post(':id/corrections')
  async correct(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transfers.correct(owner.userId, id, input);
    await this.classifications.afterManualWrite(owner.userId, result);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Post(':id/voids')
  async voidTransfer(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transfers.void(owner.userId, id, input);
    await this.classifications.afterManualWrite(owner.userId, result);
    response.status(result.created ? 201 : 200);
    return result.value;
  }

  @Get()
  list(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.transfers.list(owner.userId, query);
  }

  @Get(':id/versions')
  listVersions(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.transfers.listVersions(owner.userId, id, query);
  }

  @Get(':id/allocation')
  allocation(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.transfers.allocation(owner.userId, id, query);
  }
}
