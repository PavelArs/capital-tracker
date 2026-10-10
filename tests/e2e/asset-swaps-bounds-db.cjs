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
const database = 'capital_tracker_asset_swaps_bounds_e2e';
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
    swap: make('asset-swap.service', 'AssetSwapService'),
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
  assert.match(result.stdout, /Migrations applied: 55/);
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
        value: await services(db)[input.operation].create(
          input.owner,
          input.account,
          input.command,
        ),
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
    async run(owner, account, command, operation = 'swap') {
      child.send({ owner, account, command, operation });
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

const swapAt = '2025-01-03T00:00:00.000Z';
const journal = async (s, owner, id) => (await s.trade.getJournal(owner, id)).journal;
const command = (
  outgoingInstrumentId,
  incomingInstrumentId,
  expectedJournalRevision,
  changes = {},
) => ({
  requestId: randomUUID(),
  expectedJournalRevision,
  assertExecuted: true,
  outgoingInstrumentId,
  incomingInstrumentId,
  occurredAt: swapAt,
  orderWithinTimestamp: 0,
  outgoingQuantity: '1',
  incomingQuantity: '1',
  considerationUsd: '1',
  feeSource: null,
  feeInstrumentId: null,
  feeQuantity: '0',
  ...changes,
});
async function funded(s, owner, name) {
  const id = await account(s, owner, name);
  const out = await instrument(s, owner, `${name} outgoing`);
  const incoming = await instrument(s, owner, `${name} incoming`);
  await s.reward.create(owner, id, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    assertReward: true,
    instrumentId: out,
    category: 'staking',
    occurredAt: rewardAt,
    orderWithinTimestamp: 0,
    quantity: '2000',
    acquisitionBasisUsd: '2000',
    incomeValueUsd: null,
  });
  return { id, out, incoming };
}

async function processRaces(db, s, owner) {
  stage = 'SWAP-003-B separate process owner-lock and CAS races';
  for (const kind of ['identical', 'same-pin', 'same-key', 'trade']) {
    const { id, out, incoming } = await funded(s, owner, `Swap race ${kind}`);
    const firstCommand = command(out, incoming, 1);
    const secondCommand =
      kind === 'identical'
        ? firstCommand
        : kind === 'same-key'
          ? { ...firstCommand, considerationUsd: '2' }
          : kind === 'trade'
            ? {
                requestId: randomUUID(),
                expectedJournalRevision: 1,
                instrumentId: out,
                side: 'sell',
                occurredAt: swapAt,
                orderWithinTimestamp: 0,
                quantity: '1',
                grossUsd: '2',
                feeUsd: '0',
              }
            : command(out, incoming, 1);
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
      secondResult = second.run(owner, id, secondCommand, kind === 'trade' ? 'trade' : 'swap');
      await Promise.all([waitForAdvisory(db, first.pid), waitForAdvisory(db, second.pid)]);
      await gate.query('COMMIT');
      const results = await Promise.all([firstResult, secondResult]);
      const accepted = results.find((row) => row.value?.created === true);
      assert.ok(accepted);
      assert.equal(results.filter((row) => row.value?.created === true).length, 1);
      if (kind === 'identical') {
        assert.deepEqual(results.find((row) => row.value?.created === false)?.value, {
          created: false,
          value: accepted.value.value,
        });
      } else {
        assert.deepEqual(
          results.map((row) => row.status ?? (row.value?.created ? 201 : 200)).sort(),
          [201, 409],
        );
        const firstWon = results[0].value?.created === true;
        const loser = firstWon ? secondCommand : firstCommand;
        const operation = firstWon && kind === 'trade' ? 'trade' : 'swap';
        if (kind !== 'same-key') {
          const table = operation === 'trade' ? 'account_trade_versions' : 'account_swap_versions';
          assert.equal(
            (
              await db.query(
                `SELECT count(*)::int n FROM ${table} WHERE "ownerId"=$1 AND "accountId"=$2 AND "requestId"=$3`,
                [owner, id, loser.requestId],
              )
            )[0].n,
            0,
            'Losing key is never reserved',
          );
        }
        await unchanged(db, () => s[operation].create(owner, id, loser));
      }
      const current = await journal(s, owner, id);
      assert.equal(current.journalRevision, 2);
      assert.equal((current.swapSummary?.activeCount ?? 0) + current.versionCount, 1);
      const lots = (await s.trade.listLots(owner, id, {})).items;
      assert.equal(lots.find((lot) => lot.instrumentId === out).remainingQuantity, '1999');
    } finally {
      await gate.query('ROLLBACK');
      await gate.end();
      await Promise.allSettled([firstResult, secondResult].filter(Boolean));
    }
  }
  console.log(
    'PASS SWAP-003-B four two-process races: identical replay, same pin, changed same key, swap versus trade; actual advisory waiters and atomic state',
  );
}

