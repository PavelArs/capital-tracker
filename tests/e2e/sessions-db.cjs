'use strict';

// Real PostgreSQL + production services. Mounted only in the isolated release harness.
// HTTP cookie/CSRF/browser assertions are independently exercised by Playwright.
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { enroll } = require('./mfa-db.cjs');
let factorService, factorFixture, factorSource, factorUses;
const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_sessions_db_e2e';
const origin = 'https://127.0.0.1:8443';
const password = 'Synthetic-session-owner-42!';
const hash = (token) => createHash('sha256').update(token).digest('hex');
const fingerprint = (value) => hash(JSON.stringify(value));
const randomToken = () => randomBytes(32).toString('base64url');

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
  assert.equal(result.status, 0, `${script} must succeed in isolated fixture setup`);
  assert.ok(!(result.stdout + result.stderr).includes(password));
}

async function rows(source) {
  return source.query('SELECT * FROM auth_sessions ORDER BY "tokenHash"');
}

async function rejected(promise, status, message) {
  await assert.rejects(promise, (error) => error.getStatus?.() === status, message);
}

function validateToken(token) {
  assert.equal(typeof token, 'string');
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token), 'Token must encode 256 random bits');
  assert.equal(Buffer.from(token, 'base64url').length, 32);
}

async function createAuthenticated(service, verified) {
  const anonymous = await service.csrf(null);
  validateToken(anonymous.token);
  const authorized = await service.authorize(anonymous.token, false, 'POST', origin, anonymous.csrfToken);
  const pending = await service.rotate(authorized.hash, verified);
  let factor;
  if (factorUses < 10) factor = {kind:'recovery',code:factorFixture.recoveryCodes[factorUses]};
  else {
    const [{now}] = await factorSource.query('SELECT clock_timestamp() AS now');
    factor = {kind:'totp',code:factorFixture.totp.generate({timestamp:new Date(now).getTime() + (factorUses === 11 ? 30000 : 0)})};
  }
  factorUses++;
  const authenticated = await factorService.complete(hash(pending.token), factor);
  validateToken(authenticated.token);
  assert.ok(authenticated.token !== anonymous.token, 'Login rotates authentication token');
  assert.ok(authenticated.csrfToken !== anonymous.csrfToken, 'Login rotates CSRF token');
  return authenticated;
}

async function verifyCapacity(source, service, verified) {
  // Fixed independent fixture rows exercise the actual creation/capacity transaction.
  for (let index = 0; index < 512; index++) {
    await source.query(`INSERT INTO auth_sessions("tokenHash", "csrfToken", state, "createdAt", "lastSeenAt", "expiresAt")
      VALUES ($1,$2,'anonymous',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes')`,
      [hash(randomToken()), randomToken()]);
  }
  const before = await rows(source);
  await rejected(service.csrf(null), 429, 'SES-003-A full anonymous capacity refuses creation');
  assert.equal(fingerprint(await rows(source)), fingerprint(before), 'Capacity refusal preserves every active record');
  const oldest = before[0].tokenHash;
  await source.query('UPDATE auth_sessions SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE "tokenHash"=$1', [oldest]);
  const created = await service.csrf(null);
  validateToken(created.token);
  const after = await rows(source);
  assert.equal(after.length, 512);
  assert.ok(!after.some((row) => row.tokenHash === oldest), 'Expired row is pruned');
  for (const old of before.slice(1)) {
    assert.equal(fingerprint(after.find((row) => row.tokenHash === old.tokenHash)), fingerprint(old), 'Live sessions are never evicted to create anonymous capacity');
  }
  // All mutations below are limited to the newly created dedicated test database.
  await source.query('DELETE FROM auth_sessions');
  const sessions = [];
  for (let index = 0; index < 12; index++) {
    const session = await createAuthenticated(service, verified);
    sessions.push(session);
    // Explicit order prevents timing/timestamp ties from weakening the eviction oracle.
    await source.query('UPDATE auth_sessions SET "createdAt"=clock_timestamp()-make_interval(mins => $1) WHERE "tokenHash"=$2',
      [20-index, hash(session.token)]);
  }
  const retained = await rows(source);
  assert.equal(retained.length, 10, 'At most ten authenticated sessions');
  assert.ok(retained.every((row) => row.state === 'authenticated'));
  for (const session of sessions.slice(0, 2)) {
    await rejected(service.authorize(session.token, true, 'GET', undefined, undefined), 401, 'Oldest owner session retired');
  }
  for (const session of sessions.slice(2)) {
    assert.ok(retained.some((row) => row.tokenHash === hash(session.token)));
  }
  await source.query('DELETE FROM auth_sessions');
  console.log('PASS SES-003-A/C capacity512 anonymous and capacity10 authenticated, live preservation and expiry pruning');
}

