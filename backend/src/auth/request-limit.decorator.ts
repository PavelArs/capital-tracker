import { applyDecorators, SetMetadata } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthClientSource } from './client-source';
import type { AuthRequestScope } from './request-limits.service';

export const AUTH_REQUEST_LIMIT = 'auth-request-limit';
export type AuthSourcePolicy = Exclude<AuthRequestScope, 'login-account'>;

export const AuthRequestLimit = (scope: AuthSourcePolicy) =>
  applyDecorators(AuthClientSource(), SetMetadata(AUTH_REQUEST_LIMIT, scope), SkipThrottle());
