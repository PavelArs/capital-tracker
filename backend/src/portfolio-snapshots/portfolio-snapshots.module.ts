import { Module } from '@nestjs/common';
import { PortfolioSnapshotsController } from './portfolio-snapshots.controller';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';

@Module({
  controllers: [PortfolioSnapshotsController],
  providers: [PortfolioSnapshotsService],
})
export class PortfolioSnapshotsModule {}
