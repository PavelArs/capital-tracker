import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { PortfolioValuationService } from './portfolio-valuation.service';

@Controller('accounting/portfolio')
export class PortfolioValuationController {
  constructor(private readonly portfolio: PortfolioValuationService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.portfolio.read(owner.userId, query);
  }
}
