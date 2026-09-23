import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { HistoricalValuationService } from './historical-valuation.service';

@Controller('accounting/accounts/:id/valuation')
export class HistoricalValuationController {
  constructor(private readonly valuation: HistoricalValuationService) {}

  @Get()
  getSnapshot(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.valuation.getSnapshot(owner.userId, id, query);
  }
}
