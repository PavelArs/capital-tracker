import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { GlobalExceptionFilter } from '../shared/filters/global-exception.filter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_CLIENT_SOURCE, AuthClientSourceService } from './client-source';
import { LoginDto } from './dto/login.dto';
import { SessionGuard, SessionRequest } from './guards/session.guard';
import { MfaService } from './mfa.service';
import * as passwords from './password';
import { AUTH_REQUEST_LIMIT } from './request-limit.decorator';
import {
  AuthRequestLimitException,
  AuthRequestLimitsService,
  AuthRequestScope,
} from './request-limits.service';
import { SESSION_COOKIE, SessionService } from './session.service';

// Negative source-level instrumentation only: no synthetic authenticated success,
// no HTTP/backend mock presented as PostgreSQL or browser evidence.
const origin = 'https://example.invalid';
const cookie = 'A'.repeat(43);
const csrf = 'C'.repeat(43);
const subject = 'v4:198.51.100.9/32';
const credentials = { email: 'owner@example.invalid', password: 'Synthetic-password-42!' };
type Route = 'csrf' | 'login' | 'mfa' | 'getProfile' | 'logout';
const protectedPolicies: [Route, AuthRequestScope, string][] = [
  ['csrf', 'csrf-ip', 'GET'],
  ['csrf', 'csrf-ip', 'HEAD'],
  ['login', 'login-ip', 'POST'],
  ['mfa', 'mfa-ip', 'POST'],
];

function unexpected(): never {
  throw new Error('Denied admission unexpectedly reached downstream work');
}

