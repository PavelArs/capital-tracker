import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthClientSourceService } from './client-source';
import { AuthClientSourceModule } from './client-source.module';

// Options only: AuthModule registers the guard after SessionGuard so anonymous requests
// are refused before they can spend a shared per-route budget.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [AuthClientSourceModule],
      inject: [AuthClientSourceService],
      useFactory: (sources: AuthClientSourceService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        getTracker: (request, context) => sources.tracker(request as Request, context),
      }),
    }),
  ],
})
export class ApplicationThrottlerModule {}
