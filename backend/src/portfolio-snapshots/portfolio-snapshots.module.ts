import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  PortfolioAssetHistoryController,
  PortfolioSnapshotsController,
} from './portfolio-snapshots.controller';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';
import { SnapshotsAfterChangeInterceptor } from './snapshots-after-change.interceptor';

@Module({
  controllers: [PortfolioSnapshotsController, PortfolioAssetHistoryController],
  providers: [
    PortfolioSnapshotsService,
    { provide: APP_INTERCEPTOR, useClass: SnapshotsAfterChangeInterceptor },
  ],
})
export class PortfolioSnapshotsModule {}
