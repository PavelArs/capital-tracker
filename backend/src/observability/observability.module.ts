import { Module } from '@nestjs/common';
import { MetricsCollector } from './metrics.collector';

@Module({
  providers: [MetricsCollector],
  exports: [MetricsCollector],
})
export class ObservabilityModule {}
