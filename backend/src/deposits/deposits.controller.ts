import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { DepositsService } from './deposits.service';

@Controller('deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get()
  list(@CurrentUser() owner: OwnerIdentity, @Query('asOf') asOf?: string) {
    return this.deposits.list(owner.userId, asOf);
  }

  @Post()
  create(@CurrentUser() owner: OwnerIdentity, @Body() body: unknown) {
    return this.deposits.create(owner.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.deposits.get(owner.userId, id, asOf);
  }

  @Delete(':id')
  remove(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.deposits.remove(owner.userId, id);
  }

  @Post(':id/movements')
  addMovement(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Body() body: unknown) {
    return this.deposits.addMovement(owner.userId, id, body);
  }

  @Delete(':id/movements/:movementId')
  removeMovement(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('movementId') movementId: string,
  ) {
    return this.deposits.removeMovement(owner.userId, id, movementId);
  }

  @Post(':id/rates')
  addRate(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Body() body: unknown) {
    return this.deposits.addRate(owner.userId, id, body);
  }

  @Post(':id/checks')
  addCheck(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Body() body: unknown) {
    return this.deposits.addCheck(owner.userId, id, body);
  }
}
