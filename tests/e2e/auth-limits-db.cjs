'use strict';

// External synthetic fixture: actual migrations, production service and PostgreSQL.
// Missing implementation/schema is setup failure, never behavioral RED evidence.
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { DataSource } = require('typeorm');

const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_auth_limits_e2e';
const advisoryKey = 1763669184;
const policies = [
  ['csrf-ip', 30, 60], ['login-ip', 5, 60], ['mfa-ip', 5, 60],
  ['login-account', 10, 600],
];
const expectedMigrationNames = [
  'Init1763669182662',
  'AddCurrencySystemAndPreferences1763741417438',
  'AddInvitationCodes1763800000000',
  'AddEmailVerificationAndResetFields1763900000000',
  'MigrateCurrencyToForeignKey1764000000000',
  'DropStubModuleTables1764100000000',
  'DropRemovedModuleTables1764200000000',
  'CleanupCryptoTypeEnum1764300000000',
  'AddOwnerBinding1789990000000',
  'AddOwnerSessions1790000000000',
  'AddOwnerMfa1790010000000',
  'AddAuthRequestLimits1790020000000',
  'AddManualOpeningPositions1790030000000',
  'AddUsdTradeJournal1790040000000',
  'AddUsdCsvImports1790050000000',
  'AddKnownCostCarryIn1790060000000',
  'AddExternalUsdFlows1790070000000',
  'AddManualUsdPrices1790080000000',
  'AddDailyDisplayFx1790090000000',
  'AddOwnedTransfers1790100000000',
  'AddAssetRewards1790200000000',
  'AddAssetSwaps1790300000000',
  'AddWalletAddressImport1790400000000',
  'ClassifyAssets1790700000000',
  'AddHourlyPrices1790800000000',
  'AccountInThreeCurrencies1790900000000',
  'RecordPortfolioSnapshots1791000000000',
  'PaidCurrencyTrades1791100000000',
  'TradeComments1791200000000',
  'TradeSettlements1791300000000',
  'TradePurposes1791400000000',
  'BindWalletsToAccounts1791600000000',
  'ClassifyChainTransactions1791700000000',
  'LinkOwnTransfers1791800000000',
  'TrackEthereumWallets1792000000000',
  'TrackSolanaWallets1792100000000',
];
const children = new Set();
let stage = 'isolated setup';
const digest = (scope, subject) => createHash('sha256')
  .update(JSON.stringify(['ct-auth-request-v1', scope, subject])).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function sentinel(worker = false) {
  for (const [key, value] of Object.entries(settings)) {
    assert.equal(process.env[key], worker && key === 'DB_NAME' ? database : value,
      'Exact isolated database sentinel required');
  }
}

function productionSource(poolSize = 8) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database }))
    .createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.connectTimeoutMS, 5000, 'Use the actual production checkout timeout');
  assert.ok(options.extra?.connectionTimeoutMillis === undefined
    || options.extra.connectionTimeoutMillis === 5000, 'No timeout override');
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, poolSize });
}

function limiter(source) {
  const { AuthRequestLimitsService } = require('/app/backend/dist/auth/request-limits.service.js');
  return new AuthRequestLimitsService(source);
}

async function outcome(action) {
  try { await action(); return { status: 200 }; }
  catch (error) {
    return { status: error?.getStatus?.(), retryAfter: error?.retryAfter,
      message: error?.message, response: error?.getResponse?.() };
  }
}

function denial(result, status, maxRetry = 600, sensitive = []) {
  assert.equal(result.status, status, 'Expected deliberate HTTP denial, not incidental failure');
  assert.equal(result.message, status === 429 ? 'Too many requests' : 'Authentication service unavailable');
  if (status === 429) {
    assert.ok(Number.isInteger(result.retryAfter));
    assert.ok(result.retryAfter >= 1 && result.retryAfter <= maxRetry);
  }
  const publicError = JSON.stringify([result.message, result.response]);
  for (const value of [database, 'capital_e2e', 'auth_request_limits', 'synthetic-ledger-error',
    'v4:', 'v6:', '@example.invalid', ...sensitive]) {
    assert.ok(!publicError.includes(value), 'Public exception must not expose storage or subject details');
  }
}

