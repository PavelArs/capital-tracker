import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { UnknownChainAssetError } from './chain-assets';
import { loadChainTokens } from './chain-tokens';

/**
 * The token registry is read at start, so a token another backend process stored is unknown
 * here. A request that meets one reloads chain_tokens once; a read then runs again, and a
 * write keeps its error (the owner's retry finds the token).
 */
@Injectable()
export class ChainTokenRefreshInterceptor implements NestInterceptor {
  constructor(private readonly source: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const read = context.switchToHttp().getRequest<{ method: string }>().method === 'GET';
    return next.handle().pipe(
      catchError((error) => {
        if (!(error instanceof UnknownChainAssetError)) return throwError(() => error);
        return from(loadChainTokens(this.source.manager).catch(() => 0)).pipe(
          mergeMap(() => (read ? next.handle() : throwError(() => error))),
        );
      }),
    );
  }
}
