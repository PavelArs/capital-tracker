import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface OwnerIdentity {
  userId: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user: OwnerIdentity;
}

export const CurrentUser = createParamDecorator(
  (data: keyof OwnerIdentity | undefined, ctx: ExecutionContext): OwnerIdentity | string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    return data ? user[data] : user;
  },
);
