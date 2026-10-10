'use strict';

// Actual compiled service, explicit migrations, and a fresh isolated PostgreSQL DB.
// A missing implementation is a prerequisite (exit 2), never behavioral RED.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { readSync, writeSync, existsSync } = require('node:fs');
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
const database = 'capital_tracker_flows_e2e';
const modulePath = '/app/backend/dist/accounting/portfolio-flow.service.js';
const migrationPath = '/app/backend/dist/migrations/1790070000000-AddExternalUsdFlows.js';
const coverage = '2025-01-01T00:00:00.000Z';
const jan2 = '2025-01-02T00:00:00.000Z';
const jan3 = '2025-01-03T00:00:00.000Z';
const jan4 = '2025-01-04T00:00:00.000Z';
const jan5 = '2025-01-05T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
// Independent Decimal(precision 100) oracle: 1000 * maximum, canonical scale.
const thousandMaximum =
  '999999999999999999999999999999999999999999999999999.999999999999999999999999999';
const nineHundredNinetyNineMaximum =
  '998999999999999999999999999999999999999999999999999.999999999999999999999999999001';
const children = new Set();
let stage = 'isolated setup';

function sentinel(worker = false) {
  for (const [key, value] of Object.entries(settings))
    assert.equal(
      process.env[key],
      worker && key === 'DB_NAME' ? database : value,
      'Exact synthetic settings required',
    );
}

function sourceFor(statements, singleConnection = false) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  if (singleConnection) options.extra = { ...options.extra, max: 1 };
  if (statements) {
    options.logging = ['query'];
    options.logger = {
      logQuery: (query) => statements.push(query),
      logQueryError() {},
      logQuerySlow() {},
      logSchemaBuild() {},
      logMigration() {},
      log() {},
    };
  }
  return new DataSource(options);
}

function service(source) {
  const { PortfolioFlowService } = require(modulePath);
  return new PortfolioFlowService(source);
}

async function fingerprint(source, oldOnly = false) {
  const tables = await source.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const values = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    if (oldOnly && tablename.startsWith('portfolio_flow_')) continue;
    const rows = await source.query(
      `SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`,
    );
    values.push([tablename, rows]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

async function refusal(action, expected) {
  let actual;
  try {
    await action();
  } catch (error) {
    actual = error?.getStatus?.() ?? 'non-HTTP';
  }
  if (actual !== expected)
    console.error(`REFUSAL expected${expected}, received${actual ?? 'success'} at ${stage}`);
  assert.equal(actual, expected, 'Expected the specified private domain refusal');
}

async function checkedRead(source, statements, action) {
  const before = await fingerprint(source);
  const start = statements.length;
  const value = await action();
  const read = statements.slice(start);
  assert.ok(
    read.some((sql) => /REPEATABLE READ/i.test(sql)),
    'GET uses RR',
  );
  assert.ok(
    read.some((sql) => /READ ONLY/i.test(sql)),
    'GET sets transaction read-only',
  );
  assert.ok(
    !read.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)),
    'GET issues no business write',
  );
  assert.equal(await fingerprint(source), before, 'GET preserves all rows');
  return value;
}

const origin = (requestId = randomUUID()) => ({
  requestId,
  coverageFrom: coverage,
  assertReviewed: true,
});
const command = (revision, direction, occurredAt, amountUsd, requestId = randomUUID()) => ({
  requestId,
  expectedJournalRevision: revision,
  direction,
  occurredAt,
  amountUsd,
  assertExternal: true,
});
const voidCommand = (revision, requestId = randomUUID()) => ({
  requestId,
  expectedJournalRevision: revision,
});
const period = (from = coverage, to = jan5, extras = {}) => ({ from, to, ...extras });
const totals = (contributionsUsd, withdrawalsUsd, netContributionsUsd, flowCount) => ({
  contributionsUsd,
  withdrawalsUsd,
  netContributionsUsd,
  flowCount,
});

async function seedOwners(source) {
  const owners = {};
  for (const name of [
    'timeline',
    'pages',
    'reader',
    'races',
    'capacity',
    'rollback',
    'same',
    'different',
    'foreign',
  ]) {
    const [row] = await source.query(
      `INSERT INTO users(email,password,"emailVerified")
       VALUES($1,'synthetic-password-not-a-login-hash',true) RETURNING id`,
      [`flow-${name}@example.invalid`],
    );
    owners[name] = row.id;
  }
  return owners;
}

