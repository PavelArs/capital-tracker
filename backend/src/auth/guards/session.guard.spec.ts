import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { DataSource } from 'typeorm';
import { AuthClientSourceService } from '../client-source';
import { PUBLIC_ROUTE } from '../public.decorator';
import { AuthRequestLimitsService } from '../request-limits.service';
import { readSessionCookie, SESSION_COOKIE, SessionService } from '../session.service';
import { SessionGuard } from './session.guard';

describe('CHAR-AUTH-001 / SES-001-D real default-deny session boundary', () => {
  const source = new DataSource({ type: 'postgres' });
  const sessions = new SessionService(
    source,
    new ConfigService({ FRONTEND_URL: 'https://example.invalid' }),
  );
  const guard = new SessionGuard(
    new Reflector(),
    sessions,
    new AuthClientSourceService(new ConfigService({ TRUSTED_PROXY_IPS: '[]' }), new Reflector()),
    new AuthRequestLimitsService(source),
  );
  function context(headers: Record<string, string | undefined>, publicRoute = false) {
    const handler = () => {};
    if (publicRoute) Reflect.defineMetadata(PUBLIC_ROUTE, true, handler);
    const request = { headers, method: 'GET', user: undefined };
    const response = { setHeader: jest.fn() };
    return {
      request,
      response,
      ctx: new ExecutionContextHost([request, response], class TestController {}, handler),
    };
  }
  it.each([
    {},
    { authorization: 'Bearer synthetic-legacy-token' },
    { cookie: `${SESSION_COOKIE}=malformed` },
    { cookie: `${SESSION_COOKIE}=${'A'.repeat(43)}; ${SESSION_COOKIE}=${'B'.repeat(43)}` },
  ])(
    'denies absent, malformed, duplicate or bearer credentials without DB connection',
    async (headers) => {
      const { request, response, ctx } = context(headers);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
      expect(source.isInitialized).toBe(false);
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    },
  );
  it('permits only explicit public GET metadata without adding an owner', async () => {
    const { request, ctx } = context({}, true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });
  it('reads only one exact cookie name and value', () => {
    expect(readSessionCookie(`other=value; ${SESSION_COOKIE}=${'A'.repeat(43)}`)).toBe(
      'A'.repeat(43),
    );
    expect(readSessionCookie(`${SESSION_COOKIE}=%41`)).toBeNull();
    expect(readSessionCookie(`prefix${SESSION_COOKIE}=${'A'.repeat(43)}`)).toBeNull();
  });
  it.each([
    'http://example.invalid',
    'https://example.invalid/',
    'https://user:pass@example.invalid',
    'https://example.invalid/path',
    'null',
    '',
  ])('rejects unsafe origin configuration %s', (origin) => {
    expect(() => new SessionService(source, new ConfigService({ FRONTEND_URL: origin }))).toThrow(
      'exact HTTPS origin',
    );
  });
});
