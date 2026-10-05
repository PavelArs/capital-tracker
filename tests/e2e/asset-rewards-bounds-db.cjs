'use strict';

// Actual compiled services, separate OS workers and a fresh guarded PostgreSQL database.
const assert = require('node:assert/strict');
const { fork, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
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
const database = 'capital_tracker_asset_rewards_bounds_e2e';
const coverage = '2025-01-01T00:00:00.000Z';
const rewardAt = '2025-01-02T00:00:00.000Z';
let stage = 'isolated prerequisites';
const children = new Set();

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, type) => new (require(`/app/backend/dist/accounting/${file}.js`)[type])(db);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trade: make('trade.service', 'TradeService'),
    reward: make('asset-reward.service', 'AssetRewardService'),
    transfer: make('owned-transfer.service', 'OwnedTransferService'),
  };
}
async function createDatabase() {
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
}
function migrate() {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, 'Actual guarded migration CLI must succeed');
  assert.match(result.stdout, /Migrations applied: 32/);
}
async function fingerprint(db) {
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([
      tablename,
      await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`),
    ]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function unchanged(db, action, status = 409) {
  const before = await fingerprint(db);
  await assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
    'Expected domain rejection, not a SQL/programming failure',
  );
  assert.equal(
    await fingerprint(db),
    before,
    'Rejected request cannot reserve a key or alter rows',
  );
}
async function account(s, owner, name) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await s.trade.initialize(owner, id, {
    requestId: randomUUID(),
    coverageFrom: coverage,
    assertEmpty: true,
  });
  return id;
}
async function instrument(s, owner, name) {
  return (
    await s.accounting.createInstrument(owner, {
      requestId: randomUUID(),
      name,
      symbol: 'RWD',
    })
  ).value.id;
}
const command = (instrumentId, expectedJournalRevision, changes = {}) => ({
  requestId: randomUUID(),
  expectedJournalRevision,
  assertReward: true,
  instrumentId,
  category: 'staking',
  occurredAt: rewardAt,
  orderWithinTimestamp: 0,
  quantity: '2',
  acquisitionBasisUsd: '0',
  incomeValueUsd: '0',
  ...changes,
});
const correction = (version, expectedJournalRevision, changes = {}) => ({
  requestId: randomUUID(),
  expectedJournalRevision,
  expectedVersion: version.version,
  assertReward: true,
  instrumentId: version.instrumentId,
  category: version.category,
  occurredAt: version.occurredAt,
  orderWithinTimestamp: version.orderWithinTimestamp,
  quantity: version.quantity,
  acquisitionBasisUsd: version.acquisitionBasisUsd,
  incomeValueUsd: version.incomeValueUsd,
  ...changes,
});
const journal = async (s, owner, id) => (await s.trade.getJournal(owner, id)).journal;

async function workerMain() {
  const db = source();
  try {
    await db.initialize();
    const [{ pid }] = await db.query('SELECT pg_backend_pid() AS pid');
    process.send({ type: 'ready', pid, processId: process.pid });
    const input = await new Promise((resolve) => process.once('message', resolve));
    try {
      process.send({
        type: 'result',
        value: await services(db).reward.create(input.owner, input.account, input.command),
      });
    } catch (error) {
      process.send({ type: 'result', status: error.getStatus?.() ?? null });
    }
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}
async function worker() {
  const child = fork(__filename, ['--worker'], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  children.add(child);
  let ready;
  let result;
  let failReady;
  let failResult;
  const started = new Promise((resolve, reject) => {
    ready = resolve;
    failReady = reject;
  });
  const finished = new Promise((resolve, reject) => {
    result = resolve;
    failResult = reject;
  });
  void finished.catch(() => {});
  const closed = new Promise((resolve) => child.once('exit', resolve));
  let received = false;
  child.on('message', (message) => {
    if (message.type === 'ready') ready(message);
    if (message.type === 'result') {
      received = true;
      result(message);
    }
  });
  child.on('error', (error) => {
    failReady(error);
    failResult(error);
  });
  child.on('exit', (code) => {
    children.delete(child);
    if (!received) {
      const error = new Error(`Synthetic worker exited without result (${code})`);
      failReady(error);
      failResult(error);
    }
  });
  const identity = await started;
  return {
    ...identity,
    async run(owner, account, command) {
      child.send({ owner, account, command });
      const [value, exitCode] = await Promise.all([finished, closed]);
      assert.equal(exitCode, 0, 'Synthetic service worker exits cleanly');
      return value;
    },
  };
}
async function waitForAdvisory(db, pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.query(
      `SELECT query FROM pg_stat_activity WHERE pid=$1
      AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`,
      [pid],
    );
    if (rows.some((row) => /pg_advisory_xact_lock/.test(row.query))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Actual PostgreSQL owner advisory-lock waiter was not observed');
}
async function processRaces(db, s, owner) {
  stage = 'REWARD-003 separate OS processes owner-lock replay/conflict';
  const token = await instrument(s, owner, 'Race token');
  for (const identical of [true, false]) {
    const id = await account(s, owner, `Reward race ${identical}`);
    const firstCommand = command(token, 0);
    const secondCommand = identical ? firstCommand : command(token, 0);
    const gate = new Client({
      host: settings.DB_HOST,
      port: 5432,
      user: settings.DB_USERNAME,
      password: settings.DB_PASSWORD,
      database,
    });
    await gate.connect();
    let firstResult;
    let secondResult;
    try {
      await gate.query('BEGIN');
      await gate.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0))",
        [owner],
      );
      const first = await worker();
      const second = await worker();
      assert.notEqual(first.pid, second.pid);
      assert.notEqual(first.processId, second.processId);
      firstResult = first.run(owner, id, firstCommand);
      secondResult = second.run(owner, id, secondCommand);
      await Promise.all([waitForAdvisory(db, first.pid), waitForAdvisory(db, second.pid)]);
      await gate.query('COMMIT');
      const results = await Promise.all([firstResult, secondResult]);
      const accepted = results.find((value) => value.value?.created === true);
      assert.ok(accepted, 'Exactly one process persists the new reward');
      if (identical) {
        assert.equal(results.filter((value) => value.value?.created === true).length, 1);
        assert.deepEqual(results.find((value) => value.value?.created === false)?.value, {
          created: false,
          value: accepted.value.value,
        });
      } else {
        assert.deepEqual(
          results.map((value) => value.status ?? (value.value?.created ? 201 : 200)).sort(),
          [201, 409],
        );
        const loser = results[0].value?.created ? secondCommand : firstCommand;
        const [saved] = await db.query(
          'SELECT count(*)::int AS n FROM account_reward_versions WHERE "ownerId"=$1 AND "accountId"=$2 AND "requestId"=$3',
          [owner, id, loser.requestId],
        );
        assert.equal(saved.n, 0, 'Conflicting request identity was not reserved');
        await unchanged(db, () => s.reward.create(owner, id, loser));
      }
      assert.equal((await journal(s, owner, id)).journalRevision, 1);
      const [count] = await db.query(
        'SELECT count(*)::int AS n FROM account_reward_versions WHERE "ownerId"=$1 AND "accountId"=$2',
        [owner, id],
      );
      assert.equal(count.n, 1);
    } finally {
      await gate.query('ROLLBACK');
      await gate.end();
      await Promise.allSettled([firstResult, secondResult].filter(Boolean));
    }
  }
  console.log(
    'PASS REWARD-003 two real process owner-lock races, replay and unreserved conflicting key',
  );
}

async function seedActive(db, owner, accountId, token, count, startOrdinal = 0) {
  const entries = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    request: randomUUID(),
    ordinal: startOrdinal + index,
  }));
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO account_rewards(id,"ownerId","accountId","currentVersion")
      SELECT x.id,$1,$2,1 FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,request uuid,ordinal int)`,
      [owner, accountId, JSON.stringify(entries)],
    );
    await manager.query(
      `INSERT INTO account_reward_versions
      ("ownerId","accountId","rewardId",version,"journalRevision","requestId","canonicalPayload",kind,
       "instrumentId",category,"occurredAt","orderWithinTimestamp",quantity,"acquisitionBasisUsd","incomeValueUsd")
      SELECT $1,$2,x.id,1,x.ordinal+1,x.request,'synthetic-active-cap','create',
        $3,'staking',$4,x.ordinal,1,0,0
      FROM jsonb_to_recordset($5::jsonb) AS x(id uuid,request uuid,ordinal int)`,
      [owner, accountId, token, rewardAt, JSON.stringify(entries)],
    );
    await manager.query(
      'UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, accountId, startOrdinal + count],
    );
  });
}