async function workerMain() {
  sentinel(true);
  const statements = [];
  const source = sourceFor(statements, true);
  try {
    await source.initialize();
    const [{ pid }] = await source.query('SELECT pg_backend_pid() AS pid');
    process.send({ type: 'ready', pid: { process: process.pid, database: pid } });
    const { method, args, readBarrier } = await new Promise((resolve) =>
      process.once('message', resolve),
    );
    assert.ok(['initialize', 'create', 'correct', 'list'].includes(method));
    let paused = false;
    if (readBarrier) {
      const capture = source.logger.logQuery;
      source.logger.logQuery = (query, parameters, runner) => {
        if (!paused && /^\s*SELECT\b/i.test(query) && /portfolio_flow_versions/i.test(query)) {
          assert.ok(
            statements.some(
              (sql) => /^\s*SELECT\b/i.test(sql) && /portfolio_flow_journals/i.test(sql),
            ),
            'Journal read must anchor the RR snapshot before versions',
          );
          assert.ok(statements.some((sql) => /REPEATABLE READ/i.test(sql)));
          assert.ok(statements.some((sql) => /READ ONLY/i.test(sql)));
          paused = true;
          writeSync(1, 'SYNTHETIC_FLOW_READ_BARRIER\n');
          const byte = Buffer.alloc(1);
          assert.equal(readSync(0, byte, 0, 1, null), 1);
          assert.equal(byte[0], 1);
        }
        capture(query, parameters, runner);
      };
    }
    let result;
    try {
      result = { ok: true, value: await service(source)[method](...args), statements, paused };
    } catch (error) {
      result = { ok: false, status: error?.getStatus?.() ?? null, statements, paused };
    }
    process.send({ type: 'result', result });
  } finally {
    if (source.isInitialized) await source.destroy();
    process.disconnect();
  }
}

function startWorker() {
  const child = spawn(process.execPath, [__filename, '--worker'], {
    cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    serialization: 'advanced',
  });
  children.add(child);
  let readyResolve;
  let readyReject;
  let finishedResolve;
  let finishedReject;
  let barrierResolve;
  let barrierReject;
  let result;
  let stdout = '';
  let stderr = '';
  let released = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const finished = new Promise((resolve, reject) => {
    finishedResolve = resolve;
    finishedReject = reject;
  });
  const barrier = new Promise((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });
  ready.catch(() => {});
  finished.catch(() => {});
  barrier.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout === 'SYNTHETIC_FLOW_READ_BARRIER\n') barrierResolve();
    else if (Buffer.byteLength(stdout) > 1024) child.kill('SIGKILL');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (Buffer.byteLength(stderr) > 16384) child.kill('SIGKILL');
  });
  child.stdin.on('error', () => {});
  child.on('message', (message) => {
    if (message.type === 'ready') readyResolve(message.pid);
    if (message.type === 'result') result = message.result;
  });
  const fail = () => {
    const error = new Error(`Isolated flow worker failed at ${stage}; details withheld`);
    readyReject(error);
    finishedReject(error);
    barrierReject(error);
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    children.delete(child);
    if (
      code !== 0 ||
      signal ||
      result === undefined ||
      stderr !== '' ||
      !['', 'SYNTHETIC_FLOW_READ_BARRIER\n'].includes(stdout)
    )
      fail();
    else {
      finishedResolve(result);
      if (!result.paused) barrierReject(new Error('Read barrier was not observed'));
    }
  });
  return {
    child,
    ready,
    finished,
    barrier,
    go: (value) => child.send(value),
    release: () => {
      if (!released && !child.stdin.destroyed) {
        released = true;
        child.stdin.write(Buffer.from([1]));
      }
    },
  };
}

async function stopWorkers(workers) {
  for (const worker of workers) if (children.has(worker.child)) worker.child.kill('SIGKILL');
  await Promise.allSettled(workers.map((worker) => worker.finished));
}

