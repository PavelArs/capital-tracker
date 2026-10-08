'use strict';
// Guarded fresh synthetic PostgreSQL and the compiled production HTTPS adapter.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = {
  DB_HOST: 'postgres',
  DB_PORT: '5432',
  DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e',
  DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_fx_e2e';
const providerName = 'exchangerate-api-open';
const providerUrl = 'https://open.er-api.com/v6/latest/USD';
const modulePath = '/app/backend/dist/display-fx/display-fx.service.js';
const controlUrl = 'http://providers:8080/__control';
let stage = 'synthetic configuration';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function service(db, enabled = true) {
  const { DisplayFxService } = require(modulePath);
  const { DisplayFxProvider } = require('/app/backend/dist/display-fx/display-fx-provider.js');
  const config = new ConfigService({
    ...process.env,
    ...settings,
    DB_NAME: database,
    DISPLAY_FX_ENABLED: String(enabled),
    DISPLAY_FX_TRUST_PROXY: 'true',
  });
  return new DisplayFxService(db, config, new DisplayFxProvider(config));
}
async function control(path, value) {
  const response = await fetch(
    `${controlUrl}${path}`,
    value === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        },
  );
  assert.equal(response.status, 200, `Provider fixture ${path} must be available`);
  return response.json();
}
const seconds = () => Math.floor(Date.now() / 1000);
function body(publication, eur = '0.9', rub = '90.12', next = publication + 86400) {
  return (
    `{"result":"success","base_code":"USD","time_last_update_unix":${publication},` +
    `"time_next_update_unix":${next},"time_eol_unix":0,` +
    `"rates":{"USD":1,"EUR":${eur},"RUB":${rub}}}`
  );
}
const quote = (publication, eur, rub, options = {}) => ({
  status: 200,
  body: body(publication, eur, rub),
  ...options,
});
const requests = async () =>
  (await control('/requests')).filter((request) => request.url === providerUrl);
