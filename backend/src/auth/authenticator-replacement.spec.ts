import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  GoneException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AUTH_CLIENT_SOURCE } from './client-source';
import { MfaService } from './mfa.service';
import { createTotp, MfaCipher, recoveryHash } from './mfa-crypto';
import { AUTH_REQUEST_LIMIT } from './request-limit.decorator';
import { SecurityController } from './security.controller';
import { SessionService } from './session.service';

// Source-level instrumentation of SEC-TOTP: the browser journey in
// tests/e2e/security-settings.spec.ts carries the real PostgreSQL and session evidence.
const owner = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';
const currentHash = 'c'.repeat(64);
const recovery = 'aaaaaaaa-bbbbbbbb-cccccccc-dddddddd';

let directory: string;
let config: ConfigService;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-mfa-replace-'));
  const keyFile = join(directory, 'key');
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  config = new ConfigService({ MFA_KEY_FILE: keyFile, MFA_KEY_ID: 'test-key' });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

interface Fixture {
  now: Date;
  factor: Record<string, unknown>;
  recoveryUnused?: boolean;
}

function harness({ now, factor, recoveryUnused = false }: Fixture) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM owner_auth'))
        return [{ userId: owner, credentialVersion: 'old' }];
      if (sql.startsWith('SELECT * FROM owner_mfa')) return [factor];
      if (sql.includes('clock_timestamp() AS now')) return [{ now }];
      if (sql.includes('UPDATE owner_mfa_recovery'))
        return recoveryUnused ? [[{ codeHash: 'x' }], 1] : [[], 0];
      if (sql.includes('RETURNING "candidateExpiresAt"'))
        return [[{ candidateExpiresAt: new Date(now.getTime() + 600_000) }], 1];
      return [];
    }),
  };
  const source = {
    transaction: jest.fn(async (work: (value: typeof manager) => unknown) => work(manager)),
  } as unknown as DataSource;
  const sessions = { creationLock: jest.fn() } as unknown as SessionService;
  return { service: new MfaService(source, config, sessions), queries, source };
}

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

const at = (now: Date, secret: string) => createTotp(secret).generate({ timestamp: now.getTime() });