function fixture() {
  const reflector = new Reflector();
  const source = new DataSource({ type: 'postgres' });
  const transaction = jest.spyOn(source, 'transaction').mockImplementation(unexpected);
  const sessions = new SessionService(source, new ConfigService({ FRONTEND_URL: origin }));
  const authorize = jest.spyOn(sessions, 'authorize').mockImplementation(unexpected);
  const rotate = jest.spyOn(sessions, 'rotate').mockImplementation(unexpected);
  const allocate = jest.spyOn(sessions, 'csrf').mockImplementation(unexpected);
  const lookup = jest.fn(unexpected);
  const auth = new AuthService({ findOne: lookup } as unknown as Repository<OwnerAuth>);
  const validate = jest.spyOn(auth, 'validateUser');
  const verify = jest.spyOn(passwords, 'verifyPassword').mockImplementation(unexpected);
  const complete = jest.fn(unexpected);
  const factors = { complete } as unknown as MfaService;
  const limits = new AuthRequestLimitsService(source);
  const admit = jest.spyOn(limits, 'admit').mockImplementation(unexpected);
  const sources = new AuthClientSourceService(
    new ConfigService({ TRUSTED_PROXY_IPS: '["192.0.2.10"]' }),
    reflector,
  );
  const guard = new SessionGuard(reflector, sessions, sources, limits);
  const controller = new AuthController(auth, sessions, factors, limits);
  const noCredentialWork = (admissionTransactions = 0) => {
    for (const spy of [validate, lookup, verify, rotate, complete, allocate]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(transaction).toHaveBeenCalledTimes(admissionTransactions);
    expect(source.isInitialized).toBe(false);
  };
  return { guard, controller, admit, authorize, transaction, noCredentialWork };
}

function context(
  route: Route,
  method = route === 'csrf' || route === 'getProfile' ? 'GET' : 'POST',
) {
  const request = {
    method,
    url: `/auth/${route}?private-marker=withheld`,
    ip: '192.0.2.10',
    socket: { remoteAddress: '192.0.2.10' },
    rawHeaders: ['X-Forwarded-For', '198.51.100.9'],
    headers: {
      cookie: `${SESSION_COOKIE}=${cookie}`,
      origin,
      'x-csrf-token': csrf,
      'x-forwarded-for': '198.51.100.9',
    },
  } as unknown as SessionRequest;
  const response = {
    setHeader: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  const ctx = new ExecutionContextHost(
    [request, response],
    AuthController,
    AuthController.prototype[route],
  );
  return { request, response, ctx };
}

async function guardedCall(
  f: ReturnType<typeof fixture>,
  route: Route,
  c: ReturnType<typeof context>,
) {
  await f.guard.canActivate(c.ctx);
  const response = c.response as unknown as Response;
  if (route === 'csrf') return f.controller.csrf(c.request, response);
  if (route === 'login') return f.controller.login(credentials, c.request, response);
  if (route === 'mfa')
    return f.controller.mfa({ kind: 'totp', code: '123456' }, c.request, response);
  throw new Error('Only authentication denial paths belong to this helper');
}

afterEach(() => jest.restoreAllMocks());

describe('LIMIT-001/002 actual handler and admission boundaries', () => {
  it.each(protectedPolicies)(
    '%s %s uses one stable policy and skips only the old quota',
    (route, policy) => {
      const handler = AuthController.prototype[route];
      expect(Reflect.getMetadata(AUTH_REQUEST_LIMIT, handler)).toBe(policy);
      expect(Reflect.getMetadata(AUTH_CLIENT_SOURCE, handler)).toBe(true);
      expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, handler)).toBe(true);
    },
  );

  it.each(['getProfile', 'logout'] as const)(
    '%s retains generic throttling and no ledger policy',
    (route) => {
      const handler = AuthController.prototype[route];
      expect(Reflect.getMetadata(AUTH_REQUEST_LIMIT, handler)).toBeUndefined();
      expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, handler)).not.toBe(true);
    },
  );

  it.each(protectedPolicies)(
    'rejects malformed trusted source before any %s admission',
    async (route, _policy, method) => {
      const malformed: [string[], string | string[] | undefined][] = [
        [[], undefined],
        [['X-Forwarded-For', '198.51.100.9', 'x-forwarded-for', '198.51.100.9'], '198.51.100.9'],
        [['X-Forwarded-For', '198.51.100.9, 198.51.100.10'], '198.51.100.9, 198.51.100.10'],
        [['X-Forwarded-For', 'invalid.example.invalid'], 'invalid.example.invalid'],
      ];
      for (const [rawHeaders, forwarded] of malformed) {
        const f = fixture();
        const c = context(route, method);
        c.request.rawHeaders = rawHeaders;
        c.request.headers['x-forwarded-for'] = forwarded;
        await expect(guardedCall(f, route, c)).rejects.toBeInstanceOf(BadRequestException);
        expect(f.admit).not.toHaveBeenCalled();
        expect(f.authorize).not.toHaveBeenCalled();
        expect(c.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(c.request.user).toBeUndefined();
        expect(c.request.authSession).toBeUndefined();
        f.noCredentialWork();
        // Each iteration owns its verifier spy; restore before constructing another fixture.
        jest.restoreAllMocks();
      }
    },
  );

  it.each(protectedPolicies)(
    'source denial prevents session and credential work on %s',
    async (route, policy, method) => {
      for (const error of [
        new AuthRequestLimitException(42),
        new ServiceUnavailableException('Authentication service unavailable'),
      ]) {
        const f = fixture();
        f.admit.mockRejectedValue(error);
        const c = context(route, method);
        await expect(guardedCall(f, route, c)).rejects.toBe(error);
        expect(f.admit).toHaveBeenCalledTimes(1);
        expect(f.admit).toHaveBeenCalledWith(policy, subject);
        expect(f.authorize).not.toHaveBeenCalled();
        expect(c.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(c.request.user).toBeUndefined();
        expect(c.request.authSession).toBeUndefined();
        f.noCredentialWork();
        jest.restoreAllMocks();
      }
    },
  );

  it('does not speculate past a pending admission decision', async () => {
    const f = fixture();
    let refuse!: (error: Error) => void;
    f.admit.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const c = context('login');
    const pending = guardedCall(f, 'login', c);
    const error = new ServiceUnavailableException('Authentication service unavailable');
    const rejected = expect(pending).rejects.toBe(error);
    await Promise.resolve();
    expect(f.admit).toHaveBeenCalledTimes(1);
    expect(f.authorize).not.toHaveBeenCalled();
    f.noCredentialWork();
    refuse(error);
    await rejected;
    f.noCredentialWork();
  });

  it.each([
    ['login', false, false, true],
    ['mfa', true, true, true],
    ['getProfile', true, false, false],
    ['logout', true, true, false],
  ] as const)(
    '%s preserves authorization arguments and selects its activity policy',
    async (route, ownerRequired, pendingAllowed, readOnly) => {
      const f = fixture();
      f.admit.mockResolvedValue(undefined);
      const error = new UnauthorizedException();
      f.authorize.mockRejectedValue(error);
      const c = context(route);
      await expect(f.guard.canActivate(c.ctx)).rejects.toBe(error);
      expect(f.authorize).toHaveBeenCalledTimes(1);
      expect(f.authorize).toHaveBeenCalledWith(
        cookie,
        ownerRequired,
        c.request.method,
        origin,
        csrf,
        pendingAllowed,
        readOnly,
      );
      expect(f.admit).toHaveBeenCalledTimes(readOnly ? 1 : 0);
      expect(c.request.user).toBeUndefined();
      f.noCredentialWork();
    },
  );

  it.each([
    ['login', ForbiddenException],
    ['mfa', UnauthorizedException],
  ] as const)(
    'actual %s session rejection spends source admission without credential lookup',
    async (route, errorType) => {
      const f = fixture();
      f.admit.mockResolvedValue(undefined);
      f.authorize.mockRestore();
      const c = context(route);
      c.request.headers.cookie = `${SESSION_COOKIE}=malformed`;
      await expect(guardedCall(f, route, c)).rejects.toBeInstanceOf(errorType);
      expect(f.admit).toHaveBeenCalledTimes(1);
      expect(f.admit).toHaveBeenCalledWith(`${route}-ip`, subject);
      f.noCredentialWork();
    },
  );
});

