import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { FactorInput, MfaService } from './mfa.service';
import { createTotp, MfaCipher, recoveryHash } from './mfa-crypto';
import { SessionService } from './session.service';

// Source-level pin of factor completion: every check, its order and every write, with the
// exact SQL and parameters. tests/e2e/mfa-db.cjs carries the real PostgreSQL evidence.
const owner = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';
const hash = 'p'.repeat(64);
const recovery = 'AAAAAAAA-bbbbbbbb-cccccccc-dddddddd';
const now = new Date('2026-10-09T12:00:10Z');
const counter = Math.floor(now.getTime() / 30000);
const secret = createTotp().secret.base32;
const issued = { token: 'synthetic-token', csrfToken: 'synthetic-csrf' };
const user = { id: owner, email: 'owner@example.invalid' };

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const SQL = {
  lockTimeout: "SET LOCAL lock_timeout = '5s'",
  owner: 'SELECT * FROM owner_auth WHERE id = 1 FOR UPDATE',
  factor: 'SELECT * FROM owner_mfa WHERE id = 1 AND "userId" = $1 FOR UPDATE',
  fullSessions: `SELECT "tokenHash" FROM auth_sessions WHERE state = 'authenticated' ORDER BY "tokenHash" FOR UPDATE`,
  recoveryLock:
    'SELECT "codeHash" FROM owner_mfa_recovery WHERE "codeHash" = $1 AND "userId" = $2 AND "enrollmentVersion" = $3 FOR UPDATE',
  now: 'SELECT clock_timestamp() AS now',
  counter: 'UPDATE owner_mfa SET "lastCounter" = $1 WHERE id = 1',
  spendRecovery:
    'UPDATE owner_mfa_recovery SET "usedAt" = $1 WHERE "codeHash" = $2 AND "userId" = $3 AND "enrollmentVersion" = $4 AND "usedAt" IS NULL RETURNING "codeHash"',
  failure:
    'UPDATE owner_mfa SET "failedAttempts" = $1, "failureWindowStart" = $2, "blockedUntil" = $3, "consecutiveFailures" = $4 WHERE id = 1',
  retire: 'DELETE FROM auth_sessions WHERE "tokenHash" = $1',
  strike: 'UPDATE auth_sessions SET "failedAttempts" = "failedAttempts" + 1 WHERE "tokenHash" = $1',
  reset:
    'UPDATE owner_mfa SET "failedAttempts" = 0, "failureWindowStart" = NULL, "blockedUntil" = NULL, "consecutiveFailures" = 0 WHERE id = 1',
  user: 'SELECT id, email, "createdAt", "updatedAt" FROM users WHERE id = $1',
};

let directory: string;
let config: ConfigService;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-mfa-complete-'));
  const keyFile = join(directory, 'key');
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  config = new ConfigService({ MFA_KEY_FILE: keyFile, MFA_KEY_ID: 'test-key' });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function activeFactor(extra: Record<string, unknown> = {}) {
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

function pendingSession(extra: Record<string, unknown> = {}) {
  return {
    tokenHash: hash,
    state: 'pending_mfa',
    userId: owner,
    credentialVersion: 'revision',
    expiresAt: new Date(now.getTime() + 1),
    failedAttempts: 0,
    ...extra,
  };
}

interface Fixture {
  ownerRow?: Record<string, unknown> | null;
  factor?: Record<string, unknown> | null;
  pending?: Record<string, unknown>;
  valid?: boolean;
  recoveryUnused?: boolean;
}

// The fake database's answer to each query of factor completion.
function answer(
  sql: string,
  rows: { ownerRow: unknown; factor: unknown; recoveryUnused?: boolean },
): unknown[] {
  if (sql.startsWith('SELECT * FROM owner_auth')) return rows.ownerRow ? [rows.ownerRow] : [];
  if (sql.startsWith('SELECT * FROM owner_mfa')) return rows.factor ? [rows.factor] : [];
  if (sql.includes('clock_timestamp() AS now')) return [{ now }];
  if (sql.includes('UPDATE owner_mfa_recovery'))
    return rows.recoveryUnused ? [[{ codeHash: 'x' }], 1] : [[], 0];
  if (sql.startsWith('SELECT id, email')) return [user];
  return [];
}

function harness(fixture: Fixture = {}) {
  const rows = {
    ownerRow:
      fixture.ownerRow === undefined
        ? { userId: owner, credentialVersion: 'revision' }
        : fixture.ownerRow,
    factor: fixture.factor === undefined ? activeFactor() : fixture.factor,
    recoveryUnused: fixture.recoveryUnused,
  };
  const pending = fixture.pending ?? pendingSession();
  const log: unknown[][] = [];
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      log.push(params === undefined ? [flat(sql)] : [flat(sql), params]);
      return answer(sql, rows);
    }),
  };
  const source = {
    transaction: jest.fn(async (work: (value: typeof manager) => unknown) => work(manager)),
  } as unknown as DataSource;
  const sessions = {
    creationLock: jest.fn(async () => {
      log.push(['creationLock']);
    }),
    row: jest.fn(async (_manager: unknown, value: string) => {
      log.push(['row', value]);
      return pending;
    }),
    valid: jest.fn(() => {
      log.push(['valid']);
      return fixture.valid ?? true;
    }),
    issueAuthenticated: jest.fn(async (...args: unknown[]) => {
      log.push(['issueAuthenticated', ...args.slice(1)]);
      return { ...issued, user };
    }),
  } as unknown as SessionService;
  return { service: new MfaService(source, config, sessions), log, source, pending };
}

