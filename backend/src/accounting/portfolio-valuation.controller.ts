import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { PortfolioValuationService } from './portfolio-valuation.service';

@Controller('accounting/portfolio')
export class PortfolioValuationController {
  constructor(private readonly portfolio: PortfolioValuationService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.portfolio.read(owner.userId, query);
  }

  @Get('assets/:instrumentId/lots')
  lots(
    @CurrentUser() owner: OwnerIdentity,
    @Param('instrumentId') instrumentId: string,
    @Query() query: unknown,
  ) {
    return this.portfolio.lots(owner.userId, instrumentId, query);
  }
}