async function seedActive(db, owner, f, count, startOrdinal = 0, revision = 1) {
  // Bulk setup only; the boundary command and every refusal use real services.
  const entries = Array.from({ length: count }, (_, order) => ({
    id: randomUUID(),
    request: randomUUID(),
    order: startOrdinal + order,
  }));
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO account_swaps(id,"ownerId","accountId","currentVersion")
      SELECT x.id,$1,$2,1 FROM jsonb_to_recordset($3::jsonb) x(id uuid,request uuid,"order" int)`,
      [owner, f.id, JSON.stringify(entries)],
    );
    await manager.query(
      `INSERT INTO account_swap_versions
      ("ownerId","accountId","swapId",version,"journalRevision","requestId","canonicalPayload",kind,
       "outgoingInstrumentId","incomingInstrumentId","occurredAt","orderWithinTimestamp",
       "outgoingQuantity","incomingQuantity","considerationUsd","feeSource","feeInstrumentId","feeQuantity")
      SELECT $1,$2,x.id,1,x."order"+$7,x.request,'synthetic-active-bound','create',$3,$4,$5,x."order",1,1,1,NULL,NULL,0
      FROM jsonb_to_recordset($6::jsonb) x(id uuid,request uuid,"order" int)`,
      [
        owner,
        f.id,
        f.out,
        f.incoming,
        swapAt,
        JSON.stringify(entries),
        revision - startOrdinal + 1,
      ],
    );
    await manager.query(
      'UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, f.id, revision + count],
    );
  });
}

async function activeLimits(db, s, owner, localOwner) {
  stage = 'SWAP-004-B exact owner/account active capacity and pinned pages';
  const a = await funded(s, owner, 'Owner 999');
  const b = await funded(s, owner, 'Owner last slot');
  await seedActive(db, owner, a, 999);
  const lastCommand = command(b.out, b.incoming, 1);
  const last = (await s.swap.create(owner, b.id, lastCommand)).value;
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM account_swaps WHERE "ownerId"=$1', [owner]))[0].n,
    1000,
  );
  await unchanged(db, () =>
    s.swap.create(owner, b.id, command(b.out, b.incoming, 2, { orderWithinTimestamp: 1 })),
  );
  const correction = {
    ...lastCommand,
    requestId: randomUUID(),
    expectedJournalRevision: 2,
    expectedVersion: 1,
    considerationUsd: '7',
  };
  assert.equal(
    (await s.swap.correct(owner, b.id, last.swap.swapId, correction)).value.swap.version,
    2,
  );
  assert.deepEqual(await s.swap.create(owner, b.id, lastCommand), { created: false, value: last });

  const f = await funded(s, localOwner, 'Local 1000');
  await seedActive(db, localOwner, f, 999);
  const input = command(f.out, f.incoming, 1000, { orderWithinTimestamp: 999 });
  const saved = (await s.swap.create(localOwner, f.id, input)).value;
  const current = await journal(s, localOwner, f.id);
  assert.equal(current.swapSummary.activeCount, 1000);
  assert.equal(current.swapSummary.principalBasisUsd, '1000');
  assert.equal(current.swapSummary.realizedUsd, '0');
  await unchanged(db, () =>
    s.swap.create(
      localOwner,
      f.id,
      command(f.out, f.incoming, 1001, { orderWithinTimestamp: 1000 }),
    ),
  );
  const ids = new Set();
  let offset = 0;
  do {
    const page = await s.swap.list(localOwner, f.id, {
      limit: '100',
      offset: String(offset),
      journalRevision: '1001',
    });
    assert.equal(page.activeCount, 1000);
    assert.equal(page.versionCount, 1000);
    assert.equal(page.items.length, 100);
    for (const row of page.items) {
      assert.equal(ids.has(row.swapId), false);
      ids.add(row.swapId);
    }
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(ids.size, 1000, 'Every identity is accessible without truncation');
  const revised = {
    ...input,
    requestId: randomUUID(),
    expectedJournalRevision: 1001,
    expectedVersion: 1,
    considerationUsd: '5',
  };
  assert.equal(
    (await s.swap.correct(localOwner, f.id, saved.swap.swapId, revised)).value.swap.version,
    2,
  );
  await unchanged(db, () =>
    s.swap.list(localOwner, f.id, { offset: '100', journalRevision: '1001' }),
  );
  assert.deepEqual(await s.swap.create(localOwner, f.id, input), { created: false, value: saved });
  console.log(
    'PASS SWAP-004-B owner/account 1000th active accepted, next refused, correction/replay and all 1000 pinned heads',
  );
}

async function versionLimits(db, s, owner) {
  stage = 'SWAP-004-B owner 10000 versions with spare local ticks';
  const a = await funded(s, owner, 'Version source');
  const b = await funded(s, owner, 'Version last slot');
  const input = command(a.out, a.incoming, 1);
  const first = (await s.swap.create(owner, a.id, input)).value;
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO account_swap_versions
      SELECT p.* FROM account_swap_versions v CROSS JOIN generate_series(2,9999) n
      CROSS JOIN LATERAL jsonb_populate_record(NULL::account_swap_versions,to_jsonb(v)||jsonb_build_object(
        'version',n,'journalRevision',n+1,'requestId',gen_random_uuid(),'kind','correct','canonicalPayload','synthetic-version-bound')) p
      WHERE v."swapId"=$1 AND v.version=1`,
      [first.swap.swapId],
    );
    await manager.query('UPDATE account_swaps SET "currentVersion"=9999 WHERE id=$1', [
      first.swap.swapId,
    ]);
    await manager.query(
      'UPDATE account_trade_journals SET "currentRevision"=10000 WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, a.id],
    );
  });
  const finalCommand = command(b.out, b.incoming, 1);
  const last = (await s.swap.create(owner, b.id, finalCommand)).value;
  assert.equal(
    (
      await db.query('SELECT count(*)::int n FROM account_swap_versions WHERE "ownerId"=$1', [
        owner,
      ])
    )[0].n,
    10000,
  );
  assert.equal((await journal(s, owner, b.id)).journalRevision, 2);
  await unchanged(db, () =>
    s.swap.create(owner, b.id, command(b.out, b.incoming, 2, { orderWithinTimestamp: 1 })),
  );
  await unchanged(db, () =>
    s.swap.correct(owner, b.id, last.swap.swapId, {
      ...finalCommand,
      requestId: randomUUID(),
      expectedJournalRevision: 2,
      expectedVersion: 1,
      considerationUsd: '3',
    }),
  );
  await unchanged(db, () =>
    s.swap.void(owner, b.id, last.swap.swapId, {
      requestId: randomUUID(),
      expectedJournalRevision: 2,
      expectedVersion: 1,
    }),
  );
  assert.deepEqual(await s.swap.create(owner, a.id, input), { created: false, value: first });
  assert.deepEqual(await s.swap.create(owner, b.id, finalCommand), { created: false, value: last });
  const page = await s.swap.listVersions(owner, a.id, first.swap.swapId, { limit: '20' });
  assert.deepEqual(
    page.items.map((row) => row.version),
    Array.from({ length: 20 }, (_, index) => 9999 - index),
  );
  assert.equal(page.nextBeforeVersion, 9980);
  const end = await s.swap.listVersions(owner, a.id, first.swap.swapId, { beforeVersion: '3' });
  assert.deepEqual(
    end.items.map((row) => row.version),
    [2, 1],
  );
  assert.equal(end.nextBeforeVersion, null);
  console.log(
    'PASS SWAP-004-B 10000 owner versions, spare local ticks, create/correct/void refusal, retained replay and descending version pages',
  );
}