async function waitForLocks(source, pids) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const rows = await source.query(
      `SELECT pid FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND wait_event_type='Lock'`,
      [pids],
    );
    if (rows.length === pids.length) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Distinct workers did not both block on the owner journal at ${stage}`);
}

async function timelineAndPrivacy(source, flows, owner, statements) {
  stage = 'FLOW-001/002 exact timeline, corrections, voids, replay and owner isolation';
  const empty = await checkedRead(source, statements, () => flows.getJournal(owner.timeline));
  assert.deepEqual(empty, {
    journal: null,
    basis: 'owner-declared-usd-flows',
    completeness: 'unreconciled',
  });
  await refusal(() => flows.list(owner.timeline, period()), 409);
  const init = origin();
  const acceptedOrigin = await flows.initialize(owner.timeline, init);
  assert.equal(acceptedOrigin.created, true);
  assert.deepEqual(await flows.initialize(owner.timeline, init), {
    created: false,
    value: acceptedOrigin.value,
  });
  await refusal(() => flows.initialize(owner.timeline, origin()), 409);
  await refusal(
    () => flows.create(owner.timeline, command(0, 'contribution', '2024-12-31T23:59:59.999Z', '1')),
    409,
  );
  await refusal(() => flows.list(owner.timeline, period('2024-12-31T23:59:59.999Z')), 409);
  const emptyCovered = await flows.list(owner.timeline, period());
  assert.deepEqual(emptyCovered.summary, totals('0', '0', '0', 0));
  assert.equal(emptyCovered.completeness, 'unreconciled');

  const inputA = command(0, 'contribution', jan2, '1000');
  const inputB = command(1, 'withdrawal', jan3, '250');
  const inputC = command(2, 'contribution', jan4, atom);
  const a = await flows.create(owner.timeline, inputA);
  const b = await flows.create(owner.timeline, inputB);
  const c = await flows.create(owner.timeline, inputC);
  assert.deepEqual(
    [a, b, c].map((r) => [r.created, r.value.journalRevision]),
    [
      [true, 1],
      [true, 2],
      [true, 3],
    ],
  );
  const before = await fingerprint(source);
  const initial = await checkedRead(source, statements, () => flows.list(owner.timeline, period()));
  assert.deepEqual(
    initial.summary,
    totals('1000.000000000000000000000000000001', '250', '750.000000000000000000000000000001', 3),
  );
  assert.equal(initial.items.length, 3);
  assert.equal(initial.basis, 'owner-declared-usd-flows');
  assert.equal(initial.completeness, 'unreconciled');
  assert.ok(!('portfolioValueUsd' in initial) && !('profitUsd' in initial));
  assert.equal(await fingerprint(source), before, 'GETs preserve all business rows and receipts');

  const correction = command(3, 'contribution', jan2, '1200');
  const corrected = await flows.correct(owner.timeline, a.value.flow.flowId, correction);
  assert.equal(corrected.value.journalRevision, 4);
  assert.deepEqual(
    (await flows.list(owner.timeline, period())).summary,
    totals('1200.000000000000000000000000000001', '250', '950.000000000000000000000000000001', 3),
  );
  const voidInput = voidCommand(4);
  const voided = await flows.void(owner.timeline, b.value.flow.flowId, voidInput);
  assert.equal(voided.value.journalRevision, 5);
  assert.deepEqual(
    (await flows.list(owner.timeline, period())).summary,
    totals('1200.000000000000000000000000000001', '0', '1200.000000000000000000000000000001', 2),
  );
  for (const [method, id, input, receipt] of [
    ['create', null, inputA, a],
    ['create', null, inputB, b],
    ['create', null, inputC, c],
    ['correct', a.value.flow.flowId, correction, corrected],
    ['void', b.value.flow.flowId, voidInput, voided],
  ]) {
    const replay =
      id === null
        ? await flows[method](owner.timeline, input)
        : await flows[method](owner.timeline, id, input);
    assert.deepEqual(
      replay,
      { created: false, value: receipt.value },
      'Original immutable receipt replays exactly',
    );
    assert.equal(
      JSON.stringify(replay.value),
      JSON.stringify(receipt.value),
      'Original receipt JSON remains byte-for-byte stable',
    );
  }
  await refusal(
    () => flows.correct(owner.timeline, b.value.flow.flowId, command(5, 'withdrawal', jan3, '251')),
    409,
  );
  const versions = await checkedRead(source, statements, () =>
    flows.versions(owner.timeline, b.value.flow.flowId, { limit: '1' }),
  );
  assert.deepEqual(
    versions.items.map((v) => v.version),
    [2],
  );
  assert.equal(versions.nextBeforeVersion, 2);
  assert.deepEqual(
    (
      await flows.versions(owner.timeline, b.value.flow.flowId, { limit: '1', beforeVersion: '2' })
    ).items.map((v) => v.version),
    [1],
  );
  const twin = await flows.create(owner.timeline, command(5, 'contribution', jan2, '1200'));
  assert.notEqual(
    twin.value.flow.flowId,
    a.value.flow.flowId,
    'Equal economic values are distinct commands',
  );
  const withTwin = await flows.list(owner.timeline, period());
  assert.equal(withTwin.summary.flowCount, 3);
  assert.ok(withTwin.items.some((item) => item.flowId === twin.value.flow.flowId));
  const lateOriginReplay = await flows.initialize(owner.timeline, init);
  assert.equal(lateOriginReplay.created, false);
  assert.equal(
    JSON.stringify(lateOriginReplay.value),
    JSON.stringify(acceptedOrigin.value),
    'Origin receipt remains stable after later flow versions',
  );

  await flows.initialize(owner.foreign, origin());
  const old = await fingerprint(source);
  await refusal(
    () => flows.correct(owner.foreign, a.value.flow.flowId, command(0, 'contribution', jan2, '1')),
    404,
  );
  await refusal(() => flows.void(owner.foreign, a.value.flow.flowId, voidCommand(0)), 404);
  await refusal(() => flows.versions(owner.foreign, a.value.flow.flowId, {}), 404);
  await refusal(() => flows.versions(owner.timeline, randomUUID(), {}), 404);
  assert.deepEqual((await flows.list(owner.foreign, period())).summary, totals('0', '0', '0', 0));
  assert.equal(await fingerprint(source), old, 'Foreign reads/refusals preserve all rows');
  console.log('PASS FLOW-001/002 actual PG timeline, exact replay, history and ownership');
}

async function pages(source, flows, owner) {
  stage = 'FLOW-003 inclusive/exclusive period, complete pages and correction-time restatement';
  await flows.initialize(owner.pages, origin());
  const a = await flows.create(owner.pages, command(0, 'contribution', jan2, '10'));
  const b = await flows.create(owner.pages, command(1, 'contribution', jan3, '20'));
  await flows.create(owner.pages, command(2, 'contribution', jan4, '30'));
  const withdrawal = await flows.create(owner.pages, command(3, 'withdrawal', jan3, '5'));
  const query = period(jan2, jan4, { limit: '1' });
  const before = await fingerprint(source);
  const first = await flows.list(owner.pages, query);
  assert.deepEqual(first.summary, totals('30', '5', '25', 3));
  const seen = [...first.items];
  let offset = first.nextOffset;
  while (offset !== null) {
    const page = await flows.list(owner.pages, {
      ...query,
      offset: String(offset),
      journalRevision: '4',
    });
    assert.deepEqual(page.summary, first.summary);
    seen.push(...page.items);
    offset = page.nextOffset;
  }
  assert.deepEqual(
    seen.map((item) => item.flowId),
    [a.value.flow.flowId, b.value.flow.flowId, withdrawal.value.flow.flowId].sort((left, right) => {
      const time = {
        [a.value.flow.flowId]: jan2,
        [b.value.flow.flowId]: jan3,
        [withdrawal.value.flow.flowId]: jan3,
      };
      return time[left] === time[right]
        ? left.localeCompare(right)
        : time[left].localeCompare(time[right]);
    }),
  );
  assert.equal(new Set(seen.map((item) => item.flowId)).size, 3);
  const beyond = await flows.list(owner.pages, { ...query, offset: '9', journalRevision: '4' });
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.nextOffset, null);
  assert.deepEqual(beyond.summary, first.summary);
  await refusal(() => flows.list(owner.pages, { ...query, offset: '1' }), 400);
  assert.equal(await fingerprint(source), before, 'All pages are read-only');
  const moved = await flows.correct(
    owner.pages,
    b.value.flow.flowId,
    command(4, 'contribution', jan4, '20'),
  );
  assert.equal(moved.value.journalRevision, 5);
  await refusal(
    () => flows.list(owner.pages, { ...query, offset: '1', journalRevision: '4' }),
    409,
  );
  assert.deepEqual((await flows.list(owner.pages, query)).summary, totals('10', '5', '5', 2));
  await flows.void(owner.pages, withdrawal.value.flow.flowId, voidCommand(5));
  assert.deepEqual((await flows.list(owner.pages, query)).summary, totals('10', '0', '10', 1));
  console.log('PASS FLOW-003 actual PG period boundaries, UUID pages and pinned409');
}

async function originRaces(source, _flows, owner) {
  stage = 'FLOW-002 real independent-process identical and different origin races';
  for (const [who, identical] of [
    [owner.same, true],
    [owner.different, false],
  ]) {
    const first = startWorker();
    const second = startWorker();
    try {
      const pids = await Promise.all([first.ready, second.ready]);
      assert.notEqual(pids[0].process, pids[1].process);
      assert.notEqual(pids[0].database, pids[1].database);
      const one = origin();
      const two = identical ? one : origin();
      first.go({ method: 'initialize', args: [who, one] });
      second.go({ method: 'initialize', args: [who, two] });
      const results = await Promise.all([first.finished, second.finished]);
      const accepted = results.filter((r) => r.ok);
      assert.equal(accepted.length, identical ? 2 : 1);
      if (identical) {
        assert.deepEqual(accepted.map((r) => r.value.created).sort(), [false, true]);
        assert.deepEqual(accepted[0].value.value, accepted[1].value.value);
      } else assert.equal(results.find((r) => !r.ok).status, 409);
      assert.equal(
        (
          await source.query(
            'SELECT count(*)::int AS n FROM portfolio_flow_journals WHERE "ownerId"=$1',
            [who],
          )
        )[0].n,
        1,
      );
    } finally {
      await stopWorkers([first, second]);
    }
  }
  console.log('PASS FLOW-002 actual PG independent-process origin races');
}

async function raceUnderLock(source, owner, commands) {
  const runner = source.createQueryRunner();
  const first = startWorker();
  const second = startWorker();
  try {
    await runner.connect();
    await runner.startTransaction();
    await runner.query(
      'SELECT "ownerId" FROM portfolio_flow_journals WHERE "ownerId"=$1 FOR UPDATE',
      [owner],
    );
    const pids = await Promise.all([first.ready, second.ready]);
    assert.notEqual(pids[0].database, pids[1].database);
    first.go({ method: 'create', args: [owner, commands[0]] });
    second.go({ method: 'create', args: [owner, commands[1]] });
    await waitForLocks(
      source,
      pids.map((pid) => pid.database),
    );
    await runner.commitTransaction();
    return await Promise.all([first.finished, second.finished]);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await stopWorkers([first, second]);
  }
}

async function commandRaces(source, flows, owner) {
  stage = 'FLOW-002 real journal lock, identical replay, CAS and unreserved rejected key';
  await flows.initialize(owner.races, origin());
  const identical = command(0, 'contribution', jan2, '10');
  const same = await raceUnderLock(source, owner.races, [identical, identical]);
  assert.equal(same.filter((r) => r.ok).length, 2);
  assert.deepEqual(same.map((r) => r.value.created).sort(), [false, true]);
  assert.deepEqual(same[0].value.value, same[1].value.value);
  assert.equal((await flows.getJournal(owner.races)).journal.journalRevision, 1);
  const different = [command(1, 'contribution', jan3, '20'), command(1, 'withdrawal', jan3, '5')];
  const raced = await raceUnderLock(source, owner.races, different);
  const winner = raced.findIndex((r) => r.ok);
  assert.ok(winner === 0 || winner === 1);
  assert.equal(raced[1 - winner].status, 409);
  const loser = different[1 - winner];
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "requestId"=$2',
        [owner.races, loser.requestId],
      )
    )[0].n,
    0,
    'Rejected command key is not reserved',
  );
  const revised = { ...loser, expectedJournalRevision: 2 };
  assert.equal((await flows.create(owner.races, revised)).value.journalRevision, 3);
  console.log('PASS FLOW-002 actual PG journal lock/CAS and rejected-key retry');
}

async function rollbackAfterWrites(source, flows, owner, statements) {
  stage = 'FLOW-002 deferred COMMIT rejection after version insert and journal advance';
  await flows.initialize(owner.rollback, origin());
  const input = command(0, 'contribution', jan2, '7');
  await source.query(`CREATE FUNCTION synthetic_flow_reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic deferred commit rejection' USING ERRCODE='P0001'; END $$`);
  await source.query(`CREATE CONSTRAINT TRIGGER synthetic_flow_commit_guard
    AFTER UPDATE ON portfolio_flow_journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION synthetic_flow_reject_commit()`);
  const before = await fingerprint(source);
  const start = statements.length;
  let failureCode;
  try {
    await flows.create(owner.rollback, input);
  } catch (error) {
    failureCode = error?.driverError?.code ?? error?.code;
  }
  assert.equal(failureCode, 'P0001', 'Only the synthetic deferred COMMIT trigger may reject');
  const attempted = statements.slice(start);
  assert.ok(
    attempted.some((sql) => /INSERT\s+INTO\s+"?portfolio_flow_versions"?/i.test(sql)),
    'Version insert reached PostgreSQL',
  );
  assert.ok(
    attempted.some((sql) => /UPDATE\s+"?portfolio_flow_journals"?/i.test(sql)),
    'Journal advance reached PostgreSQL',
  );
  assert.ok(
    attempted.some((sql) => /COMMIT/i.test(sql)),
    'Failure was deferred until COMMIT',
  );
  assert.equal(await fingerprint(source), before, 'Both business writes roll back atomically');
  await source.query('DROP TRIGGER synthetic_flow_commit_guard ON portfolio_flow_journals');
  await source.query('DROP FUNCTION synthetic_flow_reject_commit()');
  const retried = await flows.create(owner.rollback, input);
  assert.equal(retried.created, true);
  assert.equal(retried.value.journalRevision, 1);
  assert.deepEqual(await flows.create(owner.rollback, input), {
    created: false,
    value: retried.value,
  });
  console.log('PASS FLOW-002 actual PG deferred-COMMIT rollback and original-key retry');
}

