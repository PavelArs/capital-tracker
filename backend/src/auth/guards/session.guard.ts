import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AuthClientSourceService } from '../client-source';
import { PENDING_ROUTE, PUBLIC_ROUTE } from '../public.decorator';
import { SessionIdentity, SessionService, readSessionCookie } from '../session.service';

export interface SessionRequest extends Request {
  authSession: SessionIdentity;
  user?: { userId: string; email: string };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly clientSources: AuthClientSourceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.clientSources.validate(context);
    const request = context.switchToHttp().getRequest<SessionRequest>();
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const publicRoute = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publicRoute && ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const session = await this.sessions.authorize(
      readSessionCookie(request.headers.cookie),
      !publicRoute,
      request.method,
      request.headers.origin,
      request.headers['x-csrf-token'],
      this.reflector.getAllAndOverride<boolean>(PENDING_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true,
    );
    request.authSession = session;
    if (session.user) request.user = session.user;
    return true;
  }
}
