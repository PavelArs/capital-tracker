import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly logger: PinoLogger) {
    super();
    this.logger.setContext(JwtAuthGuard.name);
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }

  handleRequest<TUser>(
    err: Error | null,
    user: TUser | false,
    info: Error | undefined,
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest<{ url: string; method: string }>();

    if (err) {
      this.logger.warn(
        {
          error: err.message,
          url: request.url,
          method: request.method,
        },
        'Authentication error',
      );
      throw err;
    }

    if (!user) {
      this.logger.warn(
        {
          info: info?.message,
          url: request.url,
          method: request.method,
        },
        'Authentication failed: Invalid or missing token',
      );
      throw new UnauthorizedException(info?.message || 'Invalid or expired authentication token');
    }

    return user;
  }
}