async function readBarrier(_source, flows, owner) {
  stage = 'FLOW-003 real RR read-only barrier across committed correction';
  await flows.initialize(owner.reader, origin());
  const created = await flows.create(owner.reader, command(0, 'contribution', jan2, '10'));
  const query = period();
  const old = await flows.list(owner.reader, query);
  const reader = startWorker();
  const writer = startWorker();
  try {
    const pids = await Promise.all([reader.ready, writer.ready]);
    assert.notEqual(pids[0].process, pids[1].process);
    assert.notEqual(pids[0].database, pids[1].database);
    reader.go({ method: 'list', args: [owner.reader, query], readBarrier: true });
    await reader.barrier;
    writer.go({
      method: 'correct',
      args: [owner.reader, created.value.flow.flowId, command(1, 'contribution', jan2, '20')],
    });
    const changed = await writer.finished;
    assert.equal(changed.ok, true);
    assert.equal(changed.value.value.journalRevision, 2);
    reader.release();
    const read = await reader.finished;
    assert.equal(read.ok, true);
    assert.equal(read.paused, true);
    assert.deepEqual(read.value, old, 'One response uses the wholly old RR snapshot');
    assert.deepEqual((await flows.list(owner.reader, query)).summary, totals('20', '0', '20', 1));
    assert.ok(read.statements.some((sql) => /READ ONLY/i.test(sql)));
    assert.ok(!read.statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)));
  } finally {
    reader.release();
    await stopWorkers([reader, writer]);
  }
  console.log('PASS FLOW-003 actual PG read-only RR snapshot across correction');
}