async function revisionLimits(db, s, localOwner, passiveOwner) {
  stage = 'SWAP-003/004 local/passive revision budgets';
  const f = await funded(s, localOwner, 'Local revision');
  await db.query(
    'UPDATE account_trade_journals SET "currentRevision"=9999 WHERE "ownerId"=$1 AND "accountId"=$2',
    [localOwner, f.id],
  );
  const input = command(f.out, f.incoming, 9999);
  const last = (await s.swap.create(localOwner, f.id, input)).value;
  assert.equal(last.journalRevision, 10000);
  await unchanged(db, () =>
    s.swap.create(localOwner, f.id, command(f.out, f.incoming, 10000, { orderWithinTimestamp: 1 })),
  );
  assert.deepEqual(await s.swap.create(localOwner, f.id, input), { created: false, value: last });
  const a = await funded(s, passiveOwner, 'Passive revision');
  const b = await account(s, passiveOwner, 'Passive recipient');
  const original = command(a.out, a.incoming, 1, {
    incomingQuantity: '2',
    considerationUsd: '100',
  });
  const first = (await s.swap.create(passiveOwner, a.id, original)).value;
  await s.transfer.create(passiveOwner, {
    requestId: randomUUID(),
    fromAccountId: a.id,
    toAccountId: b,
    expectedFromJournalRevision: 2,
    expectedToJournalRevision: 0,
    assertInternal: true,
    instrumentId: a.incoming,
    occurredAt: '2025-01-04T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1',
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  await db.query(
    'UPDATE account_trade_journals SET "currentRevision"=9999 WHERE "ownerId"=$1 AND "accountId"=$2',
    [passiveOwner, b],
  );
  const correction = {
    ...original,
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    expectedVersion: 1,
    considerationUsd: '120',
  };
  const accepted = (await s.swap.correct(passiveOwner, a.id, first.swap.swapId, correction)).value;
  assert.equal((await journal(s, passiveOwner, b)).journalRevision, 10000);
  assert.equal((await journal(s, passiveOwner, b)).summary.remainingCostUsd, '60');
  await unchanged(db, () =>
    s.swap.correct(passiveOwner, a.id, first.swap.swapId, {
      ...correction,
      requestId: randomUUID(),
      expectedJournalRevision: 4,
      expectedVersion: 2,
      considerationUsd: '140',
    }),
  );
  assert.deepEqual(await s.swap.correct(passiveOwner, a.id, first.swap.swapId, correction), {
    created: false,
    value: accepted,
  });
  console.log(
    'PASS SWAP-003/004 local/passive 10000th tick, exact connected basis, refusal and saved replay',
  );
}

async function componentPreflight(db, s, owner) {
  stage = 'SWAP-004-B aggregate component capacity before row materialization';
  const a = await funded(s, owner, 'Component left');
  const b = await funded(s, owner, 'Component right');
  await seedActive(db, owner, a, 500);
  await seedActive(db, owner, b, 500);
  await s.transfer.create(owner, {
    requestId: randomUUID(),
    fromAccountId: a.id,
    toAccountId: b.id,
    expectedFromJournalRevision: 501,
    expectedToJournalRevision: 501,
    assertInternal: true,
    instrumentId: a.out,
    occurredAt: '2025-01-04T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1',
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  assert.equal((await journal(s, owner, a.id)).swapSummary.activeCount, 500);
  assert.equal((await journal(s, owner, b.id)).swapSummary.activeCount, 500);
  // Corrupt/oversized storage is injected only into this disposable owner's fixture.
  // Each account remains below1000; only the connected sum now exceeds the bound.
  await seedActive(db, owner, b, 1, 500, 502);
  const statements = [];
  const createRunner = db.createQueryRunner.bind(db);
  db.createQueryRunner = (...args) => {
    const runner = createRunner(...args);
    const query = runner.query.bind(runner);
    runner.query = (sql, ...rest) => {
      statements.push(sql);
      return query(sql, ...rest);
    };
    return runner;
  };
  try {
    await unchanged(db, () => journal(s, owner, a.id));
    assert.equal(
      statements.filter(
        (sql) =>
          /SELECT v\."accountId",count\(\*\) FILTER/.test(sql) &&
          sql.includes('FROM account_swap_versions v'),
      ).length,
      1,
    );
    assert.equal(
      statements.filter((sql) => /SELECT v\.\*[\s\S]*FROM account_swap_versions/.test(sql)).length,
      0,
      'Oversized connected swaps are refused before any full swap rows load',
    );
  } finally {
    db.createQueryRunner = createRunner;
  }
  console.log(
    'PASS SWAP-004-B connected1000 reads, aggregate1001 refused before materialization without truncation or writes',
  );
}

async function allocationPages(db, s, owner) {
  stage = 'SWAP-004-B full totals across swap allocation pages and upstream stale pins';
  const id = await account(s, owner, 'Wide allocation');
  const out = await instrument(s, owner, 'Wide outgoing');
  const incoming = await instrument(s, owner, 'Wide incoming');
  const trades = Array.from({ length: 101 }, (_, order) => ({
    id: randomUUID(),
    request: randomUUID(),
    order,
  }));
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO account_trades(id,"ownerId","accountId","currentVersion")
      SELECT x.id,$1,$2,1 FROM jsonb_to_recordset($3::jsonb) x(id uuid,request uuid,"order" int)`,
      [owner, id, JSON.stringify(trades)],
    );
    await manager.query(
      `INSERT INTO account_trade_versions
      ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind,
       "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd")
      SELECT $1,$2,x.id,1,x."order"+1,x.request,'synthetic-allocation-lot','create',$3,'buy',$4,x."order",1,1,0
      FROM jsonb_to_recordset($5::jsonb) x(id uuid,request uuid,"order" int)`,
      [owner, id, out, coverage, JSON.stringify(trades)],
    );
    await manager.query(
      'UPDATE account_trade_journals SET "currentRevision"=101 WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, id],
    );
  });
  const input = command(out, incoming, 101, {
    outgoingQuantity: '101',
    incomingQuantity: '3',
    considerationUsd: '150',
    feeSource: 'incoming',
    feeInstrumentId: incoming,
    feeQuantity: '0.1',
  });
  const saved = (await s.swap.create(owner, id, input)).value;
  const collected = [];
  let offset = 0;
  do {
    const page = await s.swap.getAllocation(owner, id, saved.swap.swapId, {
      limit: '50',
      offset: String(offset),
      journalRevision: '102',
      expectedVersion: '1',
    });
    assert.equal(page.considerationUsd, '150');
    assert.equal(page.principalBasisUsd, '101');
    assert.equal(page.feeConsumedBasisUsd, '5');
    assert.equal(page.realizedUsd, '44', 'Every page includes complete totals, never its subtotal');
    assert.equal(page.items.length, offset === 100 ? 2 : 50);
    collected.push(...page.items);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(
    collected.slice(0, 101).map((row) => row.origin.tradeId),
    trades.map((row) => row.id),
  );
  assert.ok(
    collected
      .slice(0, 101)
      .every((row) => row.kind === 'principal' && row.quantity === '1' && row.costUsd === '1'),
  );
  assert.equal(collected[101].origin.swapId, saved.swap.swapId);
  assert.equal(collected[101].kind, 'fee');
  assert.equal(collected[101].intervalStart, '0');
  assert.equal(collected[101].intervalEnd, '0.1');
  await s.trade.correct(owner, id, trades[0].id, {
    requestId: randomUUID(),
    expectedJournalRevision: 102,
    instrumentId: out,
    side: 'buy',
    occurredAt: coverage,
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '2',
    feeUsd: '0',
  });
  await unchanged(db, () =>
    s.swap.getAllocation(owner, id, saved.swap.swapId, {
      offset: '50',
      journalRevision: '102',
      expectedVersion: '1',
    }),
  );
  const fresh = await s.swap.getAllocation(owner, id, saved.swap.swapId, { limit: '1' });
  assert.equal(
    fresh.version,
    1,
    'Upstream trade change invalidates journal pin without inventing a swap version',
  );
  assert.equal(fresh.journalRevision, 103);
  assert.equal(fresh.principalBasisUsd, '102');
  assert.equal(fresh.realizedUsd, '43');
  assert.deepEqual(await s.swap.create(owner, id, input), { created: false, value: saved });
  console.log(
    'PASS SWAP-004-B 102 allocation fragments across3pages, full totals/original intervals, upstream pin invalidation and unchanged original receipt',
  );
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value);
  assert.ok(existsSync('/app/backend/dist/accounting/asset-swap.service.js'));
  await createDatabase();
  migrate();
  const db = source();
  try {
    await db.initialize();
    const owners = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('swap-race@example.invalid','synthetic-not-a-hash',true),
      ('swap-owner-active@example.invalid','synthetic-not-a-hash',true),
      ('swap-local-active@example.invalid','synthetic-not-a-hash',true),
      ('swap-version-cap@example.invalid','synthetic-not-a-hash',true),
      ('swap-local-revision@example.invalid','synthetic-not-a-hash',true),
      ('swap-passive-revision@example.invalid','synthetic-not-a-hash',true),
      ('swap-component-cap@example.invalid','synthetic-not-a-hash',true),
      ('swap-allocation-pages@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    await processRaces(db, s, owners[0].id);
    await activeLimits(db, s, owners[1].id, owners[2].id);
    await versionLimits(db, s, owners[3].id);
    await revisionLimits(db, s, owners[4].id, owners[5].id);
    await componentPreflight(db, s, owners[6].id);
    await allocationPages(db, s, owners[7].id);
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
