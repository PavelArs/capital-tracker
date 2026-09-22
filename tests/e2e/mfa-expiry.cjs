'use strict';

// External negative-time fixtures; production services and real PostgreSQL only.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const OTPAuth = require('otpauth');
const { enroll } = require('./mfa-db.cjs');

const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_mfa_expiry_e2e';
const email = 'mfa-expiry@example.invalid';
const password = 'Synthetic-mfa-expiry-password-42!';
const hash = value => createHash('sha256').update(value).digest('hex');
let stage = 'isolated setup';

function command(script, args = [], input) {
  const result = spawnSync(process.execPath, [`/app/backend/dist/${script}.js`, ...args], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    input, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined, 'CLI must finish');
  assert.equal(result.signal, null, 'CLI must not hang');
  assert.equal(result.status, 0, 'Real CLI setup must succeed');
  assert.ok(!(result.stdout + result.stderr).includes(password), 'No credential output');
}

async function snapshot(source) {
  const rows = [];
  for (const [table, order] of [
    ['users', 'id'], ['owner_auth', 'id'], ['owner_mfa', 'id'],
    ['owner_mfa_recovery', 'codeHash'], ['auth_sessions', 'tokenHash'],
  ]) {
    rows.push(await source.query(`SELECT * FROM "${table}" ORDER BY "${order}"`));
  }
  return hash(JSON.stringify(rows));
}

async function observeWait(source, blockerPid, table) {
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    const [{ blocked }] = await source.query(`SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity
      WHERE datname = $1 AND wait_event_type = 'Lock'
      AND $2 = ANY(pg_blocking_pids(pid)) AND position($3 in query) > 0
    ) AS blocked`, [database, blockerPid, table]);
    if (blocked) return;
    // Only polling the observed lock condition; expiry waiting below uses PostgreSQL time.
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected production operation to wait on the selected held row');
}

async function heldUntilExpired(source, lockSql, lockArgs, expirySql, expiryArgs, table, action) {
  const blocker = source.createQueryRunner();
  await blocker.connect();
  let waiting;
  try {
    await blocker.startTransaction();
    const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
    const locked = await blocker.query(lockSql, lockArgs);
    assert.equal(locked.length, 1, 'Hold exactly the existing selected row');
    waiting = action().then(
      () => ({ ok: true }),
      error => ({ ok: false, status: error?.getStatus?.() }),
    );
    await observeWait(source, pid, table);
    const [{ valid }] = await blocker.query(`SELECT deadline > clock_timestamp() AS valid FROM (${expirySql}) expiry`, expiryArgs);
    assert.equal(valid, true, 'Operation must reach its held lock before the deadline');
    await blocker.query(`SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (deadline - clock_timestamp())), 0)::double precision + 0.03) FROM (${expirySql}) expiry`, expiryArgs);
    const [{ expired }] = await blocker.query(`SELECT deadline <= clock_timestamp() AS expired FROM (${expirySql}) expiry`, expiryArgs);
    assert.equal(expired, true, 'Release only after actual database expiry');
    console.log(`OBSERVED ${stage}: matching PostgreSQL lock wait crossed the database deadline`);
    await blocker.commitTransaction();
    return await waiting;
  } finally {
    try {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    } finally {
      await blocker.release();
      if (waiting) await waiting;
    }
  }
}

