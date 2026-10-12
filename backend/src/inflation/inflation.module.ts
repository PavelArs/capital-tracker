import { Module } from '@nestjs/common';
import { InflationController } from './inflation.controller';
import { InflationService } from './inflation.service';
import { InflationClient } from './inflation-sources';

@Module({
  controllers: [InflationController],
  providers: [
    InflationService,
    { provide: InflationClient, useFactory: () => new InflationClient() },
  ],
})
export class InflationModule {}