async function capacity(source, flows, owner) {
  stage = 'FLOW-002/003 1000 active maximum-precision flows and 10000-version bound';
  await flows.initialize(owner.capacity, origin());
  const firstInput = command(0, 'contribution', jan2, maximum);
  const first = await flows.create(owner.capacity, firstInput);
  const [canonical] = await source.query(
    'SELECT "canonicalPayload" FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "requestId"=$2',
    [owner.capacity, firstInput.requestId],
  );
  assert.ok(canonical?.canonicalPayload);
  // Bulk fixture rows exist only in the fresh guarded database. Service creates the
  // first and last real commands, and all bounds/read calculations use actual DB rows.
  await source.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO portfolio_flow_versions
      ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,
       "occurredAt","amountUsd","createdAt","previousVersion")
      SELECT $1,gen_random_uuid(),1,n,gen_random_uuid(),$2,'create','contribution',$3::timestamptz,
        $4::numeric,clock_timestamp(),NULL FROM generate_series(2,1000) AS n`,
      [owner.capacity, canonical.canonicalPayload, jan2, maximum],
    );
    await manager.query(
      'UPDATE portfolio_flow_journals SET "currentRevision"=1000 WHERE "ownerId"=$1',
      [owner.capacity],
    );
  });
  const before = await fingerprint(source);
  const full = await flows.list(owner.capacity, period(coverage, jan3, { limit: '1' }));
  assert.deepEqual(full.summary, totals(thousandMaximum, '0', thousandMaximum, 1000));
  assert.equal(full.items.length, 1);
  assert.equal(full.nextOffset, 1);
  const lastPage = await flows.list(
    owner.capacity,
    period(coverage, jan3, { offset: '999', limit: '1', journalRevision: '1000' }),
  );
  assert.deepEqual(lastPage.summary, full.summary);
  assert.equal(lastPage.items.length, 1);
  assert.equal(lastPage.nextOffset, null);
  assert.equal(await fingerprint(source), before, 'Maximum-precision pages write no rows');
  await refusal(() => flows.create(owner.capacity, command(1000, 'contribution', jan2, '1')), 409);
  assert.deepEqual(await flows.create(owner.capacity, firstInput), {
    created: false,
    value: first.value,
  });
  const voidInput = voidCommand(1000);
  const voided = await flows.void(owner.capacity, first.value.flow.flowId, voidInput);
  assert.equal(voided.value.journalRevision, 1001);
  const newInput = command(1001, 'contribution', jan2, maximum);
  const newFlow = await flows.create(owner.capacity, newInput);
  assert.equal(newFlow.value.journalRevision, 1002);
  const [newCanonical] = await source.query(
    'SELECT "canonicalPayload" FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "requestId"=$2',
    [owner.capacity, newInput.requestId],
  );
  assert.ok(newCanonical?.canonicalPayload);
  const [synthetic] = await source.query(
    'SELECT "flowId" FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "journalRevision"=2',
    [owner.capacity],
  );
  assert.ok(synthetic?.flowId);
  const freed = await flows.void(owner.capacity, synthetic.flowId, voidCommand(1002));
  assert.equal(freed.value.journalRevision, 1003);
  await source.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO portfolio_flow_versions
      ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,
       "occurredAt","amountUsd","createdAt","previousVersion")
      SELECT $1,$2,n,1002+n,gen_random_uuid(),$3,'correct','contribution',$4::timestamptz,
        $5::numeric,clock_timestamp(),n-1 FROM generate_series(2,8998) AS n`,
      [owner.capacity, newFlow.value.flow.flowId, newCanonical.canonicalPayload, jan2, maximum],
    );
    await manager.query(
      'UPDATE portfolio_flow_journals SET "currentRevision"=10000 WHERE "ownerId"=$1',
      [owner.capacity],
    );
  });
  const state = await flows.getJournal(owner.capacity);
  assert.equal(state.journal.journalRevision, 10000);
  assert.equal(state.journal.activeFlowCount, 999);
  assert.equal(state.journal.versionCount, 10000);
  assert.deepEqual(
    (await flows.list(owner.capacity, period(coverage, jan3))).summary,
    totals(nineHundredNinetyNineMaximum, '0', nineHundredNinetyNineMaximum, 999),
  );
  await refusal(() => flows.create(owner.capacity, command(10000, 'contribution', jan2, '1')), 409);
  await refusal(
    () => flows.void(owner.capacity, newFlow.value.flow.flowId, voidCommand(10000)),
    409,
  );
  assert.deepEqual(await flows.create(owner.capacity, firstInput), {
    created: false,
    value: first.value,
  });
  assert.deepEqual(await flows.void(owner.capacity, first.value.flow.flowId, voidInput), {
    created: false,
    value: voided.value,
  });
  assert.deepEqual(await flows.create(owner.capacity, newInput), {
    created: false,
    value: newFlow.value,
  });
  console.log(
    'PASS FLOW-002/003 actual PG independent active/version caps and 51-digit exact total',
  );
}

