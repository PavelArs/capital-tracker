'use strict';

// Real PostgreSQL + production services and CLIs for the emailed password reset (M17).
// Only the SMTP provider is replaced: a recording mailer stands where Yandex would be.
// The browser journey through the proxy, real SMTP over TLS and the UI is password-reset.spec.ts.
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
const database = 'capital_tracker_password_reset_db_e2e';
const origin = 'https://127.0.0.1:8443';
const email = 'reset-owner@example.invalid';
const password = 'Synthetic-reset-owner-42!';
const newPassword = 'Synthetic-новый-reset-password-42!';
const linkPattern = /^https:\/\/127\.0\.0\.1:8443\/password-reset\/new#token=([A-Za-z0-9_-]{43})$/;
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
  for (const secret of [password, newPassword]) {
    assert.ok(!(result.stdout + result.stderr).includes(secret), 'No credential output');
  }
}

async function rejected(promise, status, error) {
  await assert.rejects(promise, (thrown) => thrown.getStatus?.() === status
    && (error === undefined || thrown.getResponse?.().error === error));
}

// The provider boundary: records what would go to SMTP, or fails like an unreachable server.
function recordingMailer() {
  const mailer = { sent: [], fail: false };
  mailer.sendPasswordReset = async (to, link) => {
    mailer.sent.push({ to, link });
    if (mailer.fail) throw new Error('Synthetic SMTP outage');
  };
  return mailer;
}

function linkToken(mail) {
  const match = linkPattern.exec(mail.link);
  assert.ok(match, 'The emailed link opens the reset page with the token in its fragment');
  return match[1];
}

async function tokenRows(source) {
  return source.query(`SELECT "tokenHash", "userId", "usedAt", "revokedAt",
    extract(epoch FROM "expiresAt" - "createdAt")::int AS lifetime
    FROM password_reset_tokens ORDER BY "createdAt", "tokenHash"`);
}

// Moves every link of the fixture back in time, keeping each 30-minute lifetime intact.
async function age(source, interval) {
  await source.query(`UPDATE password_reset_tokens SET "createdAt" = "createdAt" - $1::interval,
    "expiresAt" = "expiresAt" - $1::interval`, [interval]);
}

async function verifyRequest(source, resets, mailer, ownerId) {
  stage = 'RESET-REQUEST known and unknown emails';
  const answer = await resets.request(' Reset-Owner@Example.INVALID ');
  assert.equal(answer, undefined, 'A request answers nothing about the account');
  assert.equal(mailer.sent.length, 1, 'One email for the owner');
  assert.equal(mailer.sent[0].to, email);
  const token = linkToken(mailer.sent[0]);
  const [row] = await tokenRows(source);
  assert.deepEqual({ ...row }, { tokenHash: hash(token), userId: ownerId, usedAt: null,
    revokedAt: null, lifetime: 1800 }, 'Only the token digest is stored, valid for 30 minutes');
  assert.equal(await resets.status(token), 'valid');
  const before = fingerprint(await tokenRows(source));
  for (const unknown of ['absent@example.invalid', 'reset-owner@example.com']) {
    assert.equal(await resets.request(unknown), undefined, 'Unknown emails get the same answer');
  }
  assert.equal(mailer.sent.length, 1, 'No email for an unknown address');
  assert.equal(fingerprint(await tokenRows(source)), before, 'No link for an unknown address');
  // A newer link replaces the older one, so only the latest email works.
  await resets.request(email);
  assert.equal(mailer.sent.length, 2);
  const newer = linkToken(mailer.sent[1]);
  assert.equal(await resets.status(token), 'invalid', 'A newer link revokes the older one');
  assert.equal(await resets.status(newer), 'valid');
  for (const malformed of ['', 'x'.repeat(43), `${newer}=`, 'A'.repeat(44), 42, null]) {
    assert.equal(await resets.status(malformed), 'invalid');
  }
  console.log('PASS RESET-REQUEST one link per request for the owner, identical silence for unknown emails, newest link only');
  return newer;
}

async function verifyMailFailure(source, resets, mailer) {
  stage = 'RESET-REQUEST provider outage';
  mailer.fail = true;
  const count = (await tokenRows(source)).length;
  assert.equal(await resets.request(email), undefined, 'An SMTP outage does not change the answer');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await tokenRows(source)).length, count + 1);
  mailer.fail = false;
  console.log('PASS RESET-REQUEST an unreachable SMTP server neither fails nor reveals the request');
}

