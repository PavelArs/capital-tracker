import { Body, Controller, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ManualPortfolioValuationService } from './manual-portfolio-valuation.service';

@Controller('accounting/manual-valuation-preview')
export class ManualPortfolioValuationController {
  constructor(private readonly valuation: ManualPortfolioValuationService) {}

  @Post()
  @HttpCode(200)
  preview(@CurrentUser() owner: OwnerIdentity, @Body() body: unknown, @Query() query: unknown) {
    return this.valuation.preview(owner.userId, body, query);
  }
}