async function setDue(db, clearBudget = true) {
  await db.query(
    `UPDATE display_fx_collection SET "nextAttemptAt"=clock_timestamp()-interval '1 second',
    "leaseId"=NULL,"leaseUntil"=NULL${clearBudget ? ',"reservedAttempts"=ARRAY[]::timestamptz[]' : ''}
    WHERE provider=$1`,
    [providerName],
  );
}
async function rows(db) {
  return db.query('SELECT * FROM display_fx_observations ORDER BY "observedAt"');
}
async function state(db) {
  const [row] = await db.query('SELECT * FROM display_fx_collection WHERE provider=$1', [
    providerName,
  ]);
  return row;
}
async function fingerprint(db) {
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const snapshot = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    snapshot.push([
      tablename,
      await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`),
    ]);
  }
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function exact(db, fx) {
  stage = 'DFX-EXACT saved source precision, zero, replay and private DB-only reads';
  await control('/reset', {});
  const disabled = service(db, false);
  assert.deepEqual(await disabled.collect(), { outcome: 'disabled' });
  assert.equal((await requests()).length, 0);
  assert.equal((await rows(db)).length, 0);
  const first = seconds() - 60;
  await control('/fx', quote(first, '0.9', '90.12'));
  assert.deepEqual(await fx.collect(), { outcome: 'collected' });
  assert.equal((await requests()).length, 1);
  const saved = await rows(db);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].observedAt.toISOString(), new Date(first * 1000).toISOString());
  assert.equal(saved[0].eurRate, '0.900000000000000000000000000000');
  assert.equal(saved[0].rubRate, '90.120000000000000000000000000000');
  const before = await fingerprint(db);
  const report = await fx.read({ amountUsd: '123.45' });
  assert.deepEqual(
    {
      amountUsd: report.amountUsd,
      status: report.status,
      source: report.source,
      kind: report.kind,
      basis: report.basis,
      eurRate: report.observation?.eurRate,
      rubRate: report.observation?.rubRate,
      eurAmount: report.observation?.eurAmount,
      rubAmount: report.observation?.rubAmount,
    },
    {
      amountUsd: '123.45',
      status: 'fresh',
      source: providerName,
      kind: 'indicative-daily',
      basis: 'latest-stored-observation',
      eurRate: '0.9',
      rubRate: '90.12',
      eurAmount: '111.105',
      rubAmount: '11125.314',
    },
  );
  assert.deepEqual(
    [
      (await fx.read({ amountUsd: '0' })).observation.eurAmount,
      (await fx.read({ amountUsd: '0' })).observation.rubAmount,
    ],
    ['0', '0'],
  );
  assert.equal(await fingerprint(db), before, 'DB-only reads preserve all rows');
  assert.equal((await requests()).length, 1, 'DB reads make no provider call');

  await setDue(db);
  await control('/fx', quote(first, '0.9', '90.12'));
  assert.deepEqual(await fx.collect(), { outcome: 'collected' });
  assert.deepEqual(await rows(db), saved, 'Identical publication preserves first fetch receipt');
  await setDue(db);
  await control('/fx', quote(first, '0.91', '90.12'));
  assert.deepEqual(await fx.collect(), { outcome: 'failed' });
  assert.deepEqual(await rows(db), saved, 'Changed publication cannot rewrite saved rates');
  await setDue(db);
  await control('/fx', quote(first - 60, '0.9', '90.12'));
  assert.deepEqual(await fx.collect(), { outcome: 'failed' });
  assert.deepEqual(await rows(db), saved, 'Older publication cannot overwrite latest');
  console.log('PASS DFX-EXACT stored precision, replay, zero and read-only');
  return first;
}

async function concurrency(db, fx, first) {
  stage = 'DFX-COLLECT two-pool lease and persistent rolling budget';
  const second = first + 60;
  const atom = '0.000000000000000000000000000001';
  await setDue(db);
  await control('/fx', quote(second, atom, '91', { delayMs: 500 }));
  const baseline = (await requests()).length;
  const other = source();
  await other.initialize();
  try {
    const [a, b] = await Promise.all([fx.collect(), service(other).collect()]);
    assert.deepEqual([a.outcome, b.outcome].sort(), ['collected', 'in-progress']);
    assert.equal((await requests()).length, baseline + 1, 'Only lease holder reaches fixture');
    assert.equal((await rows(db)).length, 2);
    assert.equal(
      (await fx.read({ amountUsd: atom })).observation.eurAmount,
      `0.${'0'.repeat(59)}1`,
      'Two scale30 input lexemes retain exact scale60 product',
    );
    assert.deepEqual(await service(other).collect(), { outcome: 'cooldown' });
    assert.equal(
      (await requests()).length,
      baseline + 1,
      'Restarted service honors persisted deadline',
    );
  } finally {
    await other.destroy();
  }
  const now = Date.now();
  await db.query(
    `UPDATE display_fx_collection SET "nextAttemptAt"=clock_timestamp()-interval '1 second',
    "reservedAttempts"=ARRAY[$1::timestamptz,$2::timestamptz,$3::timestamptz],
    "leaseId"=NULL,"leaseUntil"=NULL WHERE provider=$4`,
    [
      new Date(now - 23 * 3600000),
      new Date(now - 22 * 3600000),
      new Date(now - 21 * 3600000),
      providerName,
    ],
  );
  const count = (await requests()).length;
  assert.deepEqual(await fx.collect(), { outcome: 'cooldown' });
  assert.equal((await requests()).length, count, 'Three attempts in rolling24h block a fourth');
  assert.ok(
    (await state(db)).nextAttemptAt.getTime() >= now + 3600000 - 2000,
    'Earliest rolling reservation controls next attempt',
  );
  console.log('PASS DFX-COLLECT two-pool lease and rolling24h budget');
}

async function failures(db, fx, first) {
  stage = 'DFX-PRECISION/OUTAGE bounded failures preserve last good';
  const saved = await rows(db);
  const cases = [
    [
      'missing-RUB',
      {
        status: 200,
        body: body(first + 120)
          .replace('"RUB":90.12', '')
          .replace('"EUR":0.9,}', '"EUR":0.9}'),
      },
    ],
    ['exponent', quote(first + 120, '1e-31', '90.12')],
    [
      'wrong-base',
      { status: 200, body: body(first + 120).replace('"base_code":"USD"', '"base_code":"EUR"') },
    ],
    ['http-500', { status: 500, body: '{"error":"private-upstream-marker"}' }],
    ['redirect', { status: 302, body: '{}' }],
    ['timeout', quote(first + 120, '0.9', '90.12', { delayMs: 6000 })],
  ];
  for (const [label, response] of cases) {
    await setDue(db);
    await control('/fx', response);
    const count = (await requests()).length;
    assert.deepEqual(await fx.collect(), { outcome: 'failed' }, label);
    assert.equal((await requests()).length, count + 1, `${label} makes one bounded attempt`);
    assert.deepEqual(await rows(db), saved, `${label} cannot erase last good`);
    assert.equal((await fx.read({ amountUsd: '1' })).status, 'stale', label);
  }
  await setDue(db);
  await control('/fx', { status: 429, body: '{"error":"throttled"}', retryAfter: '1200' });
  const before = (await requests()).length;
  assert.deepEqual(await fx.collect(), { outcome: 'rate-limited' });
  assert.equal((await requests()).length, before + 1);
  assert.ok((await state(db)).nextAttemptAt.getTime() >= Date.now() + 1190_000);
  assert.deepEqual(await fx.collect(), { outcome: 'cooldown' });
  assert.equal((await requests()).length, before + 1);
  assert.deepEqual(await rows(db), saved);
  console.log('PASS DFX-PRECISION/OUTAGE failure, redirect, timeout and429');
}

async function fenceAndRollback(db, fx, first) {
  stage = 'DFX-FENCE replaced token, expired original lease and deferred COMMIT failure';
  await setDue(db);
  await control('/fx', quote(first + 120, '0.7', '92', { delayMs: 500 }));
  const before = await rows(db);
  const count = (await requests()).length;
  const pending = fx.collect();
  await until(async () => (await requests()).length > count, 'provider call before fencing');
  await db.query(
    `UPDATE display_fx_collection SET "leaseId"=$1,"leaseUntil"=clock_timestamp()+interval '30 seconds'
    WHERE provider=$2`,
    [randomUUID(), providerName],
  );
  const replacement = await state(db);
  assert.deepEqual(await pending, { outcome: 'superseded' });
  assert.deepEqual(await rows(db), before);
  assert.deepEqual(await state(db), replacement, 'Old worker cannot change successor health');
  assert.equal((await state(db)).reservedAttempts.length, 1, 'Fenced reservation stays spent');

  await setDue(db);
  await control('/fx', quote(first + 150, '0.65', '92.5', { delayMs: 500 }));
  const beforeExpiry = (await requests()).length;
  const expired = fx.collect();
  await until(async () => (await requests()).length > beforeExpiry, 'provider call before expiry');
  const original = await state(db);
  await db.query(`UPDATE display_fx_collection SET "leaseUntil"=clock_timestamp()-interval '1 second'
    WHERE provider=$1`, [providerName]);
  const expiredState = await state(db);
  assert.equal(expiredState.leaseId, original.leaseId, 'Expiry keeps the original token');
  assert.deepEqual(await expired, { outcome: 'superseded' });
  assert.deepEqual(await rows(db), before, 'Expired original worker cannot publish');
  assert.deepEqual(await state(db), expiredState, 'Expired worker cannot update health or refund its attempt');
  assert.equal((await fx.read({ amountUsd: '1' })).collection.outcome, 'interrupted');

  await setDue(db);
  await db.query('CREATE SEQUENCE fx_commit_witness');
  await db.query(`CREATE FUNCTION reject_fx_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM nextval('fx_commit_witness');
    RAISE EXCEPTION 'synthetic deferred fx commit rejection'; END $$`);
  await db.query(`CREATE CONSTRAINT TRIGGER reject_fx_commit AFTER INSERT ON display_fx_observations
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_fx_commit()`);
  try {
    await control('/fx', quote(first + 180, '0.6', '93', { delayMs: 500 }));
    const beforeCommit = (await requests()).length;
    const committing = fx.collect().catch((error) => error);
    await until(async () => (await requests()).length > beforeCommit, 'provider call before commit');
    const reserved = await state(db);
    const result = await committing;
    assert.ok(result instanceof Error, 'Commit rejection must fail collection');
    assert.equal(result.driverError?.code ?? result.code, 'P0001');
    assert.equal(result.message, 'synthetic deferred fx commit rejection');
    const [witness] = await db.query('SELECT last_value::int, is_called FROM fx_commit_witness');
    assert.deepEqual(witness, { last_value: 1, is_called: true }, 'Deferred INSERT trigger actually ran');
    assert.deepEqual(await rows(db), before, 'Failed COMMIT rolls back both prices');
    assert.deepEqual(await state(db), reserved, 'Failed COMMIT rolls back completion status and timestamps');
    assert.equal(
      (await state(db)).reservedAttempts.length,
      1,
      'Failed COMMIT cannot refund reservation',
    );
  } finally {
    await db.query('DROP TRIGGER reject_fx_commit ON display_fx_observations');
    await db.query('DROP FUNCTION reject_fx_commit()');
    await db.query('DROP SEQUENCE fx_commit_witness');
  }
  console.log('PASS DFX-FENCE replaced token, expired original lease and witnessed deferred COMMIT rollback');
}

async function readonlyBarrier(db, first) {
  stage = 'DFX-PRIVATE actual repeatable-read observation and collection snapshot';
  const old = await service(db).read({ amountUsd: '2' });
  const outbound = (await requests()).length;
  const reader = source();
  await reader.initialize();
  let release;
  let arrived;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const barrier = new Promise((resolve) => {
    arrived = resolve;
  });
  const statements = [];
  const original = reader.createQueryRunner.bind(reader);
  let paused = false;
  reader.createQueryRunner = (...args) => {
    const runner = original(...args);
    const query = runner.query.bind(runner);
    runner.query = async (sql, ...rest) => {
      statements.push(sql);
      const result = await query(sql, ...rest);
      if (
        !paused &&
        /^\s*(SELECT|WITH)\b/i.test(sql) &&
        /display_fx_(observations|collection)/.test(sql)
      ) {
        paused = true;
        assert.ok(runner.isTransactionActive, 'Barrier must be inside actual transaction');
        arrived();
        await gate;
      }
      return result;
    };
    return runner;
  };
  let pending;
  const timeout = setTimeout(() => release(), 10000);
  try {
    pending = service(reader).read({ amountUsd: '2' });
    await Promise.race([
      barrier,
      pending.then(() => {
        throw new Error('Missing DB read barrier');
      }),
    ]);
    assert.ok(statements.some((sql) => /REPEATABLE READ/.test(sql)));
    assert.ok(statements.some((sql) => /READ ONLY/.test(sql)));
    const latest = first + 240;
    await db.query(
      `INSERT INTO display_fx_observations
      (provider,base,"observedAt","fetchedAt","nextUpdateAt","endOfLifeAt","eurRate","rubRate")
      VALUES ($1,'USD',$2::timestamptz,clock_timestamp(),$3::timestamptz,NULL,0.5,95)`,
      [providerName, new Date(latest * 1000), new Date((latest + 86400) * 1000)],
    );
    release();
    assert.deepEqual(await pending, old, 'Paused read is wholly the earlier database snapshot');
    const newer = await service(db).read({ amountUsd: '2' });
    assert.equal(newer.observation.observedAt, new Date(latest * 1000).toISOString());
    assert.equal(newer.observation.eurAmount, '1');
    assert.equal((await requests()).length, outbound, 'Both reads remain database-only');
  } finally {
    clearTimeout(timeout);
    release();
    await pending?.catch(() => {});
    await reader.destroy();
  }
  console.log('PASS DFX-PRIVATE actual RR barrier and zero-provider reads');
}

async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact synthetic database settings required');
  assert.equal(process.env.DISPLAY_FX_TRUST_PROXY, 'true');
  assert.equal(process.env.HTTPS_PROXY, 'http://providers:8080');
  assert.ok(
    require('node:fs').existsSync(modulePath),
    'Missing compiled service is prerequisite, not RED',
  );
  assert.ok(require('node:fs').existsSync('/app/backend/dist/display-fx/display-fx-provider.js'));
  const admin = new Client({
    host: settings.DB_HOST,
    port: 5432,
    user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    database: settings.DB_NAME,
  });
  await admin.connect();
  try {
    assert.equal(
      (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      0,
      'Never reuse or drop an existing database',
    );
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(migrated.status, 0, 'Actual migration22 must succeed');
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 39);
    const fx = service(db);
    const first = await exact(db, fx);
    await concurrency(db, fx, first);
    await failures(db, fx, first);
    await fenceAndRollback(db, fx, first);
    await readonlyBarrier(db, first);
    stage = 'DFX-MIGRATE downgrade refuses without mutation';
    const { AddDailyDisplayFx1790090000000 } = require('/app/backend/dist/migrations/1790090000000-AddDailyDisplayFx.js');
    const beforeDowngrade = await fingerprint(db);
    await assert.rejects(new AddDailyDisplayFx1790090000000().down(), /explicit recovery plan/);
    assert.equal(await fingerprint(db), beforeDowngrade, 'Downgrade refusal preserves all rows');
    console.log('PASS DFX-MIGRATE destructive downgrade refused without mutation');
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}

const watchdog = setTimeout(() => {
  console.error(`FAIL timeout at ${stage}`);
  process.exit(1);
}, 180000);
watchdog.unref();
main()
  .catch((error) => {
    const detail =
      error instanceof assert.AssertionError ? error.message : error?.name || 'unexpected error';
    console.error(`FAIL ${stage}: ${detail}`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