async function verifyUse(source, resets, sessions, factors, auth, factor, token) {
  stage = 'RESET-USE new password revokes sessions and still needs the factor';
  const verified = await auth.validateUser(email, password);
  const authenticated = [];
  for (let index = 0; index < 2; index++) {
    const anonymous = await sessions.csrf(null);
    const authorized = await sessions.authorize(anonymous.token, false, 'POST', origin, anonymous.csrfToken);
    const pending = await sessions.rotate(authorized.hash, verified);
    authenticated.push(await factors.complete(hash(pending.token), factor.next()));
  }
  const anonymous = await sessions.csrf(null);
  const authorized = await sessions.authorize(anonymous.token, false, 'POST', origin, anonymous.csrfToken);
  const pending = await sessions.rotate(authorized.hash, verified);
  const visitor = await sessions.csrf(null);
  const [{ credentialVersion }] = await source.query('SELECT "credentialVersion" FROM owner_auth');

  await rejected(resets.confirm(token, 'too-short'), 400);
  assert.equal(await resets.status(token), 'valid', 'A refused password leaves the link usable');
  await resets.confirm(token, newPassword);

  for (const session of authenticated) {
    await rejected(sessions.authorize(session.token, true, 'GET', undefined, undefined), 401);
  }
  await rejected(sessions.authorize(pending.token, true, 'POST', origin, pending.csrfToken, true), 401);
  assert.equal((await source.query('SELECT 1 FROM auth_sessions WHERE "userId" IS NOT NULL')).length, 0,
    'Every owner session is gone');
  const kept = await sessions.authorize(visitor.token, false, 'POST', origin, visitor.csrfToken);
  assert.equal(kept.state, 'anonymous', 'An unrelated anonymous visitor keeps its session');
  const [owner] = await source.query('SELECT "credentialVersion" FROM owner_auth');
  assert.notEqual(owner.credentialVersion, credentialVersion, 'The credential revision rotates');
  assert.equal(await auth.validateUser(email, password), null, 'The old password no longer works');
  const renewed = await auth.validateUser(email, newPassword);
  assert.ok(renewed, 'The new password verifies');
  const [stored] = await source.query('SELECT password FROM users WHERE email = $1', [email]);
  assert.match(stored.password, /^\$argon2id\$v=19\$(?=[^$]*\bm=65536\b)(?=[^$]*\bt=3\b)(?=[^$]*\bp=1\b)[^$]+\$/,
    'Argon2id with the owner password parameters');
  assert.ok(!stored.password.includes(newPassword));
  const fresh = await sessions.csrf(null);
  const freshAuthorized = await sessions.authorize(fresh.token, false, 'POST', origin, fresh.csrfToken);
  const step = await sessions.rotate(freshAuthorized.hash, renewed);
  await rejected(sessions.authorize(step.token, true, 'GET', undefined, undefined), 401);
  const full = await factors.complete(hash(step.token), factor.next());
  assert.equal((await sessions.authorize(full.token, true, 'GET', undefined, undefined)).state, 'authenticated',
    'Only the factor turns the new password into access');
  const [used] = await source.query('SELECT "usedAt", "revokedAt" FROM password_reset_tokens WHERE "tokenHash" = $1', [hash(token)]);
  assert.ok(used.usedAt && used.revokedAt === null, 'The link is marked used');
  console.log('PASS RESET-USE new password revokes every owner session and credential revision, old password fails, the factor stays required');
}

async function verifyFactorKept(source, resets, mailer, factorState) {
  stage = 'RESET-USE factor and its codes untouched';
  await age(source, '2 hours');
  await resets.request(email);
  const token = linkToken(mailer.sent.at(-1));
  const before = await factorState();
  await resets.confirm(token, password);
  assert.equal(await factorState(), before, 'The authenticator, its counter, cooldown and recovery codes stay as they were');
  console.log('PASS RESET-USE email reset leaves the second factor, its cooldown and recovery codes unchanged');
}

async function verifyReuse(source, resets, auth, token, current) {
  stage = 'RESET-REUSE a used link is refused';
  const before = fingerprint(await source.query('SELECT password FROM users'));
  assert.equal(await resets.status(token), 'invalid');
  await rejected(resets.confirm(token, 'Synthetic-third-password-42!'), 410, 'invalid');
  assert.equal(fingerprint(await source.query('SELECT password FROM users')), before, 'Password unchanged');
  assert.ok(await auth.validateUser(email, current));
  console.log('PASS RESET-REUSE a used link is refused and changes nothing');
}

