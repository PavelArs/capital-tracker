import { Module } from '@nestjs/common';
import {
  PortfolioAssetHistoryController,
  PortfolioSnapshotsController,
} from './portfolio-snapshots.controller';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';

@Module({
  controllers: [PortfolioSnapshotsController, PortfolioAssetHistoryController],
  providers: [PortfolioSnapshotsService],
})
export class PortfolioSnapshotsModule {}