async function verifyExpiry(source, service, verified) {
  const anonymous = await service.csrf(null);
  const [anonymousRow] = await source.query('SELECT * FROM auth_sessions WHERE "tokenHash"=$1', [hash(anonymous.token)]);
  assert.ok(Math.abs(new Date(anonymousRow.expiresAt)-new Date(anonymousRow.createdAt)-300000)<1000,
    'Anonymous lifetime must be five minutes');
  await source.query('UPDATE auth_sessions SET "expiresAt"=clock_timestamp() WHERE "tokenHash"=$1', [hash(anonymous.token)]);
  await rejected(service.authorize(anonymous.token, false, 'POST', origin, anonymous.csrfToken), 403, 'Expired anonymous cannot login');
  const unused = await createAuthenticated(service, verified);
  await source.query('UPDATE auth_sessions SET "lastSeenAt"=clock_timestamp()-interval \'23 hours\' WHERE "tokenHash"=$1', [hash(unused.token)]);
  const unusedUser = await service.authorize(unused.token, true, 'GET', undefined, undefined);
  assert.equal(unusedUser.user.userId, verified.user.id, 'SES-001-C a session unused for 23 hours stays valid');
  const session = await createAuthenticated(service, verified);
  await source.query('UPDATE auth_sessions SET "expiresAt"=clock_timestamp() WHERE "tokenHash"=$1', [hash(session.token)]);
  const beforeExpired = fingerprint(await rows(source));
  await rejected(service.authorize(session.token, true, 'GET', undefined, undefined), 401, 'SES-001-C database boundary expiry rejects');
  assert.equal(fingerprint(await rows(source)), beforeExpired, 'Expired authorization cannot refresh the session');
  const valid = await createAuthenticated(service, verified);
  const [initial] = await source.query('SELECT * FROM auth_sessions WHERE "tokenHash"=$1', [hash(valid.token)]);
  assert.ok(Math.abs(new Date(initial.expiresAt)-new Date(initial.createdAt)-86400000)<1000,
    'Authenticated absolute lifetime must be one day');
  await source.query('UPDATE auth_sessions SET "lastSeenAt"=clock_timestamp()-interval \'5 minutes\' WHERE "tokenHash"=$1', [hash(valid.token)]);
  const [before] = await source.query('SELECT * FROM auth_sessions WHERE "tokenHash"=$1', [hash(valid.token)]);
  const authorized = await service.authorize(valid.token, true, 'GET', undefined, undefined);
  assert.equal(authorized.user.userId, verified.user.id);
  const [after] = await source.query('SELECT * FROM auth_sessions WHERE "tokenHash"=$1', [hash(valid.token)]);
  assert.ok(new Date(after.lastSeenAt) > new Date(before.lastSeenAt), 'Valid access records activity');
  assert.equal(new Date(after.expiresAt).getTime(), new Date(before.expiresAt).getTime(), 'Absolute expiry never extends');
  assert.ok(!(JSON.stringify(after)).includes(valid.token), 'Raw authentication token is absent from stored row');
  await source.query('DELETE FROM auth_sessions');
  console.log('PASS SES-001-C PostgreSQL-time anonymous/absolute expiry, one-day lifetime without idle timeout');
}

