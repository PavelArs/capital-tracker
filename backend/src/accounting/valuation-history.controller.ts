import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ValuationHistoryService } from './valuation-history.service';

@Controller('accounting/accounts/:id/valuation-history')
export class ValuationHistoryController {
  constructor(private readonly history: ValuationHistoryService) {}

  @Get()
  getSeries(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query() query: unknown) {
    return this.history.getSeries(owner.userId, id, query);
  }
}
