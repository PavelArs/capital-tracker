import { Module } from '@nestjs/common';
import { PortfolioSnapshotsModule } from '../portfolio-snapshots/portfolio-snapshots.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [PortfolioSnapshotsModule],
  controllers: [GoalsController],
  providers: [GoalsService],
})
export class GoalsModule {}
