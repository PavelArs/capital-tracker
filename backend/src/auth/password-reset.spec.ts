import { BadRequestException, GoneException, ValidationPipe } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { createTransport } from 'nodemailer';
import { DataSource } from 'typeorm';
import { AUTH_CLIENT_SOURCE, AuthClientSourceService } from './client-source';
import { ResetConfirmDto, ResetRequestDto, ResetTokenDto } from './dto/password-reset.dto';
import { SessionGuard, SessionRequest } from './guards/session.guard';
import * as passwords from './password';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetMailer, resetMailSettings, resetMessage } from './password-reset-mailer';
import { PUBLIC_ROUTE } from './public.decorator';
import { AUTH_REQUEST_LIMIT } from './request-limit.decorator';
import { AuthRequestLimitException, AuthRequestLimitsService } from './request-limits.service';
import { SESSION_COOKIE, SessionService } from './session.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

// Negative source-level instrumentation only: the PostgreSQL probe password-reset-db and the
// browser journey RESET-UI carry the real link, session and SMTP evidence.
const origin = 'https://example.invalid';
const token = 'A'.repeat(43);
const link = `${origin}/password-reset/new#token=${token}`;
const routes = [
  ['request', 202],
  ['status', 200],
  ['confirm', 204],
] as const;

function unexpected(): never {
  throw new Error('Refused reset work reached downstream code');
}

afterEach(() => jest.restoreAllMocks());

describe('RESET-LIMIT reset routes share one admission policy', () => {
  it.each(routes)('%s is public, admitted as reset-ip and answers %i', (route, status) => {
    const handler = PasswordResetController.prototype[route];
    expect(Reflect.getMetadata(PUBLIC_ROUTE, handler)).toBe(true);
    expect(Reflect.getMetadata(AUTH_REQUEST_LIMIT, handler)).toBe('reset-ip');
    expect(Reflect.getMetadata(AUTH_CLIENT_SOURCE, handler)).toBe(true);
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, handler)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(status);
  });

  function guarded(route: (typeof routes)[number][0]) {
    const reflector = new Reflector();
    const source = new DataSource({ type: 'postgres' });
    const sessions = new SessionService(source, new ConfigService({ FRONTEND_URL: origin }));
    const authorize = jest.spyOn(sessions, 'authorize');
    const limits = new AuthRequestLimitsService(source);
    const admit = jest.spyOn(limits, 'admit');
    const sources = new AuthClientSourceService(
      new ConfigService({ TRUSTED_PROXY_IPS: '["192.0.2.10"]' }),
      reflector,
    );
    const guard = new SessionGuard(reflector, sessions, sources, limits);
    const request = {
      method: 'POST',
      url: `/auth/password-reset/${route}`,
      ip: '192.0.2.10',
      socket: { remoteAddress: '192.0.2.10' },
      rawHeaders: ['X-Forwarded-For', '198.51.100.9'],
      headers: {
        cookie: `${SESSION_COOKIE}=${'B'.repeat(43)}`,
        origin,
        'x-csrf-token': 'C'.repeat(43),
        'x-forwarded-for': '198.51.100.9',
      },
    } as unknown as SessionRequest;
    const response = { setHeader: jest.fn() };
    const ctx = new ExecutionContextHost(
      [request, response],
      PasswordResetController,
      PasswordResetController.prototype[route],
    );
    return { guard, ctx, admit, authorize };
  }

  it.each(routes)('a refused %s admission never reaches the session', async (route) => {
    const f = guarded(route);
    const refusal = new AuthRequestLimitException(60);
    f.admit.mockRejectedValue(refusal);
    f.authorize.mockImplementation(unexpected);
    await expect(f.guard.canActivate(f.ctx)).rejects.toBe(refusal);
    expect(f.admit).toHaveBeenCalledWith('reset-ip', 'v4:198.51.100.9/32');
    expect(f.authorize).not.toHaveBeenCalled();
  });

  it.each(routes)('%s needs an anonymous session, Origin and CSRF but no owner', async (route) => {
    const f = guarded(route);
    f.admit.mockResolvedValue(undefined);
    const refusal = new BadRequestException();
    f.authorize.mockRejectedValue(refusal);
    await expect(f.guard.canActivate(f.ctx)).rejects.toBe(refusal);
    expect(f.authorize).toHaveBeenCalledWith(
      'B'.repeat(43),
      false,
      'POST',
      origin,
      'C'.repeat(43),
      false,
      true,
    );
  });
});