const totpAt = (at: Date) => createTotp(secret).generate({ timestamp: at.getTime() });
// A well-formed code that no step of the one-step window accepts.
const wrongTotp = () => {
  const valid = [-30000, 0, 30000].map((offset) => totpAt(new Date(now.getTime() + offset)));
  for (let value = 0; ; value++) {
    const code = String(value).padStart(6, '0');
    if (!valid.includes(code)) return code;
  }
};

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException)
      return { class: error.constructor.name, status: error.getStatus(), message: error.message };
    return { raw: error };
  }
  return 'resolved';
}

const unauthorized = { class: 'UnauthorizedException', status: 401, message: 'Unauthorized' };
const counted = { class: 'HttpException', status: 401, message: 'Unauthorized' };
const tooMany = { class: 'HttpException', status: 429, message: 'Too many attempts' };
const opening = [
  [SQL.lockTimeout],
  [SQL.owner],
  [SQL.factor, [owner]],
  ['creationLock'],
  ['row', hash],
  ['valid'],
];
const recoveryParams = [recoveryHash(recovery, owner, version), owner, version];

describe('MFA-COMPLETE refusals before the factor is checked', () => {
  it('refuses without an owner binding before reading the factor', async () => {
    const { service, log } = harness({ ownerRow: null });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: totpAt(now) }))).toEqual(
      unauthorized,
    );
    expect(log).toEqual([[SQL.lockTimeout], [SQL.owner]]);
  });

  it.each([
    ['no factor row', () => null],
    ['no active enrollment', () => activeFactor({ activeVersion: null })],
  ])('refuses %s before the session capacity lock', async (_name, factor) => {
    const { service, log } = harness({ factor: factor() });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: totpAt(now) }))).toEqual(
      unauthorized,
    );
    expect(log).toEqual([[SQL.lockTimeout], [SQL.owner], [SQL.factor, [owner]]]);
  });

  it.each([
    ['an invalid session', {}, false],
    ['an anonymous session', { state: 'anonymous' }, true],
    ['a full session', { state: 'authenticated' }, true],
    ['another user', { userId: '33333333-3333-4333-8333-333333333333' }, true],
    ['an older credential revision', { credentialVersion: 'older' }, true],
  ])('refuses %s before locking full sessions', async (_name, extra, valid) => {
    const { service, log } = harness({ pending: pendingSession(extra), valid });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: totpAt(now) }))).toEqual(
      unauthorized,
    );
    expect(log).toEqual(opening);
  });

  it.each([
    ['totp', { kind: 'totp', code: totpAt(now) }, []],
    ['recovery', { kind: 'recovery', code: recovery }, [[SQL.recoveryLock, recoveryParams]]],
  ] as const)(
    'refuses a %s factor on a pending session expired at the database clock',
    async (_name, input, locks) => {
      const { service, log } = harness({ pending: pendingSession({ expiresAt: now }) });
      expect(await refusal(service.complete(hash, input as FactorInput))).toEqual(unauthorized);
      expect(log).toEqual([...opening, [SQL.fullSessions], ...locks, [SQL.now]]);
    },
  );

  it.each([
    ['a hundred failures in a row', { consecutiveFailures: 100 }],
    ['the owner cooldown', { blockedUntil: new Date(now.getTime() + 1) }],
  ])('answers 429 during %s without decrypting or counting', async (_name, extra) => {
    const { service, log } = harness({
      factor: activeFactor({ ...extra, activeEnvelope: { broken: true } }),
    });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: totpAt(now) }))).toEqual(
      tooMany,
    );
    expect(log).toEqual([...opening, [SQL.fullSessions], [SQL.now]]);
  });

  it.each([
    ['totp', { kind: 'totp', code: totpAt(now) }, []],
    ['recovery', { kind: 'recovery', code: recovery }, [[SQL.recoveryLock, recoveryParams]]],
  ] as const)(
    'fails a %s factor closed on an undecryptable envelope, without counting',
    async (_name, input, locks) => {
      const { service, log } = harness({
        factor: activeFactor({ activeEnvelope: { broken: true } }),
        recoveryUnused: true,
      });
      expect(await refusal(service.complete(hash, input as FactorInput))).toEqual(unauthorized);
      expect(log).toEqual([...opening, [SQL.fullSessions], ...locks, [SQL.now]]);
    },
  );
});