async function main() {
  for (const [key, value] of Object.entries(settings)) {
    assert.equal(process.env[key], value, 'Isolated sentinel settings required');
  }
  assert.ok(process.env.MFA_KEY_FILE && process.env.MFA_KEY_ID, 'Synthetic key required');
  const admin = new Client({
    host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rowCount, 0, 'Refuse a preexisting expiry database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  command('migrate');
  command('owner-cli', ['bootstrap', '--email', email, '--password-stdin'], JSON.stringify({ password, confirmation: password }));
  process.env.DB_NAME = database;
  const source = require('/app/backend/dist/typeorm-data-source.js').default;
  const { AuthService } = require('/app/backend/dist/auth/auth.service.js');
  const { OwnerAuth } = require('/app/backend/dist/entities/owner-auth.entity.js');
  const { SessionService } = require('/app/backend/dist/auth/session.service.js');
  const { MfaService } = require('/app/backend/dist/auth/mfa.service.js');
  const { recoveryHash } = require('/app/backend/dist/auth/mfa-crypto.js');
  await source.initialize();
  try {
    const [{ currentDatabase }] = await source.query('SELECT current_database() AS "currentDatabase"');
    assert.equal(currentDatabase, database);
    const config = new ConfigService({ ...process.env, FRONTEND_URL: 'https://127.0.0.1:8443' });
    const auth = new AuthService(source.getRepository(OwnerAuth));
    await auth.onModuleInit();
    const sessions = new SessionService(source, config);
    const mfa = new MfaService(source, config, sessions);
    const owner = await auth.validateUser(email, password);
    assert.ok(owner);
    const userId = owner.user.id;
    const pending = async () => {
      const anon = await sessions.csrf(null);
      return sessions.rotate(hash(anon.token), await auth.validateUser(email, password));
    };

    stage = 'MFA pending expiry after held recovery row';
    let fixture = await enroll(source, userId, database);
    const challenge = await pending();
    const challengeHash = hash(challenge.token);
    const [{ activeVersion }] = await source.query('SELECT "activeVersion" FROM owner_mfa WHERE id = 1');
    const codeHash = recoveryHash(fixture.recoveryCodes[0], userId, activeVersion);
    await source.query('UPDATE auth_sessions SET "expiresAt" = clock_timestamp() + interval \'2 seconds\' WHERE "tokenHash" = $1', [challengeHash]);
    let before = await snapshot(source);
    const completion = await heldUntilExpired(
      source,
      'SELECT "codeHash" FROM owner_mfa_recovery WHERE "codeHash" = $1 AND "usedAt" IS NULL FOR UPDATE', [codeHash],
      'SELECT "expiresAt" AS deadline FROM auth_sessions WHERE "tokenHash" = $1', [challengeHash],
      'owner_mfa_recovery',
      () => mfa.complete(challengeHash, { kind: 'recovery', code: fixture.recoveryCodes[0] }),
    );
    stage = completion.ok
      ? 'late pending completion unexpectedly accepted after observed recovery-row wait'
      : 'late pending rejection status and unchanged auth state';
    assert.equal(completion.ok, false, 'Expired pending must reject after the held recovery-row wait');
    assert.equal(completion.status, 401, 'Expiry rejection must be authentication denial, not a lock timeout');
    assert.equal(await snapshot(source), before, 'Expired completion must roll back every auth/factor/recovery change');
    assert.equal((await source.query('SELECT 1 FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).length, 0);
    assert.equal((await source.query("SELECT 1 FROM auth_sessions WHERE state = 'authenticated'")).length, 0);
    console.log('PASS MFA-003-B pending expiry after observed recovery-row lock wait; no consumption or full session');

    stage = 'MFA candidate expiry after held existing full session';
    fixture = await enroll(source, userId, database);
    const fresh = await pending();
    const full = await mfa.complete(hash(fresh.token), { kind: 'recovery', code: fixture.recoveryCodes[0] });
    const fullHash = hash(full.token);
    assert.equal((await source.query('SELECT 1 FROM auth_sessions WHERE "tokenHash" = $1 AND state = \'authenticated\' AND "mfaVerifiedAt" IS NOT NULL', [fullHash])).length, 1);
    let candidate;
    await mfa.prepareEnrollment(userId, true, value => { candidate = value; });
    assert.ok(candidate);
    const totp = OTPAuth.URI.parse(candidate.uri);
    const [{ now }] = await source.query('SELECT clock_timestamp() AS now');
    const code = totp.generate({ timestamp: now.getTime() });
    await source.query('UPDATE owner_mfa SET "candidateExpiresAt" = clock_timestamp() + interval \'2 seconds\' WHERE id = 1');
    before = await snapshot(source);
    let publications = 0;
    const confirmation = await heldUntilExpired(
      source,
      'SELECT "tokenHash" FROM auth_sessions WHERE "tokenHash" = $1 AND state = \'authenticated\' FOR UPDATE', [fullHash],
      'SELECT "candidateExpiresAt" AS deadline FROM owner_mfa WHERE id = 1', [],
      'DELETE FROM auth_sessions',
      () => mfa.confirmEnrollment(userId, candidate.candidateId, code, () => { publications++; }),
    );
    stage = confirmation.ok
      ? 'late candidate unexpectedly accepted after observed full-session deletion wait'
      : 'late candidate rejection status, no publication and unchanged auth state';
    assert.equal(confirmation.ok, false, 'Expired replacement must reject after the full-session deletion wait');
    assert.equal(confirmation.status, 401, 'Candidate expiry must reject rather than hitting a database lock timeout');
    assert.equal(publications, 0, 'Expired candidate must not publish recovery output');
    assert.equal(await snapshot(source), before, 'Rejected replacement preserves the full pre-call owner/factor/code/session state');
    console.log('PASS MFA-001-B candidate expiry after observed full-session lock wait; no publication and exact auth state preserved');
  } finally { await source.destroy(); }
}

main().catch(() => {
  console.error(`FAIL isolated MFA expiry acceptance at stage: ${stage}`);
  process.exitCode = 1;
});