describe('SEC-TOTP routes', () => {
  it.each([
    ['prepareAuthenticator', 200],
    ['confirmAuthenticator', 200],
  ] as const)('%s spends the mfa-ip budget like a sign-in factor', (route, status) => {
    const handler = SecurityController.prototype[route];
    expect(Reflect.getMetadata(AUTH_REQUEST_LIMIT, handler)).toBe('mfa-ip');
    expect(Reflect.getMetadata(AUTH_CLIENT_SOURCE, handler)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(status);
  });

  it('confirms for the signed-in owner and this browser session only', async () => {
    const confirmReplacement = jest.fn().mockResolvedValue(['code']);
    const controller = new SecurityController(
      {} as SessionService,
      { confirmReplacement } as unknown as MfaService,
    );
    await expect(
      controller.confirmAuthenticator(
        { userId: owner, email: 'owner@example.invalid' },
        { authSession: { hash: currentHash } } as never,
        { candidateId: version, code: '123456' },
      ),
    ).resolves.toEqual({ recoveryCodes: ['code'] });
    expect(confirmReplacement).toHaveBeenCalledWith(owner, currentHash, version, '123456');
  });
});

describe('SEC-TOTP prepare a new authenticator after a fresh factor', () => {
  const now = new Date('2026-10-09T12:00:10Z');
  const secret = createTotp().secret.base32;

  it('answers a new key, its URI and a ten-minute candidate after the current TOTP', async () => {
    const { service, queries } = harness({ now, factor: activeFactor(secret) });
    const result = await service.prepareReplacement(owner, { kind: 'totp', code: at(now, secret) });
    expect(Object.keys(result).sort()).toEqual(['candidateId', 'expiresAt', 'secret', 'uri']);
    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.secret).not.toBe(secret);
    expect(result.uri).toContain(`secret=${result.secret}`);
    expect(result.expiresAt).toBe('2026-10-09T12:10:10.000Z');
    const counter = Math.floor(now.getTime() / 30000);
    expect(
      queries.some((q) => q.sql.includes('"lastCounter" = $1') && q.params?.[0] === counter),
    ).toBe(true);
    const stored = queries.find((q) => q.sql.includes('"candidateEnvelope" = $2'));
    expect(stored?.params?.[0]).toBe(result.candidateId);
    expect(JSON.stringify(stored?.params)).not.toContain(result.secret);
    // The active factor and its recovery codes stay until the new one is confirmed.
    expect(queries.some((q) => q.sql.includes('"activeVersion" ='))).toBe(false);
    expect(queries.some((q) => q.sql.includes('owner_mfa_recovery'))).toBe(false);
  });

  it('spends an unused recovery code instead of a TOTP', async () => {
    const { service, queries } = harness({
      now,
      factor: activeFactor(secret),
      recoveryUnused: true,
    });
    await expect(
      service.prepareReplacement(owner, { kind: 'recovery', code: recovery }),
    ).resolves.toMatchObject({ secret: expect.any(String) });
    const spent = queries.find((q) => q.sql.includes('UPDATE owner_mfa_recovery'));
    expect(spent?.params?.[1]).toBe(recoveryHash(recovery, owner, version));
  });

  it.each([
    ['a wrong TOTP', { kind: 'totp', code: '000000' }, false],
    ['a replayed TOTP', { kind: 'totp', code: 'replay' }, false],
    ['a used recovery code', { kind: 'recovery', code: recovery }, false],
  ] as const)('refuses %s with 422 and counts the failure', async (_name, input, unused) => {
    const replayed = input.code === 'replay';
    const counter = Math.floor(now.getTime() / 30000);
    const { service, queries } = harness({
      now,
      factor: activeFactor(secret, replayed ? { lastCounter: String(counter) } : {}),
      recoveryUnused: unused,
    });
    const code = replayed ? at(now, secret) : input.code;
    await expect(
      service.prepareReplacement(owner, { kind: input.kind, code }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const failure = queries.find((q) => q.sql.includes('"failedAttempts" = $1'));
    expect(failure?.params?.slice(0, 1)).toEqual([1]);
    expect(queries.some((q) => q.sql.includes('"candidateEnvelope" = $2'))).toBe(false);
  });

  it('answers 429 while the owner is blocked, without checking the code', async () => {
    const { service, queries } = harness({
      now,
      factor: activeFactor(secret, { blockedUntil: new Date(now.getTime() + 60_000) }),
    });
    const refused = service.prepareReplacement(owner, { kind: 'totp', code: at(now, secret) });
    await expect(refused).rejects.toBeInstanceOf(HttpException);
    await expect(refused).rejects.toMatchObject({ status: 429 });
    expect(queries.some((q) => q.sql.includes('"lastCounter" = $1'))).toBe(false);
  });

  it.each([
    [{ kind: 'totp', code: '12345' }],
    [{ kind: 'totp', code: '１２３４５６' }],
    [{ kind: 'recovery', code: 'aaaaaaaabbbbbbbbccccccccdddddddd' }],
    [{ kind: 'sms', code: '123456' }],
    [undefined],
  ])('rejects malformed input %j with 400 before any database work', async (input) => {
    const { service, source } = harness({ now, factor: activeFactor(secret) });
    await expect(service.prepareReplacement(owner, input as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(source.transaction).not.toHaveBeenCalled();
  });
});

describe('SEC-TOTP confirm the new authenticator', () => {
  const now = new Date('2026-10-09T12:03:00Z');
  const secret = createTotp().secret.base32;
  const candidate = '33333333-3333-4333-8333-333333333333';
  const pending = (extra: Record<string, unknown> = {}) => {
    const cipher = new MfaCipher(config);
    return activeFactor(createTotp().secret.base32, {
      candidateId: candidate,
      candidateEnvelope: cipher.encrypt(secret, owner, candidate),
      candidateExpiresAt: new Date(now.getTime() + 60_000),
      ...extra,
    });
  };

  it('activates it, replaces the recovery codes and keeps only this session', async () => {
    const { service, queries } = harness({ now, factor: pending() });
    const codes = await service.confirmReplacement(owner, currentHash, candidate, at(now, secret));
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const sql = queries.map((q) => q.sql);
    expect(sql.some((q) => q.includes('"activeVersion" = "candidateId"'))).toBe(true);
    const inserted = queries.filter((q) => q.sql.includes('INSERT INTO owner_mfa_recovery'));
    expect(inserted.map((q) => q.params?.[2])).toEqual(Array(10).fill(candidate));
    const revision = queries.find((q) => q.sql.includes('UPDATE owner_auth'))?.params?.[0];
    expect(revision).toMatch(/^[0-9a-f-]{36}$/);
    const others = queries.find((q) => q.sql.includes('DELETE FROM auth_sessions'));
    expect(others?.sql).toContain('"tokenHash" <> $2');
    expect(others?.params).toEqual([owner, currentHash]);
    const kept = queries.find((q) => q.sql.includes('UPDATE auth_sessions'));
    expect(kept?.params).toEqual([revision, currentHash]);
  });

  it('counts a wrong code against the candidate and answers 422', async () => {
    const { service, queries } = harness({ now, factor: pending() });
    await expect(
      service.confirmReplacement(owner, currentHash, candidate, '000000'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(queries.some((q) => q.sql.includes('"candidateAttempts" + 1'))).toBe(true);
    expect(queries.some((q) => q.sql.includes('"activeVersion" = "candidateId"'))).toBe(false);
  });

  it.each([
    ['the fifth wrong code', { candidateAttempts: 4 }, '000000'],
    ['an expired candidate', { candidateExpiresAt: new Date(now.getTime() - 1) }, 'ok'],
    ['an exhausted candidate', { candidateAttempts: 5 }, 'ok'],
    ['another candidate', { candidateId: version }, 'ok'],
  ])('answers 410 for %s; nothing changes', async (_name, extra, code) => {
    const { service, queries } = harness({ now, factor: pending(extra) });
    await expect(
      service.confirmReplacement(
        owner,
        currentHash,
        candidate,
        code === 'ok' ? at(now, secret) : code,
      ),
    ).rejects.toBeInstanceOf(GoneException);
    expect(queries.some((q) => q.sql.includes('"activeVersion" = "candidateId"'))).toBe(false);
    expect(queries.some((q) => q.sql.includes('auth_sessions'))).toBe(false);
  });

  it.each([
    [candidate, '12345'],
    [candidate, 123456],
    ['not-a-candidate', '123456'],
    [undefined, '123456'],
  ])('rejects malformed candidate %j / code %j with 400', async (id, code) => {
    const { service, source } = harness({ now, factor: pending() });
    await expect(service.confirmReplacement(owner, currentHash, id, code)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(source.transaction).not.toHaveBeenCalled();
  });
});