async function main() {
  sentinel();
  if (!existsSync(modulePath) || !existsSync(migrationPath)) {
    console.error(
      'PREREQUISITE flow service or migration17 production module absent; fixture DB not created',
    );
    process.exitCode = 2;
    return;
  }
  const admin = new Client({
    host: settings.DB_HOST,
    port: Number(settings.DB_PORT),
    user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    database: settings.DB_NAME,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  try {
    assert.equal(
      (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      0,
      'Refuse an existing fixture database; never reuse or drop owner data',
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
  assert.equal(migrated.error, undefined);
  assert.equal(migrated.signal, null);
  assert.equal(migrated.status, 0, 'Actual TypeORM migrations build fresh19');
  const statements = [];
  const source = sourceFor(statements);
  try {
    await source.initialize();
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const migrations = await source.query('SELECT name FROM migrations ORDER BY timestamp');
    assert.equal(migrations.length, 53);
    assert.equal(migrations[16].name, 'AddExternalUsdFlows1790070000000');
    assert.equal(migrations[17].name, 'AddManualUsdPrices1790080000000');
    assert.equal(migrations[18].name, 'AddDailyDisplayFx1790090000000');
    assert.equal(migrations[19].name, 'AddOwnedTransfers1790100000000');
    const owners = await seedOwners(source);
    const oldRows = await fingerprint(source, true);
    const flows = service(source);
    for (const run of [
      timelineAndPrivacy,
      pages,
      originRaces,
      commandRaces,
      rollbackAfterWrites,
      readBarrier,
      capacity,
      storageConstraints,
    ])
      await run(source, flows, owners, statements);
    assert.equal(
      await fingerprint(source, true),
      oldRows,
      'Flow operations never alter prior financial/authentication rows',
    );
    console.log('PASS FLOW-001/002/003 actual compiled-service PostgreSQL acceptance');
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

async function storageConstraints(source, _flows, owner) {
  stage = 'FLOW-MIG-001 actual SQL exact finite fields and owner/history constraints';
  const before = await fingerprint(source);
  const reject = async (sql, values, codes = ['23514'], expectedConstraint) => {
    const runner = source.createQueryRunner();
    let code, constraint;
    try {
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(sql, values);
      } catch (error) {
        code = error?.driverError?.code ?? error?.code;
        constraint = error?.driverError?.constraint ?? error?.constraint;
      }
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    assert.ok(
      codes.includes(code),
      'PostgreSQL rejects the intended constraint, not incidental fixture SQL',
    );
    if (expectedConstraint) assert.equal(constraint, expectedConstraint);
  };
  const columns =
    await source.query(`SELECT column_name,numeric_precision,numeric_scale,datetime_precision
    FROM information_schema.columns WHERE table_name='portfolio_flow_versions'`);
  assert.deepEqual(
    columns.find((row) => row.column_name === 'amountUsd'),
    {
      column_name: 'amountUsd',
      numeric_precision: 78,
      numeric_scale: 30,
      datetime_precision: null,
    },
  );
  assert.equal(columns.find((row) => row.column_name === 'occurredAt').datetime_precision, 3);
  const [first] = await source.query(
    'SELECT p.* FROM portfolio_flow_versions p WHERE p."ownerId"=$1 AND p.version=1 AND EXISTS (SELECT 1 FROM portfolio_flow_versions c WHERE c."ownerId"=p."ownerId" AND c."flowId"=p."flowId" AND c.version=2) LIMIT 1',
    [owner.timeline],
  );
  const fields = [
    'ownerId',
    'flowId',
    'version',
    'journalRevision',
    'requestId',
    'canonicalPayload',
    'kind',
    'direction',
    'occurredAt',
    'amountUsd',
    'createdAt',
    'previousVersion',
  ];
  const insert = `INSERT INTO portfolio_flow_versions (${fields.map((key) => `"${key}"`).join(',')})
    VALUES (${fields.map((_, index) => `$${index + 1}`).join(',')})`;
  const invalidVersion = (patch, codes) => {
    const row = {
      ...first,
      flowId: randomUUID(),
      requestId: randomUUID(),
      journalRevision: 100,
      ...patch,
    };
    return reject(
      insert,
      fields.map((key) => row[key]),
      codes,
    );
  };
  for (const amountUsd of ['0', '-1', 'NaN']) await invalidVersion({ amountUsd });
  for (const amountUsd of ['Infinity', '-Infinity', '1'.repeat(49)])
    await invalidVersion({ amountUsd }, ['22003', '23514']);
  for (const occurredAt of [
    'infinity',
    '-infinity',
    '1969-12-31T23:59:59Z',
    '10000-01-01T00:00:00Z',
  ])
    await invalidVersion({ occurredAt });
  for (const patch of [
    { direction: 'transfer' },
    { kind: 'correct' },
    { version: 2, kind: 'correct', previousVersion: null },
    { version: 2, kind: 'correct', previousVersion: 2 },
    { journalRevision: 10001 },
    { createdAt: 'infinity' },
  ])
    await invalidVersion(patch);
  await invalidVersion({ version: 2, kind: 'correct', previousVersion: 1 }, ['23503']);
  await invalidVersion(
    {
      ownerId: owner.foreign,
      flowId: first.flowId,
      version: 2,
      kind: 'correct',
      previousVersion: 1,
    },
    ['23503'],
  );
  await invalidVersion({ ownerId: randomUUID() }, ['23503']);
  await invalidVersion({ requestId: first.requestId }, ['23505']);
  await invalidVersion({ journalRevision: first.journalRevision }, ['23505']);
  stage = 'FLOW-MIG-001 referenced journal deletion RESTRICT refusal';
  await reject(
    'DELETE FROM portfolio_flow_journals WHERE "ownerId"=$1',
    [owner.timeline],
    ['23001'],
    'portfolio_flow_versions_ownerId_fkey',
  );
  stage = 'FLOW-MIG-001 referenced user deletion RESTRICT refusal';
  await reject('DELETE FROM users WHERE id=$1', [owner.timeline], ['23001'], 'portfolio_flow_journals_ownerId_fkey');
  stage = 'FLOW-MIG-001 referenced version deletion RESTRICT refusal';
  await reject(
    'DELETE FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "flowId"=$2 AND version=1',
    [owner.timeline, first.flowId],
    ['23001'],
    'portfolio_flow_versions_ownerId_flowId_previousVersion_fkey',
  );
  for (const coverageFrom of ['infinity', '1969-12-31T23:59:59Z', '10000-01-01T00:00:00Z'])
    await reject('UPDATE portfolio_flow_journals SET "coverageFrom"=$2 WHERE "ownerId"=$1', [
      owner.timeline,
      coverageFrom,
    ]);
  await reject('UPDATE portfolio_flow_journals SET "currentRevision"=10001 WHERE "ownerId"=$1', [
    owner.timeline,
  ]);
  const { AddExternalUsdFlows1790070000000 } = require(migrationPath);
  await assert.rejects(
    () => new AddExternalUsdFlows1790070000000().down(),
    /explicit recovery plan/,
  );
  assert.equal(
    await fingerprint(source),
    before,
    'SQL rejection and refused down preserve all rows',
  );
  console.log(
    'PASS FLOW-MIG-001 actual SQL finite/positive precision, owner/history uniqueness, RESTRICT and refused down',
  );
}

const watchdog = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded flow fixture at stage: ${stage}`);
  process.exit(1);
}, 300000);
watchdog.unref();
(process.argv[2] === '--worker' ? workerMain() : main())
  .catch(() => {
    for (const child of children) child.kill('SIGKILL');
    console.error(`FAIL isolated flow fixture at stage: ${stage} (details withheld)`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
