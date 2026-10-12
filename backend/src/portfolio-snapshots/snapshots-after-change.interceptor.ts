import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { AuthenticatedRequest } from '../shared/decorators';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A request of a signed-in owner that changed something starts a background rebuild of that
 * owner's snapshots once it has been answered, so the Dashboard does not rebuild them while
 * the owner waits. Reads and failed requests leave the snapshots alone.
 */
@Injectable()
export class SnapshotsAfterChangeInterceptor implements NestInterceptor {
  constructor(private readonly snapshots: PortfolioSnapshotsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return next.handle().pipe(
      tap(() => {
        const owner = request.user?.userId;
        if (owner && WRITES.has(request.method)) this.snapshots.refreshSoon(owner);
      }),
    );
  }
}