describe('RESET-REQUEST input boundary', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const validate = (metatype: typeof ResetRequestDto | typeof ResetTokenDto, body: unknown) =>
    pipe.transform(body, { type: 'body', metatype });

  it('normalizes the email and keeps every password character', async () => {
    await expect(
      validate(ResetRequestDto, { email: ' OWNER@EXAMPLE.INVALID ' }),
    ).resolves.toMatchObject({ email: 'owner@example.invalid' });
    const password = '  Synthetic-reset-password-42! é ';
    await expect(validate(ResetConfirmDto, { token, password })).resolves.toMatchObject({
      token,
      password,
    });
  });

  it.each([
    [ResetRequestDto, { email: ['owner@example.invalid'] }],
    [ResetRequestDto, { email: { toString: 'owner@example.invalid' } }],
    [ResetRequestDto, { email: 'not-an-email' }],
    [ResetTokenDto, { token: [token] }],
    [ResetTokenDto, { token: 'A'.repeat(65) }],
    [ResetConfirmDto, { token, password: ['Synthetic-reset-password-42!'] }],
    [ResetConfirmDto, { token, password: 'x'.repeat(1025) }],
    [ResetTokenDto, { token, extra: true }],
  ] as const)('rejects malformed input with a bounded client error', async (metatype, body) => {
    await expect(validate(metatype, body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PasswordResetService refusals before any write', () => {
  function service(rows: unknown[] = []) {
    const query = jest.fn().mockResolvedValue(rows);
    const transaction = jest.fn(unexpected);
    const source = { query, transaction } as unknown as DataSource;
    const sessions = { origin } as unknown as SessionService;
    const send = jest.fn(unexpected);
    const mailer = { sendPasswordReset: send } as unknown as PasswordResetMailer;
    const hash = jest.spyOn(passwords, 'hashPassword').mockImplementation(unexpected);
    return {
      resets: new PasswordResetService(source, sessions, mailer),
      query,
      transaction,
      send,
      hash,
    };
  }

  it.each([undefined, '', 'not-an-email', `${'a'.repeat(250)}@x.io`, ['owner@example.invalid']])(
    'answers a request for %p without reading the owner or sending mail',
    async (email) => {
      const f = service();
      await expect(f.resets.request(email)).resolves.toBeUndefined();
      expect(f.transaction).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'A'.repeat(42), `${'A'.repeat(42)}=`, 'A'.repeat(44)])(
    'treats the malformed token %p as an invalid link without a query',
    async (value) => {
      const f = service();
      await expect(f.resets.status(value)).resolves.toBe('invalid');
      await expect(f.resets.confirm(value, 'Synthetic-reset-password-42!')).rejects.toMatchObject({
        response: { error: 'invalid' },
      });
      expect(f.query).not.toHaveBeenCalled();
      expect(f.hash).not.toHaveBeenCalled();
    },
  );

  it.each([
    [[], 'invalid'],
    [[{ id: 'l', userId: 'u', expired: false, finished: true }], 'invalid'],
    [[{ id: 'l', userId: 'u', expired: true, finished: false }], 'expired'],
    [[{ id: 'l', userId: 'u', expired: false, finished: false }], 'valid'],
  ] as const)('reads the stored link %j as %s', async (rows, state) => {
    const f = service([...rows]);
    await expect(f.resets.status(token)).resolves.toBe(state);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('"tokenHash" = $1'), [
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(f.query.mock.calls[0][1][0]).not.toContain(token);
  });

  it('refuses an expired link with 410 before hashing the new password', async () => {
    const f = service([{ id: 'l', userId: 'u', expired: true, finished: false }]);
    const refusal = f.resets.confirm(token, 'Synthetic-reset-password-42!');
    await expect(refusal).rejects.toBeInstanceOf(GoneException);
    await expect(refusal).rejects.toMatchObject({ response: { error: 'expired' } });
    expect(f.hash).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it.each(['too-short', 'x'.repeat(129), 'Synthetic-reset\npassword-42!', 42])(
    'refuses the password %p with 400 and changes nothing',
    async (password) => {
      const f = service([{ id: 'l', userId: 'u', expired: false, finished: false }]);
      await expect(f.resets.confirm(token, password)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.hash).not.toHaveBeenCalled();
      expect(f.transaction).not.toHaveBeenCalled();
    },
  );
});

describe('PasswordResetMailer (Yandex SMTP)', () => {
  const transport = createTransport as unknown as jest.Mock;
  beforeEach(() => transport.mockReset());

  it('defaults to Yandex implicit TLS and reads credentials only from the environment', () => {
    expect(resetMailSettings(() => undefined)).toEqual({
      host: 'smtp.yandex.ru',
      port: 465,
      user: null,
      password: null,
      from: null,
    });
    const env: Record<string, string> = {
      SMTP_HOST: ' smtp.example.invalid ',
      SMTP_PORT: '2465',
      SMTP_USER: 'mailer@example.invalid',
      SMTP_PASSWORD: 'synthetic-app-password',
      SMTP_FROM: ' ',
    };
    expect(resetMailSettings((key) => env[key])).toEqual({
      host: 'smtp.example.invalid',
      port: 2465,
      user: 'mailer@example.invalid',
      password: 'synthetic-app-password',
      from: null,
    });
    expect(resetMailSettings((key) => ({ SMTP_PORT: '99999' })[key]).port).toBe(465);
  });

  it('says what the link does and how long it lasts', () => {
    const { subject, text } = resetMessage(link);
    expect(subject).toBe('Reset your Capital Tracker password');
    expect(text).toContain(link);
    expect(text).toContain('works once and expires in 30 minutes');
    expect(text).toContain('authenticator code');
  });

  it('sends nothing without credentials and says which settings are missing', async () => {
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn');
    warn.mockImplementation(() => undefined);
    const mailer = new PasswordResetMailer(resetMailSettings(() => undefined));
    expect(mailer.configured).toBe(false);
    await mailer.sendPasswordReset('owner@example.invalid', link);
    expect(transport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_USER and SMTP_PASSWORD'));
  });

  it('sends from the SMTP account over TLS and logs only the failure code', async () => {
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn');
    warn.mockImplementation(() => undefined);
    const sendMail = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        Object.assign(new Error(`535 ${link}`), { code: 'EAUTH', responseCode: 535 }),
      );
    transport.mockReturnValue({ sendMail });
    const env: Record<string, string> = {
      SMTP_USER: 'mailer@example.invalid',
      SMTP_PASSWORD: 'synthetic-app-password',
    };
    const mailer = new PasswordResetMailer(resetMailSettings((key) => env[key]));
    expect(mailer.configured).toBe(true);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.yandex.ru',
        port: 465,
        secure: true,
        auth: { user: 'mailer@example.invalid', pass: 'synthetic-app-password' },
        tls: { minVersion: 'TLSv1.2', servername: 'smtp.yandex.ru' },
      }),
    );
    await mailer.sendPasswordReset('owner@example.invalid', link);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'mailer@example.invalid', to: 'owner@example.invalid' }),
    );
    await expect(mailer.sendPasswordReset('owner@example.invalid', link)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Password reset email was not sent (EAUTH 535)');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });
});