async function verifyExpired(source, resets, mailer, auth) {
  stage = 'RESET-EXPIRED a link older than 30 minutes';
  await resets.request(email);
  const token = linkToken(mailer.sent.at(-1));
  await source.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
    UPDATE password_reset_tokens SET "createdAt" = now - interval '30 minutes 1 second',
    "expiresAt" = now - interval '1 second' FROM moment WHERE "tokenHash" = $1`, [hash(token)]);
  const before = fingerprint([await source.query('SELECT * FROM users ORDER BY id'),
    await source.query('SELECT * FROM owner_auth'), await tokenRows(source)]);
  assert.equal(await resets.status(token), 'expired');
  await rejected(resets.confirm(token, 'Synthetic-late-password-42!'), 410, 'expired');
  assert.equal(fingerprint([await source.query('SELECT * FROM users ORDER BY id'),
    await source.query('SELECT * FROM owner_auth'), await tokenRows(source)]), before,
  'An expired link changes no password, revision or link');
  assert.ok(await auth.validateUser(email, password));
  console.log('PASS RESET-EXPIRED a link older than 30 minutes is refused as expired and the password is unchanged');
}

async function verifyLimit(source, resets, mailer, limits) {
  stage = 'RESET-LIMIT account and client windows';
  await age(source, '2 hours');
  const sent = mailer.sent.length;
  for (let index = 0; index < 3; index++) await resets.request(email);
  assert.equal(mailer.sent.length, sent + 3, 'Three emails per hour');
  const before = fingerprint(await tokenRows(source));
  assert.equal(await resets.request(email), undefined, 'The fourth request answers the same');
  assert.equal(mailer.sent.length, sent + 3, 'No email past the hourly limit');
  assert.equal(fingerprint(await tokenRows(source)), before, 'No link past the hourly limit');
  await age(source, '1 hour');
  await resets.request(email);
  assert.equal(mailer.sent.length, sent + 4, 'The window reopens after an hour');
  // The shared PostgreSQL admission refuses a sixth request of one client within a minute.
  const subject = 'v4:198.51.100.77/32';
  for (let index = 0; index < 5; index++) await limits.admit('reset-ip', subject);
  await rejected(limits.admit('reset-ip', subject), 429);
  const [ledger] = await source.query(`SELECT hits, extract(epoch FROM "expiresAt" - "windowStartedAt")::int AS seconds
    FROM auth_request_limits WHERE scope = 'reset-ip'`);
  assert.deepEqual({ ...ledger }, { hits: 5, seconds: 60 });
  console.log('PASS RESET-LIMIT three emails per hour per owner and five requests per minute per client, refused without email');
}

async function verifyPruneAndRecovery(source, resets, mailer) {
  stage = 'RESET links are pruned after a day and revoked by CLI recovery';
  await age(source, '25 hours');
  await resets.request(email);
  const rows = await tokenRows(source);
  assert.equal(rows.length, 1, 'Links older than a day are deleted');
  const token = linkToken(mailer.sent.at(-1));
  command('owner-cli', ['recover', '--user-id', rows[0].userId, '--password-stdin'],
    JSON.stringify({ password, confirmation: password }));
  assert.equal(await resets.status(token), 'invalid', 'Operator recovery revokes outstanding links');
  console.log('PASS RESET-PRUNE/RESET-CLI day-old links are pruned and CLI recovery revokes outstanding links');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, `Isolated harness required: ${key}`);
  assert.ok(existsSync('/app/backend/dist/auth/password-reset.service.js'), 'Build prerequisite: production PasswordResetService');
  const admin = new Client(connection(settings.DB_NAME));
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Refuse an existing password reset test database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  command('migrate');
  command('owner-cli', ['bootstrap', '--email', email, '--password-stdin'], JSON.stringify({ password, confirmation: password }));
  process.env.DB_NAME = database;
  const { default: source } = require('/app/backend/dist/typeorm-data-source.js');
  const { SessionService } = require('/app/backend/dist/auth/session.service.js');
  const { AuthService } = require('/app/backend/dist/auth/auth.service.js');
  const { MfaService } = require('/app/backend/dist/auth/mfa.service.js');
  const { AuthRequestLimitsService } = require('/app/backend/dist/auth/request-limits.service.js');
  const { PasswordResetService } = require('/app/backend/dist/auth/password-reset.service.js');
  const { OwnerAuth } = require('/app/backend/dist/entities/owner-auth.entity.js');
  await source.initialize();
  try {
    const auth = new AuthService(source.getRepository(OwnerAuth));
    await auth.onModuleInit();
    const verified = await auth.validateUser(email, password);
    assert.ok(verified, 'Production password verification must succeed');
    const config = new ConfigService({ ...process.env, FRONTEND_URL: origin });
    const sessions = new SessionService(source, config);
    const factors = new MfaService(source, config, sessions);
    const limits = new AuthRequestLimitsService(source);
    const enrollment = await enroll(source, verified.user.id, database);
    let used = 0;
    const factor = { next: () => ({ kind: 'recovery', code: enrollment.recoveryCodes[used++] }) };
    const factorState = async () => fingerprint([
      await source.query('SELECT * FROM owner_mfa'),
      await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"'),
    ]);
    const mailer = recordingMailer();
    const resets = new PasswordResetService(source, sessions, mailer);
    await verifyRequest(source, resets, mailer, verified.user.id);
    await verifyMailFailure(source, resets, mailer);
    await resets.request(email);
    const fresh = linkToken(mailer.sent.at(-1));
    await verifyUse(source, resets, sessions, factors, auth, factor, fresh);
    await verifyReuse(source, resets, auth, fresh, newPassword);
    await verifyFactorKept(source, resets, mailer, factorState);
    await verifyExpired(source, resets, mailer, auth);
    await verifyLimit(source, resets, mailer, limits);
    await verifyPruneAndRecovery(source, resets, mailer);
  } finally { await source.destroy(); }
}

main().catch((error) => {
  // Values may include synthetic credentials or hashes; name only the stage and error kind.
  console.error(`FAIL password reset acceptance at stage: ${stage} (${error?.name ?? 'Error'}; details withheld)`);
  process.exitCode = 1;
});
