'use strict';

// Real PostgreSQL + production services for Settings → Security (M18): the session list,
// logging out one session or every session, and new recovery codes confirmed with a TOTP.
// No provider is involved; the factor comes from the real MFA CLI enrollment.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { enroll } = require('./mfa-db.cjs');

const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_security_settings_db_e2e';
const origin = 'https://127.0.0.1:8443';
const email = 'security-owner@example.invalid';
const password = 'Synthetic-security-owner-42!';
const codePattern = /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = (value) => hash(JSON.stringify(value));
let stage = 'isolated setup';

function connection(name) {
  assert.ok([database, settings.DB_NAME].includes(name), 'Allowlisted synthetic database only');
  return { host: 'postgres', port: 5432, user: 'capital_e2e', password: 'capital_e2e',
    database: name, connectionTimeoutMillis: 5000 };
}

function command(script, args = [], input) {
  const result = spawnSync(process.execPath, [`/app/backend/dist/${script}.js`, ...args], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    input, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${script} must succeed in the isolated fixture`);
  assert.ok(!(result.stdout + result.stderr).includes(password), 'No credential output');
}

async function rejected(promise, status) {
  await assert.rejects(promise, (thrown) => thrown.getStatus?.() === status);
}

// A TOTP the server has not consumed yet: the step after the last accepted one, waited for.
async function freshTotp(source, totp) {
  const [{ lastCounter }] = await source.query('SELECT "lastCounter" FROM owner_mfa');
  for (;;) {
    const [{ now }] = await source.query('SELECT clock_timestamp() AS now');
    const counter = Math.floor(new Date(now).getTime() / 30000);
    // Leave at least five seconds of the step so the server sees the same counter.
    if (counter > Number(lastCounter) && new Date(now).getTime() % 30000 < 25000) {
      return totp.generate({ timestamp: counter * 30000 });
    }
    await source.query('SELECT pg_sleep(1)');
  }
}

// Six digits no step in the one-step drift window accepts.
async function wrongTotp(source, totp) {
  const [{ now }] = await source.query('SELECT clock_timestamp() AS now');
  const counter = Math.floor(new Date(now).getTime() / 30000);
  const valid = new Set([-2, -1, 0, 1, 2].map((offset) => totp.generate({ timestamp: (counter + offset) * 30000 })));
  for (let candidate = 0; ; candidate++) {
    const code = String((Number(totp.generate({ timestamp: (counter + 10) * 30000 })) + candidate) % 1000000).padStart(6, '0');
    if (!valid.has(code)) return code;
  }
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, `Isolated harness required: ${key}`);
  assert.ok(existsSync('/app/backend/dist/auth/session.service.js'), 'Build prerequisite: production SessionService');
  const admin = new Client(connection(settings.DB_NAME));
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Refuse an existing security settings test database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  command('migrate');
  command('owner-cli', ['bootstrap', '--email', email, '--password-stdin'], JSON.stringify({ password, confirmation: password }));
  process.env.DB_NAME = database;
  const { default: source } = require('/app/backend/dist/typeorm-data-source.js');
  const { SessionService } = require('/app/backend/dist/auth/session.service.js');
  const { AuthService } = require('/app/backend/dist/auth/auth.service.js');
  const { MfaService } = require('/app/backend/dist/auth/mfa.service.js');
  const { OwnerAuth } = require('/app/backend/dist/entities/owner-auth.entity.js');
  await source.initialize();
  try {
    const auth = new AuthService(source.getRepository(OwnerAuth));
    await auth.onModuleInit();
    const verified = await auth.validateUser(email, password);
    assert.ok(verified, 'Production password verification must succeed');
    const ownerId = verified.user.id;
    const config = new ConfigService({ ...process.env, FRONTEND_URL: origin });
    const sessions = new SessionService(source, config);
    const factors = new MfaService(source, config, sessions);
    const enrollment = await enroll(source, ownerId, database);
    // Enrollment rotates the credential revision; the password step needs the current one.
    const current = await auth.validateUser(email, password);
    let used = 0;
    const recovery = () => ({ kind: 'recovery', code: enrollment.recoveryCodes[used++] });
    const pending = async () => {
      const anonymous = await sessions.csrf(null);
      const authorized = await sessions.authorize(anonymous.token, false, 'POST', origin, anonymous.csrfToken);
      return sessions.rotate(authorized.hash, current);
    };
    const signIn = async (device) => factors.complete(hash((await pending()).token), recovery(), device);
    const alive = async (token) => {
      try {
        return (await sessions.authorize(token, true, 'GET', undefined, undefined)).state === 'authenticated';
      } catch (error) {
        assert.equal(error.getStatus?.(), 401);
        return false;
      }
    };

    stage = 'SEC-SESSIONS list';
    const laptop = await signIn('Chrome on macOS');
    const phone = await signIn('Safari on iPhone');
    const unnamed = await signIn(null);
    const waiting = await pending();
    const visitor = await sessions.csrf(null);
    const list = await sessions.list(ownerId, hash(laptop.token));
    assert.deepEqual(list.map((item) => [item.device ?? '', item.current]).sort(), [
      ['', false], ['Chrome on macOS', true], ['Safari on iPhone', false],
    ], 'Every signed-in browser with its device, the current one marked; no pending or anonymous session');
    for (const item of list) {
      assert.deepEqual(Object.keys(item).sort(), ['current', 'device', 'id', 'lastActiveAt', 'signedInAt']);
      assert.match(item.id, /^[a-f0-9]{32}$/);
      assert.ok(item.signedInAt instanceof Date && item.lastActiveAt instanceof Date);
    }
    const listed = JSON.stringify(list);
    for (const session of [laptop, phone, unnamed]) {
      for (const secret of [session.token, hash(session.token), session.csrfToken]) {
        assert.ok(!listed.includes(secret), 'The list exposes no cookie, token digest or CSRF token');
      }
    }
    const [stored] = await source.query('SELECT device FROM auth_sessions WHERE "tokenHash" = $1', [hash(phone.token)]);
    assert.equal(stored.device, 'Safari on iPhone', 'The device name is stored with the full session');
    await source.query(`UPDATE auth_sessions SET "expiresAt" = clock_timestamp() - interval '1 second'
      WHERE "tokenHash" = $1`, [hash(unnamed.token)]);
    assert.equal((await sessions.list(ownerId, hash(laptop.token))).length, 2, 'An expired session is not listed');
    console.log('PASS SEC-SESSIONS lists every signed-in browser with device and times, marks this one, hides pending, anonymous, expired sessions and every secret');

    stage = 'SEC-SESSIONS log out one session';
    const phoneId = list.find((item) => item.device === 'Safari on iPhone').id;
    const laptopId = list.find((item) => item.current).id;
    const before = fingerprint(await source.query('SELECT * FROM auth_sessions ORDER BY "tokenHash"'));
    for (const id of [laptopId, 'f'.repeat(32), 'not-a-session', hash(phone.token)]) {
      await rejected(sessions.revokeOther(ownerId, hash(laptop.token), id), 404);
    }
    assert.equal(fingerprint(await source.query('SELECT * FROM auth_sessions ORDER BY "tokenHash"')), before,
      'This browser, an unknown id or a token digest log nothing out');
    await sessions.revokeOther(ownerId, hash(laptop.token), phoneId);
    assert.equal(await alive(phone.token), false, 'The chosen session is logged out');
    assert.equal(await alive(laptop.token), true, 'This browser stays signed in');
    console.log('PASS SEC-SESSIONS logs out exactly the chosen other session; this browser, unknown ids and token digests are refused with 404');

    stage = 'SEC-SESSIONS log out everywhere';
    const tablet = await signIn('Firefox on Android');
    const another = await pending();
    const [{ credentialVersion }] = await source.query('SELECT "credentialVersion" FROM owner_auth');
    const factorBefore = fingerprint([await source.query('SELECT * FROM owner_mfa'),
      await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')]);
    await sessions.revokeAll(ownerId);
    for (const token of [laptop.token, tablet.token]) assert.equal(await alive(token), false, 'Both browsers are logged out');
    for (const step of [waiting, another]) {
      await rejected(sessions.authorize(step.token, true, 'POST', origin, step.csrfToken, true), 401);
    }
    assert.equal((await source.query('SELECT 1 FROM auth_sessions WHERE "userId" IS NOT NULL')).length, 0,
      'No owner session of any state remains');
    const kept = await sessions.authorize(visitor.token, false, 'POST', origin, visitor.csrfToken);
    assert.equal(kept.state, 'anonymous', 'An unrelated anonymous visitor keeps its session');
    const [owner] = await source.query('SELECT "credentialVersion" FROM owner_auth');
    assert.equal(owner.credentialVersion, credentialVersion, 'The password stays the same');
    assert.equal(fingerprint([await source.query('SELECT * FROM owner_mfa'),
      await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')]), factorBefore,
    'The authenticator and recovery codes stay the same');
    const again = await signIn('Chrome on macOS');
    assert.equal(await alive(again.token), true, 'Signing in again with password and factor works');
    console.log('PASS SEC-SESSIONS log out everywhere ends every full and pending owner session, keeps password, factor and anonymous visitors');

    stage = 'SEC-CODES status';
    assert.deepEqual(await factors.recoveryStatus(ownerId), { unused: 10 - used, total: 10 },
      'The count of unused recovery codes of the active factor');

    stage = 'SEC-CODES refused confirmations';
    const codesBefore = fingerprint(await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"'));
    for (const malformed of ['', '12345', '1234567', '12 456', '١٢٣٤٥٦', enrollment.recoveryCodes[used], 123456, null]) {
      await rejected(factors.regenerateRecoveryCodes(ownerId, malformed), 400);
    }
    let [mfa] = await source.query('SELECT "failedAttempts", "consecutiveFailures" FROM owner_mfa');
    assert.deepEqual({ ...mfa }, { failedAttempts: 0, consecutiveFailures: 0 }, 'A malformed code spends no guess');
    await rejected(factors.regenerateRecoveryCodes(ownerId, await wrongTotp(source, enrollment.totp)), 422);
    [mfa] = await source.query('SELECT "failedAttempts", "consecutiveFailures" FROM owner_mfa');
    assert.deepEqual({ ...mfa }, { failedAttempts: 1, consecutiveFailures: 1 }, 'A wrong code counts against the factor limits');
    await rejected(factors.regenerateRecoveryCodes('00000000-0000-4000-8000-000000000000', await freshTotp(source, enrollment.totp)), 401);
    assert.equal(fingerprint(await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')), codesBefore,
      'Refused confirmations leave the recovery codes unchanged');
    await source.query(`UPDATE owner_mfa SET "blockedUntil" = clock_timestamp() + interval '10 minutes'`);
    await rejected(factors.regenerateRecoveryCodes(ownerId, await freshTotp(source, enrollment.totp)), 429);
    await source.query('UPDATE owner_mfa SET "blockedUntil" = NULL');
    assert.equal(fingerprint(await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')), codesBefore,
      'A blocked factor makes no codes');
    console.log('PASS SEC-CODES malformed codes spend nothing, a wrong TOTP counts as a failed factor, a blocked factor answers 429, codes unchanged');

    stage = 'SEC-CODES regenerate';
    const live = await signIn('Chrome on macOS');
    const sessionsBefore = fingerprint(await source.query('SELECT "tokenHash", "credentialVersion", "expiresAt" FROM auth_sessions ORDER BY "tokenHash"'));
    const code = await freshTotp(source, enrollment.totp);
    const fresh = await factors.regenerateRecoveryCodes(ownerId, code);
    assert.equal(fresh.length, 10, 'Ten new codes');
    assert.equal(new Set(fresh).size, 10);
    for (const value of fresh) {
      assert.match(value, codePattern);
      assert.ok(!enrollment.recoveryCodes.includes(value), 'Every code is new');
    }
    const storedCodes = JSON.stringify(await source.query('SELECT * FROM owner_mfa_recovery'));
    for (const value of fresh) assert.ok(!storedCodes.includes(value), 'Only code digests are stored');
    assert.deepEqual(await factors.recoveryStatus(ownerId), { unused: 10, total: 10 });
    [mfa] = await source.query('SELECT "failedAttempts", "consecutiveFailures" FROM owner_mfa');
    assert.deepEqual({ ...mfa }, { failedAttempts: 0, consecutiveFailures: 0 }, 'A correct factor clears the failures');
    assert.equal(fingerprint(await source.query('SELECT "tokenHash", "credentialVersion", "expiresAt" FROM auth_sessions ORDER BY "tokenHash"')),
      sessionsBefore, 'Signed-in browsers stay signed in');
    assert.equal(await alive(live.token), true);
    await rejected(factors.regenerateRecoveryCodes(ownerId, code), 422);
    assert.deepEqual(await factors.recoveryStatus(ownerId), { unused: 10, total: 10 }, 'A replayed TOTP makes no codes');
    const old = enrollment.recoveryCodes[used++];
    await rejected(factors.complete(hash((await pending()).token), { kind: 'recovery', code: old }), 401);
    const signedIn = await factors.complete(hash((await pending()).token), { kind: 'recovery', code: fresh[0] }, null);
    assert.equal(await alive(signedIn.token), true, 'A new code signs in');
    assert.deepEqual(await factors.recoveryStatus(ownerId), { unused: 9, total: 10 });
    console.log('PASS SEC-CODES a fresh TOTP makes ten new codes once, old codes stop working, new ones sign in, replay is refused, sessions stay');
  } finally { await source.destroy(); }
}

main().catch((error) => {
  // Values may include synthetic credentials or hashes; name only the stage and error kind.
  console.error(`FAIL security settings acceptance at stage: ${stage} (${error?.name ?? 'Error'}; details withheld)`);
  process.exitCode = 1;
});