describe('LIMIT-002 claimed-account admission before actual AuthService credential work', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  it.each(['source', 'account'] as const)(
    'actual admission service contains a transaction failure at the %s boundary',
    async (boundary) => {
      const f = fixture();
      f.admit.mockRestore();
      // Inject only the DataSource failure; execute the real hashing, service catch,
      // guard/controller boundary and AuthService fail-on-call instrumentation.
      f.transaction.mockRejectedValue(new Error('synthetic-driver-private-detail'));
      const c = context('login');
      const operation =
        boundary === 'source'
          ? guardedCall(f, 'login', c)
          : f.controller.login(credentials, c.request, c.response as unknown as Response);
      await expect(operation).rejects.toMatchObject({
        message: 'Authentication service unavailable',
        status: 503,
      });
      expect(f.authorize).not.toHaveBeenCalled();
      f.noCredentialWork(1);
    },
  );

  it.each([429, 503])(
    'account refusal %s occurs before owner lookup and real/dummy verifier',
    async (status) => {
      const f = fixture();
      const error =
        status === 429
          ? new AuthRequestLimitException(600)
          : new ServiceUnavailableException('Authentication service unavailable');
      f.admit.mockRejectedValue(error);
      const c = context('login');
      const validated = await pipe.transform(
        { ...credentials, email: ' OWNER@EXAMPLE.INVALID ' },
        {
          type: 'body',
          metatype: LoginDto,
        },
      );
      // Direct negative controller boundary: no synthetic session is installed or authenticated.
      await expect(
        f.controller.login(validated, c.request, c.response as unknown as Response),
      ).rejects.toBe(error);
      expect(f.admit).toHaveBeenCalledTimes(1);
      expect(f.admit).toHaveBeenCalledWith('login-account', 'owner@example.invalid');
      expect(f.authorize).not.toHaveBeenCalled();
      f.noCredentialWork();
    },
  );

  it.each([
    { ...credentials, email: ['owner@example.invalid'] },
    { ...credentials, email: { toString: 'owner@example.invalid' } },
    { ...credentials, password: 123456789 },
    { ...credentials, password: { toString: 'Synthetic-password-42!' } },
    { ...credentials, unknown: 'forbidden' },
  ])('DTO refusal prevents account admission and credential work', async (body) => {
    const f = fixture();
    const c = context('login');
    const result = pipe
      .transform(body, { type: 'body', metatype: LoginDto })
      .then((validated) =>
        f.controller.login(validated, c.request, c.response as unknown as Response),
      );
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    expect(f.admit).not.toHaveBeenCalled();
    f.noCredentialWork();
  });
});

describe('LIMIT-005 actual exception filter response boundaries', () => {
  function filter() {
    const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { logger, actual: new GlobalExceptionFilter(logger as unknown as PinoLogger) };
  }

  it.each([1, 42, 600])(
    'writes typed admission Retry-After %s as an actual response header',
    (seconds) => {
      const c = context('login');
      const { actual, logger } = filter();
      actual.catch(new AuthRequestLimitException(seconds), c.ctx);
      expect(c.response.status).toHaveBeenCalledWith(429);
      expect(c.response.setHeader).toHaveBeenCalledWith('Retry-After', String(seconds));
      expect(c.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(c.response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          message: 'Too many requests',
          path: '/auth/login',
        }),
      );
      expect(JSON.stringify([c.response.json.mock.calls, logger.warn.mock.calls])).not.toContain(
        'private-marker',
      );
    },
  );

  it('does not reinterpret unrelated session/MFA429 responses as ledger denials', () => {
    const c = context('mfa');
    const { actual } = filter();
    const existing = Object.assign(new HttpException('Too many sessions', 429), {
      retryAfter: 999,
    });
    actual.catch(existing, c.ctx);
    expect(c.response.status).toHaveBeenCalledWith(429);
    expect(c.response.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Too many sessions' }),
    );
    expect(c.response.setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
  });

  it('keeps safe storage503 non-cacheable through the actual guard and filter', async () => {
    const f = fixture();
    const c = context('login');
    const { actual, logger } = filter();
    const refusal = new ServiceUnavailableException('Authentication service unavailable', {
      cause: new Error('synthetic-driver-secret-must-not-escape'),
    });
    f.admit.mockRejectedValue(refusal);
    try {
      await guardedCall(f, 'login', c);
      throw new Error('Admission unexpectedly accepted');
    } catch (error) {
      expect(error).toBe(refusal);
      actual.catch(error, c.ctx);
    }
    expect(c.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(c.response.status).toHaveBeenCalledWith(503);
    expect(c.response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        message: 'Authentication service unavailable',
      }),
    );
    expect(JSON.stringify([c.response.json.mock.calls, logger.error.mock.calls])).not.toContain(
      'synthetic-driver-secret',
    );
    f.noCredentialWork();
  });
});