async function verifyAtomicity(source, service, verified) {
  const anonymous = await service.csrf(null);
  const results = await Promise.allSettled([
    service.rotate(hash(anonymous.token), verified), service.rotate(hash(anonymous.token), verified),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'SES-003-B exactly one login rotation succeeds');
  const stored = await rows(source);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].state, 'pending_mfa');
  assert.ok(stored[0].tokenHash !== hash(anonymous.token));
  await rejected(service.authorize(anonymous.token, true, 'GET', undefined, undefined), 401);
  await source.query('DELETE FROM auth_sessions');

  for (let index = 0; index < 4; index++) {
    const session = await createAuthenticated(service, verified);
    const actions = [
      () => service.authorize(session.token, true, 'GET', undefined, undefined),
      () => service.revoke(hash(session.token)),
    ];
    if (index % 2) actions.reverse();
    await Promise.allSettled(actions.map((action) => action()));
    assert.equal((await source.query('SELECT 1 FROM auth_sessions WHERE "tokenHash"=$1', [hash(session.token)])).length, 0,
      'A concurrent access must not resurrect a revoked session');
    await rejected(service.authorize(session.token, true, 'GET', undefined, undefined), 401);
  }
  console.log('PASS SES-003-B atomic one-time rotation and SES-001-B revoke/touch race');
}