describe('MFA-COMPLETE accepted factors', () => {
  const issuedLog = (pending: unknown, device: string | null) => [
    [SQL.reset],
    [SQL.user, [owner]],
    ['issueAuthenticated', pending, { user, credentialVersion: 'revision' }, device],
  ];

  it('accepts a TOTP step newer than the last one and issues the full session', async () => {
    const { service, log, pending } = harness();
    await expect(
      service.complete(hash, { kind: 'totp', code: totpAt(now) }, 'Safari on iPhone'),
    ).resolves.toEqual({ ...issued, user });
    expect(log).toEqual([
      ...opening,
      [SQL.fullSessions],
      [SQL.now],
      [SQL.counter, [counter]],
      ...issuedLog(pending, 'Safari on iPhone'),
    ]);
  });

  it('accepts once a cooldown ended exactly now, with no device by default', async () => {
    const { service, log, pending } = harness({
      factor: activeFactor({ blockedUntil: now, consecutiveFailures: 99 }),
    });
    await expect(service.complete(hash, { kind: 'totp', code: totpAt(now) })).resolves.toEqual({
      ...issued,
      user,
    });
    expect(log).toEqual([
      ...opening,
      [SQL.fullSessions],
      [SQL.now],
      [SQL.counter, [counter]],
      ...issuedLog(pending, null),
    ]);
  });

  it('spends an unused recovery code of the active enrollment', async () => {
    const { service, log, pending } = harness({ recoveryUnused: true });
    await expect(service.complete(hash, { kind: 'recovery', code: recovery })).resolves.toEqual({
      ...issued,
      user,
    });
    expect(log).toEqual([
      ...opening,
      [SQL.fullSessions],
      [SQL.recoveryLock, recoveryParams],
      [SQL.now],
      [SQL.spendRecovery, [now, ...recoveryParams]],
      ...issuedLog(pending, null),
    ]);
  });
});

describe('MFA-COMPLETE counted failures', () => {
  const firstFailure = [1, now, null, 1];

  it.each([
    ['a replayed TOTP step', () => totpAt(now), { lastCounter: String(counter) }],
    ['an older TOTP step', () => totpAt(now), { lastCounter: String(counter + 1) }],
    ['a wrong TOTP', wrongTotp, {}],
  ])('counts %s against the owner and the challenge', async (_name, code, extra) => {
    const { service, log } = harness({ factor: activeFactor(extra) });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: code() }))).toEqual(counted);
    expect(log).toEqual([
      ...opening,
      [SQL.fullSessions],
      [SQL.now],
      [SQL.failure, firstFailure],
      [SQL.strike, [hash]],
    ]);
  });

  it('counts a used or unknown recovery code', async () => {
    const { service, log } = harness({ recoveryUnused: false });
    expect(await refusal(service.complete(hash, { kind: 'recovery', code: recovery }))).toEqual(
      counted,
    );
    expect(log).toEqual([
      ...opening,
      [SQL.fullSessions],
      [SQL.recoveryLock, recoveryParams],
      [SQL.now],
      [SQL.spendRecovery, [now, ...recoveryParams]],
      [SQL.failure, firstFailure],
      [SQL.strike, [hash]],
    ]);
  });

  it('retires the challenge on its fifth failure', async () => {
    const { service, log } = harness({ pending: pendingSession({ failedAttempts: 4 }) });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: wrongTotp() }))).toEqual(
      counted,
    );
    expect(log.slice(-2)).toEqual([
      [SQL.failure, firstFailure],
      [SQL.retire, [hash]],
    ]);
  });

  it('answers 429 on the tenth failure of the owner window and starts the cooldown', async () => {
    const windowStart = new Date(now.getTime() - 60_000);
    const { service, log } = harness({
      factor: activeFactor({ failedAttempts: 9, failureWindowStart: windowStart }),
      pending: pendingSession({ failedAttempts: 3 }),
    });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: wrongTotp() }))).toEqual(
      tooMany,
    );
    expect(log.slice(-2)).toEqual([
      [SQL.failure, [10, windowStart, new Date(now.getTime() + 600_000), 1]],
      [SQL.strike, [hash]],
    ]);
  });

  it('answers 429 on the hundredth failure in a row', async () => {
    const { service, log } = harness({ factor: activeFactor({ consecutiveFailures: 99 }) });
    expect(await refusal(service.complete(hash, { kind: 'totp', code: wrongTotp() }))).toEqual(
      tooMany,
    );
    expect(log.slice(-2)).toEqual([
      [SQL.failure, [1, now, null, 100]],
      [SQL.strike, [hash]],
    ]);
  });
});
