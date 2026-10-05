import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';

@Controller('accounting/portfolio/history')
export class PortfolioSnapshotsController {
  constructor(private readonly snapshots: PortfolioSnapshotsService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.snapshots.history(owner.userId, query);
  }
}