async function verifyExpiryAfterLockWait(source, service, verified) {
  const session = await createAuthenticated(service,verified);
  const tokenHash = hash(session.token);
  // Commit expiry before taking a read-only row lock. Updating the row while it is
  // locked would trigger PostgreSQL tuple re-evaluation and hide the stale-clock bug.
  await source.query('UPDATE auth_sessions SET "expiresAt"=clock_timestamp()+interval \'2 seconds\' WHERE "tokenHash"=$1',[tokenHash]);
  const before = fingerprint(await rows(source));
  const blocker = source.createQueryRunner();
  await blocker.connect();
  let pending;
  try {
    await blocker.startTransaction();
    const [{pid}] = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('SELECT 1 FROM auth_sessions WHERE "tokenHash"=$1 FOR UPDATE',[tokenHash]);
    pending = service.authorize(session.token,true,'GET',undefined,undefined)
      .then(()=>({ok:true}),error=>({ok:false,error}));
    const deadline = Date.now()+5000;
    let waiting=false;
    while(Date.now()<deadline) {
      const [{blocked}] = await source.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))) AS blocked`,[database,pid]);
      if(blocked) { waiting=true; break; }
      // Bounded polling observes a specific database lock; no timing-only race oracle.
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'Authorization must actually be waiting for the held session row');
    const [{stillValid}] = await blocker.query('SELECT "expiresAt">clock_timestamp() AS "stillValid" FROM auth_sessions WHERE "tokenHash"=$1',[tokenHash]);
    assert.equal(stillValid,true,'The request must start before the expiry boundary');
    // Wait precisely for this synthetic session's database expiry, not an arbitrary
    // delay, then unlock without modifying the tuple selected by authorization.
    await blocker.query(`SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM ("expiresAt"-clock_timestamp())),0)::double precision+0.02)
      FROM auth_sessions WHERE "tokenHash"=$1`,[tokenHash]);
    await blocker.commitTransaction();
    const result=await pending;
    assert.equal(result.ok,false,'A session expiring during a row-lock wait cannot authorize');
    assert.equal(result.error.getStatus?.(),401);
    assert.equal(fingerprint(await rows(source)),before,'Lock-delayed expiry cannot touch or revive the session');
    console.log('PASS SES-001-C expiry rechecked after an observed PostgreSQL row-lock wait');
  } finally {
    try { if(blocker.isTransactionActive) await blocker.rollbackTransaction(); }
    finally { await blocker.release(); }
    if(pending) await pending;
  }
}

function recoverOwner(userId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['/app/backend/dist/owner-cli.js','recover','--user-id',userId,'--password-stdin'], {
      cwd:'/app/backend', env:{...process.env,...settings,DB_NAME:database},
      stdio:['pipe','pipe','pipe'], timeout:30000,
    });
    let output='';
    child.stdout.on('data',(data)=>{output+=data;});
    child.stderr.on('data',(data)=>{output+=data;});
    child.on('error',reject);
    child.on('close',(code,signal)=>{
      try {
        assert.equal(signal,null,'Recovery must not deadlock');
        assert.equal(code,0,'Concurrent owner recovery must succeed');
        assert.ok(!output.includes(password),'No credential output');
        resolve();
      } catch(error) { reject(error); }
    });
    child.stdin.on('error',(error)=>{if(error.code!=='EPIPE')reject(error);});
    child.stdin.end(JSON.stringify({password,confirmation:password}));
  });
}

async function verifyRecovery(source, service, auth) {
  let verified = await auth.validateUser('sessions-owner@example.invalid',password);
  const authenticated = await createAuthenticated(service,verified);
  const anonymous = await service.csrf(null);
  await recoverOwner(verified.user.id);
  const before = fingerprint(await rows(source));
  await rejected(service.rotate(hash(anonymous.token),verified),401,'Stale password-verification result cannot issue a session after recovery');
  assert.equal(fingerprint(await rows(source)),before,'Stale issuance leaves sessions unchanged');
  await rejected(service.authorize(authenticated.token,true,'GET',undefined,undefined),401,'Recovery revokes previously issued cookie');

  for(let index=0;index<3;index++) {
    verified = await auth.validateUser('sessions-owner@example.invalid',password);
    const expired = await createAuthenticated(service,verified);
    const preSession = await service.csrf(null);
    await source.query('UPDATE auth_sessions SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE "tokenHash"=$1',[hash(expired.token)]);
    // Includes pruning of an owner session while recovery also updates owner then
    // deletes sessions; lock-order bugs must not produce a driver/deadlock failure.
    const recovery = recoverOwner(verified.user.id);
    const rotation = service.rotate(hash(preSession.token),verified);
    const [recovered,rotated] = await Promise.allSettled([recovery,rotation]);
    assert.equal(recovered.status,'fulfilled','Recovery succeeds during concurrent rotation');
    if(rotated.status==='rejected') {
      assert.equal(rotated.reason.getStatus?.(),401,'Only stale owner verification may reject concurrent rotation');
    } else {
      await rejected(service.authorize(rotated.value.token,true,'GET',undefined,undefined),401,'Recovery leaves no old-revision session usable');
    }
    assert.equal((await source.query("SELECT 1 FROM auth_sessions WHERE state='authenticated'")).length,0);
  }
  console.log('PASS SES-001-B stale verification and concurrent CLI recovery/rotation cannot restore access');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, `Isolated harness required: ${key}`);
  assert.ok(existsSync('/app/backend/dist/auth/session.service.js'), 'Build prerequisite: production SessionService');
  const admin = new Client(connection(settings.DB_NAME));
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0, 'Refuse existing session test database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  command('migrate');
  command('owner-cli', ['bootstrap','--email','sessions-owner@example.invalid','--password-stdin'], JSON.stringify({password,confirmation:password}));
  process.env.DB_NAME = database;
  const { default: source } = require('/app/backend/dist/typeorm-data-source.js');
  const { SessionService } = require('/app/backend/dist/auth/session.service.js');
  const { AuthService } = require('/app/backend/dist/auth/auth.service.js');
  const { OwnerAuth } = require('/app/backend/dist/entities/owner-auth.entity.js');
  await source.initialize();
  try {
    const auth = new AuthService(source.getRepository(OwnerAuth));
    await auth.onModuleInit();
    let verified = await auth.validateUser('sessions-owner@example.invalid', password);
    assert.ok(verified, 'Production password verification must succeed');
    const config = new ConfigService({...process.env,FRONTEND_URL:origin});
    const service = new SessionService(source, config);
    const { MfaService } = require('/app/backend/dist/auth/mfa.service.js');
    factorService = new MfaService(source,config,service); factorSource=source;
    for (const check of [verifyCapacity,verifyExpiry,verifyExpiryAfterLockWait,verifyAtomicity,verifyRecovery]) {
      factorFixture=await enroll(source,verified.user.id,database); factorUses=0;
      verified=await auth.validateUser('sessions-owner@example.invalid',password);
      await check(source,service,check===verifyRecovery ? auth : verified);
    }
  } finally { await source.destroy(); }
}

main().catch((error) => { console.error(error); process.exitCode=1; });