async function activeLimits(db, s, ownerWide, localOwner) {
  stage = 'REWARD-004 exact owner/local 1000 active rewards';
  const token = await instrument(s, ownerWide, 'Owner active token');
  const a = await account(s, ownerWide, 'Owner active 999');
  const b = await account(s, ownerWide, 'Owner active 1');
  await seedActive(db, ownerWide, a, token, 999);
  const firstCommand = command(token, 0);
  const first = (await s.reward.create(ownerWide, b, firstCommand)).value;
  const [ownerCount] = await db.query(
    'SELECT count(*)::int AS n FROM account_reward_versions WHERE "ownerId"=$1',
    [ownerWide],
  );
  assert.equal(ownerCount.n, 1000);
  assert.equal((await journal(s, ownerWide, a)).rewardSummary.activeCount, 999);
  const overflow = command(token, 1, { orderWithinTimestamp: 1 });
  await unchanged(db, () => s.reward.create(ownerWide, b, overflow));
  assert.deepEqual(await s.reward.create(ownerWide, b, firstCommand), {
    created: false,
    value: first,
  });
  const corrected = await s.reward.correct(
    ownerWide,
    b,
    first.reward.rewardId,
    correction(first.reward, 1, { acquisitionBasisUsd: '7' }),
  );
  assert.equal(
    corrected.value.reward.version,
    2,
    'Correction does not consume an active identity slot',
  );
  assert.equal((await journal(s, ownerWide, b)).rewardSummary.activeCount, 1);
  assert.deepEqual(
    await s.reward.create(ownerWide, b, firstCommand),
    { created: false, value: first },
    'Original receipt survives later revision at owner cap',
  );

  const localToken = await instrument(s, localOwner, 'Local active token');
  const local = await account(s, localOwner, 'Local active 1000');
  await seedActive(db, localOwner, local, localToken, 999);
  const originalCommand = command(localToken, 999, { orderWithinTimestamp: 999 });
  const original = (await s.reward.create(localOwner, local, originalCommand)).value;
  assert.equal((await journal(s, localOwner, local)).rewardSummary.activeCount, 1000);
  await unchanged(db, () =>
    s.reward.create(localOwner, local, command(localToken, 1000, { orderWithinTimestamp: 1000 })),
  );
  assert.deepEqual(await s.reward.create(localOwner, local, originalCommand), {
    created: false,
    value: original,
  });
  const changed = await s.reward.correct(
    localOwner,
    local,
    original.reward.rewardId,
    correction(original.reward, 1000, { acquisitionBasisUsd: '5' }),
  );
  assert.equal(changed.value.reward.version, 2);
  assert.deepEqual(
    await s.reward.create(localOwner, local, originalCommand),
    { created: false, value: original },
    'Original receipt survives later revision at local cap',
  );
  console.log(
    'PASS REWARD-004 exact owner/local 1000 active, next refusal, correction and saved replay',
  );
}

