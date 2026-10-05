import { Controller, Get, Param, Query } from '@nestjs/common';
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

@Controller('accounting/portfolio/assets')
export class PortfolioAssetHistoryController {
  constructor(private readonly snapshots: PortfolioSnapshotsService) {}

  @Get(':instrumentId/history')
  read(
    @CurrentUser() owner: OwnerIdentity,
    @Param('instrumentId') instrumentId: string,
    @Query() query: unknown,
  ) {
    return this.snapshots.assetHistory(owner.userId, instrumentId, query);
  }
}