async function ledger(source) {
  // PostgreSQL JSON retains sub-millisecond timestamp precision for exact comparisons.
  return (await source.query(`SELECT COALESCE(jsonb_agg(to_jsonb(l)
    ORDER BY scope, "subjectHash"), '[]'::jsonb) AS rows FROM auth_request_limits l`))[0].rows;
}

async function row(source, scope, subject) {
  const found = await source.query(`SELECT to_jsonb(l) AS value FROM auth_request_limits l
    WHERE scope=$1 AND "subjectHash"=$2`, [scope, digest(scope, subject)]);
  assert.equal(found.length, 1);
  return found[0].value;
}

async function remaining(source, scope, subject) {
  const maximum = policies.find(([name]) => name === scope)[2];
  return (await source.query(`SELECT GREATEST(1,LEAST($3,
    ceil(EXTRACT(EPOCH FROM ("expiresAt"-clock_timestamp())))))::int AS seconds
    FROM auth_request_limits WHERE scope=$1 AND "subjectHash"=$2`,
  [scope, digest(scope, subject), maximum]))[0].seconds;
}

async function nonLedgerFingerprint(source) {
  const tables = await source.query(`SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> 'auth_request_limits' ORDER BY tablename`);
  assert.ok(tables.some(({ tablename }) => tablename === 'users'));
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
    rows.push([tablename, await source.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t)
      ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM "${tablename}" t`)]);
  }
  return hash(rows);
}

async function clearLedger(source) {
  assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
  await source.query('TRUNCATE auth_request_limits');
}

async function expiresIn(source, scope, subject, milliseconds) {
  const seconds = policies.find(([name]) => name === scope)[2];
  await source.query(`WITH moment AS (SELECT clock_timestamp()+$3*interval '1 millisecond' AS deadline)
    UPDATE auth_request_limits SET "expiresAt"=moment.deadline,
    "windowStartedAt"=moment.deadline-$4*interval '1 second' FROM moment
    WHERE scope=$1 AND "subjectHash"=$2`, [scope, digest(scope, subject), milliseconds, seconds]);
}

async function freshWindow(source, scope, subject, oldDeadline) {
  const seconds = policies.find(([name]) => name === scope)[2];
  const [value] = await source.query(`SELECT hits,
    "windowStartedAt">=$3::timestamptz AS fresh,
    "expiresAt"-"windowStartedAt"=$4*interval '1 second' AS duration
    FROM auth_request_limits WHERE scope=$1 AND "subjectHash"=$2`,
  [scope, digest(scope, subject), oldDeadline, seconds]);
  assert.deepEqual(value, { hits: 1, fresh: true, duration: true });
}

async function observeWait(source, blockerPid, count = 1, fragment = 'auth_request_limits') {
  const deadline = performance.now() + 1500;
  while (performance.now() < deadline) {
    const [{ waiting }] = await source.query(`SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))
      AND position($3 in query)>0`, [database, blockerPid, fragment]);
    if (waiting >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Production operation must actually wait on the selected PostgreSQL lock');
}

async function releaseAfterDeadline(blocker, deadline) {
  assert.equal((await blocker.query('SELECT $1::timestamptz>clock_timestamp() AS live', [deadline]))[0].live,
    true, 'Observe the blocked operation while its synthetic deadline is still live');
  await blocker.query(`SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM
    ($1::timestamptz-clock_timestamp())),0)::double precision+0.025)`, [deadline]);
  assert.equal((await blocker.query('SELECT $1::timestamptz<=clock_timestamp() AS expired', [deadline]))[0].expired, true);
  await blocker.commitTransaction();
}

async function heldExpiry(source, sql, args, deadline, scope, subject, fragment) {
  const blocker = source.createQueryRunner();
  await blocker.connect();
  let pending;
  try {
    await blocker.startTransaction();
    const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query(sql, args);
    pending = outcome(() => limiter(source).admit(scope, subject));
    await observeWait(source, pid, 1, fragment);
    await releaseAfterDeadline(blocker, deadline);
    assert.equal((await pending).status, 200, 'Admission resumes using the post-wait database clock');
  } finally {
    try { if (blocker.isTransactionActive) await blocker.rollbackTransaction(); }
    finally { await blocker.release(); if (pending) await pending; }
  }
}

async function workerMain() {
  sentinel(true);
  const source = productionSource(2);
  await source.initialize();
  try {
    const instruction = new Promise(resolve => process.once('message', resolve));
    process.send({ type: 'ready', pid: process.pid });
    const { scope, subject } = await instruction;
    const result = await outcome(() => limiter(source).admit(scope, subject));
    process.send({ type: 'result', result });
  } finally { await source.destroy(); process.disconnect(); }
}

function startWorker() {
  const child = spawn(process.execPath, [__filename, '--worker'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.add(child);
  let readyResolve, readyReject, resultResolve, resultReject, result, output = '';
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const finished = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  // Attach immediately so an early setup failure cannot become an unhandled rejection.
  ready.catch(() => {}); finished.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const capture = chunk => {
    output += chunk;
    if (Buffer.byteLength(output) > 16384) child.kill('SIGKILL');
  };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('message', message => {
    if (message.type === 'ready') readyResolve(message.pid);
    if (message.type === 'result') result = message.result;
  });
  const fail = () => {
    const error = new Error('Isolated admission worker failed (details withheld)');
    readyReject(error); resultReject(error);
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    clearTimeout(timer); children.delete(child);
    if (code !== 0 || signal || result === undefined || output !== '') fail();
    else resultResolve(result);
  });
  return { child, ready, finished, go: (scope, subject) => child.send({ scope, subject }) };
}

async function processRace(source, admissions) {
  const workers = admissions.map(() => startWorker());
  let blocker;
  try {
    const pids = await Promise.all(workers.map(worker => worker.ready));
    assert.equal(new Set(pids).size, admissions.length, 'Admission uses distinct actual Node processes');
    pids.forEach((pid, index) => assert.equal(pid, workers[index].child.pid));
    blocker = source.createQueryRunner(); await blocker.connect(); await blocker.startTransaction();
    const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('SELECT pg_advisory_xact_lock($1)', [advisoryKey]);
    workers.forEach((worker, index) => worker.go(...admissions[index]));
    await observeWait(source, pid, workers.length, 'pg_advisory');
    await blocker.commitTransaction();
    return await Promise.all(workers.map(worker => worker.finished));
  } finally {
    if (blocker) {
      try { if (blocker.isTransactionActive) await blocker.rollbackTransaction(); }
      finally { await blocker.release(); }
    }
    for (const worker of workers) if (children.has(worker.child)) worker.child.kill('SIGKILL');
    await Promise.allSettled(workers.map(worker => worker.finished));
  }
}

async function fill(source, count, remainingMilliseconds = 600000) {
  const subjects = Array.from({ length: count }, (_, index) => `capacity-${index}@example.invalid`);
  await source.query(`WITH moment AS (SELECT clock_timestamp()+$2*interval '1 millisecond' AS deadline)
    INSERT INTO auth_request_limits(scope,"subjectHash",hits,"windowStartedAt","expiresAt")
    SELECT 'login-account',subject,1,deadline-interval '600 seconds',deadline
    FROM unnest($1::text[]) AS subject CROSS JOIN moment`,
  [subjects.map(subject => digest('login-account', subject)), remainingMilliseconds]);
  return subjects;
}

async function fixedWindows(source) {
  stage = 'fixed windows and digest policy';
  await clearLedger(source);
  for (const [scope, limit, seconds] of policies) {
    const subject = scope === 'login-account' ? 'limits-owner@example.invalid' : 'v4:192.0.2.42/32';
    await limiter(source).admit(scope, subject);
    const first = await row(source, scope, subject);
    assert.equal(first.hits, 1);
    assert.equal(first.subjectHash, digest(scope, subject));
    for (let index = 1; index < limit; index++) await limiter(source).admit(scope, subject);
    const full = await row(source, scope, subject);
    assert.deepEqual(full, { ...first, hits: limit }, 'Success increments without extending either timestamp');
    // A deliberately short remaining window exposes a constant policy-duration retry value.
    await expiresIn(source, scope, subject, 3500);
    const before = await ledger(source);
    const beforeRetry = await remaining(source, scope, subject);
    const one = await outcome(() => limiter(source).admit(scope, subject));
    const two = await outcome(() => limiter(source).admit(scope, subject));
    const afterRetry = await remaining(source, scope, subject);
    denial(one, 429, seconds, [subject, first.subjectHash]);
    denial(two, 429, seconds, [subject, first.subjectHash]);
    assert.ok(two.retryAfter <= one.retryAfter);
    assert.ok(one.retryAfter <= beforeRetry && two.retryAfter >= afterRetry,
      'Retry seconds reflect the actual database deadline, rounded up');
    assert.deepEqual(await ledger(source), before, 'Denial never slides or increments a live window');
    await expiresIn(source, scope, subject, 0);
    const boundary = (await row(source, scope, subject)).expiresAt;
    await limiter(source).admit(scope, subject);
    await freshWindow(source, scope, subject, boundary);
  }
  const serialized = JSON.stringify(await ledger(source));
  for (const raw of ['limits-owner@example.invalid', '192.0.2.42']) assert.ok(!serialized.includes(raw));
  console.log('PASS LIMIT-003-A all four exact limits, independently derived digests, fixed deadlines and expired-window replacement');

  stage = 'committed pruning on denial';
  await clearLedger(source);
  const live = 'v4:192.0.2.43/32', expired = 'v4:192.0.2.44/32';
  for (let index = 0; index < 5; index++) await limiter(source).admit('login-ip', live);
  await limiter(source).admit('login-ip', expired); await expiresIn(source, 'login-ip', expired, -1000);
  const full = await row(source, 'login-ip', live);
  denial(await outcome(() => limiter(source).admit('login-ip', live)), 429, 60);
  assert.deepEqual(await ledger(source), [full], 'Expected denial commits pruning without changing the full target');
  console.log('PASS LIMIT-003/004 expected denial commits expired-row pruning');
}

async function races(source) {
  stage = 'shared remaining admission across actual processes';
  await clearLedger(source);
  const subject = 'v4:192.0.2.50/32';
  for (let index = 0; index < 4; index++) await limiter(source).admit('login-ip', subject);
  const before = await row(source, 'login-ip', subject);
  const hitRace = await processRace(source, [['login-ip', subject], ['login-ip', subject]]);
  assert.deepEqual(hitRace.map(value => value.status).sort(), [200, 429]);
  denial(hitRace.find(value => value.status === 429), 429, 60);
  assert.deepEqual(await row(source, 'login-ip', subject), { ...before, hits: 5 });
  console.log('PASS LIMIT-001-C two actual service processes share one remaining admission');

  stage = 'two-process last live capacity slot';
  await clearLedger(source);
  const subjects = await fill(source, 4095);
  const prior = await ledger(source);
  const capacityRace = await processRace(source, [
    ['login-ip', 'v4:192.0.2.51/32'], ['login-ip', 'v4:192.0.2.52/32'],
  ]);
  assert.deepEqual(capacityRace.map(value => value.status).sort(), [200, 429]);
  const denied = capacityRace.find(value => value.status === 429);
  denial(denied, 429, 600);
  // The newly admitted source expires in60s, so capacity retry follows that earliest live deadline.
  assert.ok(denied.retryAfter <= 60);
  const [{ earliestRetry }] = await source.query(`SELECT GREATEST(1,LEAST(600,
    ceil(EXTRACT(EPOCH FROM (min("expiresAt")-clock_timestamp())))))::int AS "earliestRetry"
    FROM auth_request_limits WHERE "expiresAt">clock_timestamp()`);
  assert.ok(denied.retryAfter >= earliestRetry, 'Capacity retry uses the earliest live deadline');
  const after = await ledger(source);
  assert.equal(after.length, 4096);
  const retained = new Map(after.map(value => [`${value.scope}:${value.subjectHash}`, value]));
  for (const value of prior) assert.deepEqual(retained.get(`${value.scope}:${value.subjectHash}`), value);
  await limiter(source).admit('login-account', subjects[0]);
  assert.equal((await row(source, 'login-account', subjects[0])).hits, 2);
  assert.equal((await ledger(source)).length, 4096, 'An existing live subject remains usable without eviction');
  console.log('PASS LIMIT-004-A last-slot race gives one success/one denial, keeps4096 rows and preserves every prior live window');

  stage = 'capacity retry follows account deadlines, not the requesting source policy';
  await clearLedger(source);
  await fill(source, 4096);
  const fullCapacity = await ledger(source);
  const refusal = await outcome(() => limiter(source).admit('login-ip', 'v4:192.0.2.53/32'));
  denial(refusal, 429, 600);
  const [{ seconds }] = await source.query(`SELECT ceil(EXTRACT(EPOCH FROM
    (min("expiresAt")-clock_timestamp())))::int AS seconds FROM auth_request_limits`);
  assert.ok(refusal.retryAfter >= seconds && refusal.retryAfter > 60);
  assert.deepEqual(await ledger(source), fullCapacity, 'Capacity refusal cannot evict or extend live windows');
  console.log('PASS LIMIT-004/005 capacity denial reports the actual earliest account deadline, up to600s');
}

async function expiryWaits(source) {
  for (const kind of ['advisory', 'target']) {
    stage = `fresh expiry after held ${kind} lock`;
    await clearLedger(source);
    const subject = 'v4:192.0.2.60/32';
    for (let index = 0; index < 5; index++) await limiter(source).admit('login-ip', subject);
    await expiresIn(source, 'login-ip', subject, 1200);
    const deadline = (await row(source, 'login-ip', subject)).expiresAt;
    const sql = kind === 'advisory' ? 'SELECT pg_advisory_xact_lock($1)'
      : 'SELECT 1 FROM auth_request_limits WHERE scope=$1 AND "subjectHash"=$2 FOR UPDATE';
    const args = kind === 'advisory' ? [advisoryKey] : ['login-ip', digest('login-ip', subject)];
    await heldExpiry(source, sql, args, deadline, 'login-ip', subject,
      kind === 'advisory' ? 'pg_advisory' : 'auth_request_limits');
    await freshWindow(source, 'login-ip', subject, deadline);
    console.log(`PASS LIMIT-003-B observed ${kind} lock crosses database deadline before successful fresh window`);
  }

  stage = 'pruning wait and fresh live-capacity decision';
  await clearLedger(source);
  const expired = 'v4:192.0.2.61/32', fresh = 'v4:192.0.2.62/32';
  await limiter(source).admit('login-ip', expired); await expiresIn(source, 'login-ip', expired, -1000);
  const subjects = await fill(source, 4096, 1200);
  const deadline = (await row(source, 'login-account', subjects[0])).expiresAt;
  await heldExpiry(source,
    'SELECT 1 FROM auth_request_limits WHERE scope=$1 AND "subjectHash"=$2 FOR UPDATE',
    ['login-ip', digest('login-ip', expired)], deadline, 'login-ip', fresh, 'DELETE');
  await freshWindow(source, 'login-ip', fresh, deadline);
  assert.equal((await source.query('SELECT count(*)::int AS live FROM auth_request_limits WHERE "expiresAt">clock_timestamp()'))[0].live, 1);
  assert.equal((await source.query('SELECT 1 FROM auth_request_limits WHERE scope=$1 AND "subjectHash"=$2',
    ['login-ip', digest('login-ip', expired)])).length, 0, 'The held expired row is pruned and committed');
  await limiter(source).admit('login-ip', fresh);
  assert.equal((await ledger(source)).length, 1, 'A subsequent decision prunes every remaining expired row');
  console.log('PASS LIMIT-003-B/004-B pruning lock crosses4096 deadlines; fresh capacity permits a new window without reviving old state');
}

async function storageFailures(source) {
  stage = 'actual advisory lock timeout';
  await clearLedger(source);
  const blocker = source.createQueryRunner(); await blocker.connect();
  let pending;
  try {
    await blocker.startTransaction();
    const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('SELECT pg_advisory_xact_lock($1)', [advisoryKey]);
    const start = performance.now();
    pending = outcome(() => limiter(source).admit('login-ip', 'v4:192.0.2.70/32'));
    await observeWait(source, pid, 1, 'pg_advisory');
    denial(await pending, 503);
    assert.ok(performance.now() - start >= 1500 && performance.now() - start < 6000,
      'Real2s lock timeout has a finite scheduling allowance');
    assert.deepEqual(await ledger(source), []);
  } finally {
    try { if (blocker.isTransactionActive) await blocker.rollbackTransaction(); }
    finally { await blocker.release(); if (pending) await pending; }
  }
  await limiter(source).admit('login-ip', 'v4:192.0.2.70/32');
  assert.equal((await ledger(source))[0].hits, 1);
  console.log('PASS LIMIT-005-B real lock timeout returns safe503 with no admission, followed by explicit successful retry');

  for (const timing of ['query', 'commit']) {
    stage = `real ${timing} failure without retry`;
    await clearLedger(source);
    await source.query('CREATE SEQUENCE auth_limit_fixture_attempts');
    try {
      await source.query(`CREATE FUNCTION auth_limit_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM nextval('auth_limit_fixture_attempts');
        RAISE EXCEPTION 'synthetic-ledger-error %', NEW."subjectHash"; END $$`);
      const declaration = timing === 'commit'
        ? 'CREATE CONSTRAINT TRIGGER auth_limit_fixture_failure AFTER INSERT ON auth_request_limits DEFERRABLE INITIALLY DEFERRED'
        : 'CREATE TRIGGER auth_limit_fixture_failure BEFORE INSERT ON auth_request_limits';
      await source.query(`${declaration} FOR EACH ROW EXECUTE FUNCTION auth_limit_fixture_failure()`);
      const subject = 'sensitive-synthetic-account@example.invalid';
      denial(await outcome(() => limiter(source).admit('login-account', subject)), 503, 600,
        [subject, digest('login-account', subject)]);
      assert.deepEqual(await ledger(source), []);
      const [{ attempts, called }] = await source.query('SELECT last_value::int AS attempts,is_called AS called FROM auth_limit_fixture_attempts');
      assert.deepEqual({ attempts, called }, { attempts: 1, called: true }, 'Nontransactional sequence proves exactly one database attempt');
    } finally {
      await source.query('DROP TRIGGER IF EXISTS auth_limit_fixture_failure ON auth_request_limits');
      await source.query('DROP FUNCTION IF EXISTS auth_limit_fixture_failure()');
      await source.query('DROP SEQUENCE auth_limit_fixture_attempts');
    }
    await limiter(source).admit('login-account', 'sensitive-synthetic-account@example.invalid');
    assert.equal((await ledger(source))[0].hits, 1, 'Explicit retry is admitted after rollback');
    assert.equal(source.driver.master.waitingCount, 0);
    assert.equal(source.driver.master.idleCount, source.driver.master.totalCount,
      'Every real pooled runner has been released after storage failure');
    console.log(`PASS LIMIT-005-B actual PostgreSQL ${timing} refusal rolls back and emits generic503 without internal retry`);
  }
}

async function poolExhaustion(source) {
  stage = 'real production pool checkout timeout and no late admission';
  await clearLedger(source);
  const small = productionSource(1); await small.initialize();
  const held = small.createQueryRunner(); let released = false;
  try {
    await held.connect();
    await held.query('SELECT pg_backend_pid()');
    const pool = small.driver.master;
    assert.equal(pool.options.max, 1);
    assert.equal(pool.options.connectionTimeoutMillis, 5000, 'Installed driver must map the real runtime timeout');
    const subject = 'v4:192.0.2.80/32';
    const start = performance.now();
    denial(await outcome(() => limiter(small).admit('login-ip', subject)), 503);
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 4500 && elapsed < 8500, 'Actual5s checkout timeout, with scheduler tolerance');
    assert.equal(pool.waitingCount, 0, 'Timed-out acquisition must leave no queued late admission');
    assert.deepEqual(await ledger(source), []);
    await held.release(); released = true;
    await new Promise(resolve => setImmediate(resolve));
    await small.query('SELECT 1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pool.waitingCount, 0);
    assert.deepEqual(await ledger(source), [], 'Release and real checkout barrier do not perform a late admission');
    await limiter(small).admit('login-ip', subject);
    assert.equal((await row(source, 'login-ip', subject)).hits, 1, 'Only a fresh explicit request is admitted');
  } finally {
    if (!released) await held.release();
    await small.destroy();
  }
  console.log('PASS LIMIT-005-C real5000ms pool exhaustion fails closed; no queued or late admission after release');
}

async function constraints(source) {
  stage = 'actual PostgreSQL ledger constraints';
  await clearLedger(source);
  const validHash = digest('login-ip', 'v4:192.0.2.90/32');
  const insert = (scope, subjectHash, hits, start, end) => source.query(`INSERT INTO auth_request_limits
    (scope,"subjectHash",hits,"windowStartedAt","expiresAt") VALUES($1,$2,$3,$4,$5)`,
  [scope, subjectHash, hits, start, end]);
  const start = '2026-01-01T00:00:00.000001Z', end = '2026-01-01T00:01:00.000001Z';
  const invalid = [
    ['unknown', validHash, 1, start, end],
    ['login-ip', validHash.toUpperCase(), 1, start, end],
    ['login-ip', 'g'.repeat(64), 1, start, end],
    ['login-ip', validHash.slice(1), 1, start, end],
    ['login-ip', validHash, 0, start, end], ['login-ip', validHash, -1, start, end],
    ['login-ip', validHash, '1.5', start, end],
    ['login-ip', validHash, 1, start, '2026-01-01T00:00:59.000001Z'],
    ['login-ip', validHash, 1, start, '2026-01-01T00:01:01.000001Z'],
    ['login-ip', validHash, 1, '-infinity', end],
    ['login-ip', validHash, 1, start, 'infinity'],
    ['login-ip', validHash, 1, 'infinity', 'infinity'],
  ];
  const valid = ['login-ip', validHash, 1, start, end];
  for (let index = 0; index < valid.length; index++) {
    const entry = [...valid]; entry[index] = null; invalid.push(entry);
  }
  for (const [scope, limit, seconds] of policies) {
    const deadline = seconds === 600 ? '2026-01-01T00:10:00.000001Z' : end;
    invalid.push([scope, validHash, limit + 1, start, deadline]);
  }
  invalid.push(['login-account', validHash, 1, start, end]);
  for (const values of invalid) {
    await assert.rejects(insert(...values), error => ['23514', '23502', '22P02'].includes(error.code));
    assert.deepEqual(await ledger(source), [], 'Rejected schema row must not persist');
  }
  await insert(...valid);
  await assert.rejects(insert(...valid), error => error.code === '23505');
  // Exact microsecond duration is accepted, while a1µs extension is not.
  await assert.rejects(insert('login-ip', digest('login-ip', 'other'), 1, start,
    '2026-01-01T00:01:00.000002Z'), error => error.code === '23514');
  const indexes = await source.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='auth_request_limits'`);
  assert.ok(indexes.some(({ indexdef }) => /\("expiresAt"\)/.test(indexdef)), 'Expiry has an actual index');
  console.log('PASS LIMIT-004 constrained scopes/digests/hits/non-null finite exact windows, composite identity and expiry index');
}

async function main() {
  sentinel();
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      0, 'Refuse any preexisting fixture database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migration = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(migration.error, undefined); assert.equal(migration.signal, null);
  assert.equal(migration.status, 0, 'Actual migration CLI must build the isolated schema');
  const source = productionSource(); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    assert.deepEqual(
      (await source.query('SELECT name FROM migrations ORDER BY timestamp')).map(({ name }) => name),
      expectedMigrationNames,
      'The actual migration CLI must build the complete current thirty-six-migration ledger',
    );
    const before = await nonLedgerFingerprint(source);
    for (const run of [fixedWindows, races, expiryWaits, storageFailures, poolExhaustion, constraints]) {
      await run(source);
      assert.equal(await nonLedgerFingerprint(source), before, 'Every prior owner/auth/financial/migration table remains unchanged');
    }
    console.log('PASS isolated auth-request ledger PostgreSQL acceptance; all prior table rows preserved');
  } finally { await source.destroy(); }
}

const watchdog = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded isolated auth-limit fixture at stage: ${stage}`);
  process.exit(1);
}, 120000);
watchdog.unref();
(process.argv[2] === '--worker' ? workerMain() : main()).catch(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL isolated auth-limit database acceptance at stage: ${stage} (details withheld)`);
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