async function versionLimits(db, s, owner) {
  stage = 'REWARD-004 exact owner 10000 versions without local tick exhaustion';
  const token = await instrument(s, owner, 'Version token');
  const a = await account(s, owner, 'Version source');
  const b = await account(s, owner, 'Final owner slot');
  const original = (await s.reward.create(owner, a, command(token, 0))).value;
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO account_reward_versions
      ("ownerId","accountId","rewardId",version,"journalRevision","requestId","canonicalPayload",kind,
       "instrumentId",category,"occurredAt","orderWithinTimestamp",quantity,"acquisitionBasisUsd","incomeValueUsd")
      SELECT v."ownerId",v."accountId",v."rewardId",n,n,gen_random_uuid(),'synthetic-version-cap','correct',
        v."instrumentId",v.category,v."occurredAt",v."orderWithinTimestamp",v.quantity,v."acquisitionBasisUsd",v."incomeValueUsd"
      FROM account_reward_versions v CROSS JOIN generate_series(2,9999) n
      WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."rewardId"=$3 AND v.version=1`,
      [owner, a, original.reward.rewardId],
    );
    await manager.query(
      'UPDATE account_rewards SET "currentVersion"=9999 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
      [owner, a, original.reward.rewardId],
    );
    await manager.query(
      'UPDATE account_trade_journals SET "currentRevision"=9999 WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, a],
    );
  });
  const finalCommand = command(token, 0);
  const final = (await s.reward.create(owner, b, finalCommand)).value;
  const [versions] = await db.query(
    'SELECT count(*)::int AS n FROM account_reward_versions WHERE "ownerId"=$1',
    [owner],
  );
  assert.equal(versions.n, 10000);
  assert.equal((await journal(s, owner, b)).journalRevision, 1);
  await unchanged(db, () =>
    s.reward.create(owner, b, command(token, 1, { orderWithinTimestamp: 1 })),
  );
  await unchanged(db, () =>
    s.reward.correct(
      owner,
      b,
      final.reward.rewardId,
      correction(final.reward, 1, { acquisitionBasisUsd: '3' }),
    ),
  );
  assert.deepEqual(await s.reward.create(owner, b, finalCommand), { created: false, value: final });
  console.log(
    'PASS REWARD-004 exact owner 10000 versions, next refusal and replay with spare local revisions',
  );
}

async function revisionLimits(db, s, localOwner, passiveOwner) {
  stage = 'REWARD-003/004 local and passive revision 10000';
  const localToken = await instrument(s, localOwner, 'Local revision token');
  const local = await account(s, localOwner, 'Local revision account');
  await s.reward.create(localOwner, local, command(localToken, 0));
  // Synthetic prior passive ticks populate only the revision counter, as in connected edits.
  await db.query(
    'UPDATE account_trade_journals SET "currentRevision"=9999 WHERE "ownerId"=$1 AND "accountId"=$2',
    [localOwner, local],
  );
  const finalCommand = command(localToken, 9999, { orderWithinTimestamp: 1 });
  const final = (await s.reward.create(localOwner, local, finalCommand)).value;
  assert.equal(final.journalRevision, 10000);
  await unchanged(db, () =>
    s.reward.create(localOwner, local, command(localToken, 10000, { orderWithinTimestamp: 2 })),
  );
  assert.deepEqual(await s.reward.create(localOwner, local, finalCommand), {
    created: false,
    value: final,
  });

  const token = await instrument(s, passiveOwner, 'Passive revision token');
  const a = await account(s, passiveOwner, 'Passive source');
  const b = await account(s, passiveOwner, 'Passive recipient');
  const originalCommand = command(token, 0, { acquisitionBasisUsd: '100' });
  const first = (await s.reward.create(passiveOwner, a, originalCommand)).value;
  await s.transfer.create(passiveOwner, {
    requestId: randomUUID(),
    fromAccountId: a,
    toAccountId: b,
    expectedFromJournalRevision: 1,
    expectedToJournalRevision: 0,
    assertInternal: true,
    instrumentId: token,
    occurredAt: '2025-01-03T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1',
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  await db.query(
    'UPDATE account_trade_journals SET "currentRevision"=9999 WHERE "ownerId"=$1 AND "accountId"=$2',
    [passiveOwner, b],
  );
  const acceptedCommand = correction(first.reward, 2, { acquisitionBasisUsd: '120' });
  const accepted = (await s.reward.correct(passiveOwner, a, first.reward.rewardId, acceptedCommand))
    .value;
  assert.equal((await journal(s, passiveOwner, b)).journalRevision, 10000);
  assert.equal((await journal(s, passiveOwner, b)).summary.remainingCostUsd, '60');
  await unchanged(db, () =>
    s.reward.correct(
      passiveOwner,
      a,
      first.reward.rewardId,
      correction(accepted.reward, 3, { acquisitionBasisUsd: '140' }),
    ),
  );
  assert.deepEqual(
    await s.reward.correct(passiveOwner, a, first.reward.rewardId, acceptedCommand),
    { created: false, value: accepted },
  );
  console.log('PASS REWARD-003/004 local/passive revision 10000, next refusal and exact replay');
}

async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated synthetic settings required');
  assert.ok(
    existsSync('/app/backend/dist/accounting/asset-reward.service.js'),
    'Missing compiled product module is prerequisite failure, not behavioral RED',
  );
  await createDatabase();
  migrate();
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 32);
    const owners = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('reward-race@example.invalid','synthetic-not-a-hash',true),
      ('reward-owner-active@example.invalid','synthetic-not-a-hash',true),
      ('reward-local-active@example.invalid','synthetic-not-a-hash',true),
      ('reward-version-cap@example.invalid','synthetic-not-a-hash',true),
      ('reward-local-revision@example.invalid','synthetic-not-a-hash',true),
      ('reward-passive-revision@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    await processRaces(db, s, owners[0].id);
    await activeLimits(db, s, owners[1].id, owners[2].id);
    await versionLimits(db, s, owners[3].id);
    await revisionLimits(db, s, owners[4].id, owners[5].id);
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}
const watchdog = setTimeout(() => {
  console.error(`FAIL timeout at ${stage}`);
  process.exit(1);
}, 240000);
watchdog.unref();
(process.argv.includes('--worker') ? workerMain() : main())
  .catch((error) => {
    console.error(`FAIL ${stage}: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(watchdog);
    for (const child of children) child.kill();
  });
