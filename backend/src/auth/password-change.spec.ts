import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AUTH_CLIENT_SOURCE } from './client-source';
import { MfaService } from './mfa.service';
import { createTotp, MfaCipher } from './mfa-crypto';
import { hashPassword, verifyPassword } from './password';
import { AUTH_REQUEST_LIMIT } from './request-limit.decorator';
import { SecurityController } from './security.controller';
import { SessionService } from './session.service';

// Source-level instrumentation of SEC-PASSWORD; the real PostgreSQL evidence is the
// acceptance profile, which this change does not extend.
const owner = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';
const currentHash = 'c'.repeat(64);
const oldPassword = 'the old synthetic password';
const newPassword = 'a new synthetic password';
const now = new Date('2026-10-10T12:00:10Z');

let directory: string;
let config: ConfigService;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-password-change-'));
  const keyFile = join(directory, 'key');
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  config = new ConfigService({ MFA_KEY_FILE: keyFile, MFA_KEY_ID: 'test-key' });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function activeFactor(secret: string, extra: Record<string, unknown> = {}) {
  return {
    userId: owner,
    activeVersion: version,
    activeEnvelope: new MfaCipher(config).encrypt(secret, owner, version),
    lastCounter: '0',
    candidateId: null,
    candidateEnvelope: null,
    candidateExpiresAt: null,
    candidateAttempts: 0,
    failedAttempts: 0,
    failureWindowStart: null,
    blockedUntil: null,
    consecutiveFailures: 0,
    ...extra,
  };
}

function harness(factor: Record<string, unknown>, storedPassword: string) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM owner_auth'))
        return [{ userId: owner, credentialVersion: 'old' }];
      if (sql.startsWith('SELECT * FROM owner_mfa')) return [factor];
      if (sql.includes('clock_timestamp() AS now')) return [{ now }];
      if (sql.startsWith('SELECT password FROM users')) return [{ password: storedPassword }];
      return [];
    }),
  };
  const source = {
    transaction: jest.fn(async (work: (value: typeof manager) => unknown) => work(manager)),
  } as unknown as DataSource;
  const sessions = { creationLock: jest.fn() } as unknown as SessionService;
  return { service: new MfaService(source, config, sessions), queries, source };
}

const at = (secret: string) => createTotp(secret).generate({ timestamp: now.getTime() });

describe('SEC-PASSWORD change the password', () => {
  const secret = createTotp().secret.base32;
  let stored: string;
  beforeAll(async () => {
    stored = await hashPassword(oldPassword);
  });

  it('is a private route that spends the mfa-ip budget and answers 204', () => {
    const handler = SecurityController.prototype.changePassword;
    expect(Reflect.getMetadata(AUTH_REQUEST_LIMIT, handler)).toBe('mfa-ip');
    expect(Reflect.getMetadata(AUTH_CLIENT_SOURCE, handler)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
  });

  it('changes it for this owner and this browser session only', async () => {
    const changePassword = jest.fn().mockResolvedValue(undefined);
    const controller = new SecurityController(
      {} as SessionService,
      { changePassword } as unknown as MfaService,
    );
    const body = { currentPassword: oldPassword, newPassword, code: '123456' };
    await controller.changePassword(
      { userId: owner, email: 'owner@example.invalid' },
      { authSession: { hash: currentHash } } as never,
      body,
    );
    expect(changePassword).toHaveBeenCalledWith(owner, currentHash, body);
  });

  it('stores an Argon2id hash, rotates the revision and keeps only this session', async () => {
    const { service, queries } = harness(activeFactor(secret), stored);
    await service.changePassword(owner, currentHash, {
      currentPassword: oldPassword,
      newPassword,
      code: at(secret),
    });
    const update = queries.find((q) => q.sql.startsWith('UPDATE users SET password'));
    const hash = update?.params?.[0] as string;
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, newPassword)).resolves.toBe(true);
    await expect(verifyPassword(hash, oldPassword)).resolves.toBe(false);
    expect(update?.params?.[1]).toBe(owner);
    const revision = queries.find((q) => q.sql.includes('UPDATE owner_auth'))?.params?.[0];
    expect(revision).toMatch(/^[0-9a-f-]{36}$/);
    const others = queries.find((q) => q.sql.includes('DELETE FROM auth_sessions'));
    expect(others?.sql).toContain('"tokenHash" <> $2');
    expect(others?.params).toEqual([owner, currentHash]);
    const kept = queries.find((q) => q.sql.startsWith('UPDATE auth_sessions'));
    expect(kept?.params).toEqual([revision, currentHash]);
    expect(queries.some((q) => q.sql.includes('UPDATE password_reset_tokens'))).toBe(true);
  });

  it('refuses a wrong current password with 422 after the factor, changing nothing', async () => {
    const { service, queries } = harness(activeFactor(secret), stored);
    const refused = service.changePassword(owner, currentHash, {
      currentPassword: 'not the current password',
      newPassword,
      code: at(secret),
    });
    await expect(refused).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(refused).rejects.toMatchObject({ response: { error: 'password' } });
    expect(queries.some((q) => q.sql.startsWith('UPDATE users'))).toBe(false);
    expect(queries.some((q) => q.sql.includes('auth_sessions'))).toBe(false);
  });

  it('refuses a new password equal to the current one', async () => {
    const { service, queries } = harness(activeFactor(secret), stored);
    await expect(
      service.changePassword(owner, currentHash, {
        currentPassword: oldPassword,
        newPassword: oldPassword,
        code: at(secret),
      }),
    ).rejects.toMatchObject({ response: { error: 'same' } });
    expect(queries.some((q) => q.sql.startsWith('UPDATE users'))).toBe(false);
  });

  it('counts a wrong TOTP as a failed factor and never reads the password', async () => {
    const { service, queries } = harness(activeFactor(secret), stored);
    await expect(
      service.changePassword(owner, currentHash, {
        currentPassword: oldPassword,
        newPassword,
        code: '000000',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(queries.some((q) => q.sql.includes('"failedAttempts" = $1'))).toBe(true);
    expect(queries.some((q) => q.sql.startsWith('SELECT password FROM users'))).toBe(false);
  });

  it('answers 429 while the owner is blocked, without checking the code', async () => {
    const { service, queries } = harness(
      activeFactor(secret, { blockedUntil: new Date(now.getTime() + 60_000) }),
      stored,
    );
    await expect(
      service.changePassword(owner, currentHash, {
        currentPassword: oldPassword,
        newPassword,
        code: at(secret),
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(queries.some((q) => q.sql.startsWith('SELECT password FROM users'))).toBe(false);
  });

  it.each([
    ['a short code', { code: '12345', newPassword }],
    ['a non-ASCII code', { code: '１２３４５６', newPassword }],
    ['a short new password', { code: '123456', newPassword: 'too short' }],
    ['a new password with a line break', { code: '123456', newPassword: `${newPassword}\n` }],
    ['no current password', { code: '123456', newPassword, currentPassword: undefined }],
  ])('rejects %s with 400 before any database work', async (_name, input) => {
    const { service, source } = harness(activeFactor(secret), stored);
    await expect(
      service.changePassword(owner, currentHash, {
        currentPassword: oldPassword,
        ...input,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(source.transaction).not.toHaveBeenCalled();
  });
});
