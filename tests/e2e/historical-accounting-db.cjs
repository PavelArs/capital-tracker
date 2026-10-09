'use strict';

// Actual compiled production services and a fresh synthetic PostgreSQL database only.
// Missing future production code is a prerequisite, never behavioral RED.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
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
const database = 'capital_tracker_historical_e2e';
const historyModule = '/app/backend/dist/accounting/historical-accounting.service.js';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const children = new Set();
let stage = 'isolated configuration';

const zeros = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};

function sentinel(worker = false) {
  for (const [key, value] of Object.entries(settings)) {
    assert.equal(
      process.env[key],
      worker && key === 'DB_NAME' ? database : value,
      'Exact isolated synthetic settings required',
    );
  }
}

function productionSource(statements) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
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

function services(source) {
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const { CarryInService } = require('/app/backend/dist/accounting/carry-in.service.js');
  const { HistoricalAccountingService } = require(historyModule);
  return {
    accounting: new AccountingService(source),
    trade: new TradeService(source),
    carry: new CarryInService(source),
    history: new HistoricalAccountingService(source),
  };
}

async function fingerprint(source) {
  const tables = await source.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const values = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = await source.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`);
    values.push([tablename, rows]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

async function status(action, expected) {
  let failed = false;
  let actual;
  try {
    await action();
  } catch (error) {
    failed = true;
    actual = error?.getStatus?.();
  }
  assert.ok(failed, 'Expected a deliberate service rejection');
  if (actual !== expected)
    console.error(`REFUSAL expected${expected}, received${actual ?? 'non-HTTP error'} at ${stage}`);
  assert.equal(actual, expected, 'Reject for the specified domain boundary');
}

async function workerMain() {
  sentinel(true);
  const statements = [];
  const source = productionSource(statements);
  try {
    await source.initialize();
    const [{ pid: databasePid }] = await source.query('SELECT pg_backend_pid() AS pid');
    process.send({ type: 'ready', pid: { process: process.pid, database: databasePid } });
    const { service, method, args, readBarrier } = await new Promise((resolve) =>
      process.once('message', resolve),
    );
    assert.ok(
      (service === 'history' && method === 'getSnapshot') ||
        (service === 'trade' && method === 'correct'),
    );
    let paused = false;
    if (readBarrier) {
      const { readSync, writeSync } = require('node:fs');
      const capture = source.logger.logQuery;
      source.logger.logQuery = (query, parameters, queryRunner) => {
        if (
          !paused &&
          /^\s*SELECT\b/i.test(query) &&
          /account_trade_versions|account_carry_in_lots|accounting_instruments/i.test(query)
        ) {
          assert.ok(
            statements.some(
              (sql) =>
                /^\s*SELECT\b/i.test(sql) &&
                /manual_accounts|account_trade_journals/i.test(sql),
            ),
            'The snapshot must be anchored before heads or baseline load',
          );
          assert.ok(statements.some((sql) => /REPEATABLE READ/i.test(sql)));
          assert.ok(statements.some((sql) => /READ ONLY/i.test(sql)));
          paused = true;
          writeSync(1, 'SYNTHETIC_HISTORY_READ_BARRIER\n');
          const byte = Buffer.alloc(1);
          assert.equal(readSync(0, byte, 0, 1, null), 1);
          assert.equal(byte[0], 1);
        }
        capture(query, parameters, queryRunner);
      };
    }
    let result;
    try {
      result = { ok: true, value: await services(source)[service][method](...args), statements, paused };
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
  let resultResolve;
  let resultReject;
  let barrierResolve;
  let barrierReject;
  let result;
  let output = '';
  let errors = '';
  let released = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const finished = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  const barrier = new Promise((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });
  ready.catch(() => {});
  finished.catch(() => {});
  barrier.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (output === 'SYNTHETIC_HISTORY_READ_BARRIER\n') barrierResolve();
    else if (Buffer.byteLength(output) > 1024) child.kill('SIGKILL');
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
    if (Buffer.byteLength(errors) > 16384) child.kill('SIGKILL');
  });
  child.stdin.on('error', () => {});
  child.on('message', (message) => {
    if (message.type === 'ready') readyResolve(message.pid);
    if (message.type === 'result') result = message.result;
  });
  const fail = () => {
    const error = new Error('Isolated historical worker failed; details withheld');
    readyReject(error);
    resultReject(error);
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
      errors !== '' ||
      !['', 'SYNTHETIC_HISTORY_READ_BARRIER\n'].includes(output)
    ) {
      fail();
    } else {
      resultResolve(result);
      if (!result.paused) barrierReject(new Error('Read stage was not observed'));
    }
  });
  return {
    child,
    ready,
    finished,
    barrier,
    go: (command) => child.send(command),
    release: () => {
      if (!released && !child.stdin.destroyed) {
        released = true;
        child.stdin.write(Buffer.from([1]));
      }
    },
  };
}

async function stopWorkers(workers) {
  for (const worker of workers) {
    if (children.has(worker.child)) worker.child.kill('SIGKILL');
  }
  await Promise.allSettled(workers.map((worker) => worker.finished));
}

const lot = (instrumentId, order, changes = {}) => ({
  instrumentId,
  acquiredAt: `2024-12-31T00:00:00.000Z`,
  orderWithinTimestamp: order,
  originalQuantity: '1',
  originalCostUsd: order === 0 ? '100' : '200',
  remainingQuantity: '1',
  ...changes,
});
const execution = (instrumentId, side, at, order, quantity, grossUsd) => ({
  instrumentId,
  side,
  occurredAt: at,
  orderWithinTimestamp: order,
  quantity,
  grossUsd,
  feeUsd: '0',
});
const summary = (changes = {}) => ({ ...zeros, ...changes });

async function newAccount(svc, owner, name) {
  return (
    await svc.accounting.createAccount(owner, { requestId: randomUUID(), name })
  ).value.id;
}

async function openingAccount(svc, owner, instrument, name, unknown = false) {
  const account = await newAccount(svc, owner, name);
  const input = {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: coverageFrom,
    positions: [
      {
        instrumentId: instrument,
        quantity: '2',
        costStatus: unknown ? 'unknown' : 'known',
        totalCostUsd: unknown ? null : '300',
      },
    ],
  };
  const saved = await svc.accounting.saveOpening(owner, account, input);
  assert.equal(saved.created, true);
  return account;
}

async function carryAccount(svc, owner, instrument, name) {
  const account = await openingAccount(svc, owner, instrument, name);
  const input = {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    lots: [lot(instrument, 0), lot(instrument, 1)],
    assertReviewed: true,
  };
  const saved = await svc.carry.initialize(owner, account, input);
  assert.equal(saved.created, true);
  return account;
}

async function seed(source, svc) {
  const [ownerRow] = await source.query(
    `INSERT INTO users(email,password,"emailVerified")
     VALUES('historical-owner@example.invalid','synthetic-password-not-a-login-hash',true) RETURNING id`,
  );
  const [otherRow] = await source.query(
    `INSERT INTO users(email,password,"emailVerified")
     VALUES('historical-other@example.invalid','synthetic-password-not-a-login-hash',true) RETURNING id`,
  );
  const owner = ownerRow.id;
  const other = otherRow.id;
  const firstInstrument = (
    await svc.accounting.createInstrument(owner, {
      requestId: randomUUID(),
      name: 'First same-symbol instrument',
      symbol: 'SAME',
    })
  ).value.id;
  const secondInstrument = (
    await svc.accounting.createInstrument(owner, {
      requestId: randomUUID(),
      name: 'Second same-symbol instrument',
      symbol: 'SAME',
    })
  ).value.id;
  const foreignInstrument = (
    await svc.accounting.createInstrument(other, {
      requestId: randomUUID(),
      name: 'Foreign instrument',
      symbol: 'SAME',
    })
  ).value.id;
  const foreignAccount = await newAccount(svc, other, 'Foreign historical account');
  return { owner, other, firstInstrument, secondInstrument, foreignAccount, foreignInstrument };
}

async function at(svc, owner, account, instant, page = {}) {
  return svc.history.getSnapshot(owner, account, { at: instant, ...page });
}

async function coverageAndFailures(source, svc, f) {
  stage = 'HIST-002 initialized coverage, inclusive carry-in and private refusals';
  const { owner, firstInstrument, foreignAccount } = f;
  const empty = await newAccount(svc, owner, 'Empty historical account');
  await svc.trade.initialize(owner, empty, {
    requestId: randomUUID(),
    coverageFrom,
    assertEmpty: true,
  });
  const baselineOnly = await carryAccount(svc, owner, firstInstrument, 'Carry baseline at coverage');
  const carry = await carryAccount(svc, owner, firstInstrument, 'Known carry historical account');
  const sale = execution(firstInstrument, 'sell', coverageFrom, 0, '1.5', '450');
  const carrySale = await svc.trade.create(owner, carry, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    ...sale,
  });
  assert.equal(carrySale.created, true);

  const unknown = await openingAccount(
    svc,
    owner,
    firstInstrument,
    'Unknown cost without journal',
    true,
  );
  const beforeReads = await fingerprint(source);
  const emptySnapshot = await at(svc, owner, empty, coverageFrom);
  assert.deepEqual(emptySnapshot, {
    accountId: empty,
    at: coverageFrom,
    coverageFrom,
    journalRevision: 0,
    basis: 'current-effective-history',
    originKind: 'declared-empty',
    openingRevision: null,
    initialCostUsd: '0',
    summary: zeros,
    items: [],
    nextOffset: null,
  });
  assert.deepEqual(await at(svc, owner, baselineOnly, coverageFrom), {
    accountId: baselineOnly,
    at: coverageFrom,
    coverageFrom,
    journalRevision: 0,
    basis: 'current-effective-history',
    originKind: 'known-cost-carry-in',
    openingRevision: 1,
    initialCostUsd: '300',
    summary: summary({ remainingCostUsd: '300' }),
    items: [
      {
        instrumentId: firstInstrument,
        instrumentName: 'First same-symbol instrument',
        instrumentSymbol: 'SAME',
        quantity: '2',
        costUsd: '300',
      },
    ],
    nextOffset: null,
  });
  const carrySnapshot = await at(svc, owner, carry, coverageFrom);
  assert.deepEqual(carrySnapshot, {
    accountId: carry,
    at: coverageFrom,
    coverageFrom,
    journalRevision: 1,
    basis: 'current-effective-history',
    originKind: 'known-cost-carry-in',
    openingRevision: 1,
    initialCostUsd: '300',
    summary: summary({
      grossSalesUsd: '450',
      netSalesUsd: '450',
      consumedCostUsd: '200',
      realizedUsd: '250',
      remainingCostUsd: '100',
    }),
    items: [
      {
        instrumentId: firstInstrument,
        instrumentName: 'First same-symbol instrument',
        instrumentSymbol: 'SAME',
        quantity: '0.5',
        costUsd: '100',
      },
    ],
    nextOffset: null,
  });
  await status(() => at(svc, owner, carry, '2024-12-31T23:59:59.999Z'), 409);
  await status(() => at(svc, owner, unknown, coverageFrom), 409);
  await status(() => at(svc, owner, foreignAccount, coverageFrom), 404);
  const afterReads = await fingerprint(source);
  assert.equal(afterReads, beforeReads, 'All valid and refused history reads are row-read-only');
}

async function pagesAndRevision(source, svc, f) {
  stage = 'HIST-003-A same-symbol UUID pages and stale revision after real correction';
  const { owner, firstInstrument, secondInstrument } = f;
  const account = await newAccount(svc, owner, 'Same-symbol page history');
  await svc.trade.initialize(owner, account, {
    requestId: randomUUID(),
    coverageFrom,
    assertEmpty: true,
  });
  const first = await svc.trade.create(owner, account, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    ...execution(firstInstrument, 'buy', '2025-01-02T00:00:00.000Z', 0, '1', '100'),
  });
  await svc.trade.create(owner, account, {
    requestId: randomUUID(),
    expectedJournalRevision: 1,
    ...execution(secondInstrument, 'buy', '2025-01-03T00:00:00.000Z', 0, '2', '400'),
  });
  const expectedIds = [firstInstrument, secondInstrument].sort();
  const expectedPositions = {
    [firstInstrument]: {
      instrumentId: firstInstrument,
      instrumentName: 'First same-symbol instrument',
      instrumentSymbol: 'SAME',
      quantity: '1',
      costUsd: '100',
    },
    [secondInstrument]: {
      instrumentId: secondInstrument,
      instrumentName: 'Second same-symbol instrument',
      instrumentSymbol: 'SAME',
      quantity: '2',
      costUsd: '400',
    },
  };
  const beforePages = await fingerprint(source);
  const firstPage = await at(svc, owner, account, '2025-01-04T00:00:00.000Z', { limit: '1' });
  const secondPage = await at(svc, owner, account, '2025-01-04T00:00:00.000Z', {
    limit: '1',
    offset: '1',
    journalRevision: '2',
  });
  const beyond = await at(svc, owner, account, '2025-01-04T00:00:00.000Z', {
    limit: '1',
    offset: '9',
    journalRevision: '2',
  });
  assert.deepEqual(firstPage.items, [expectedPositions[expectedIds[0]]]);
  assert.deepEqual(secondPage.items, [expectedPositions[expectedIds[1]]]);
  assert.equal(firstPage.nextOffset, 1);
  assert.equal(secondPage.nextOffset, null);
  assert.equal(firstPage.initialCostUsd, '0');
  assert.equal(secondPage.initialCostUsd, firstPage.initialCostUsd);
  assert.deepEqual(firstPage.summary, summary({ grossBuysUsd: '500', remainingCostUsd: '500' }));
  assert.deepEqual(secondPage.summary, firstPage.summary);
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.nextOffset, null);
  assert.equal(beyond.initialCostUsd, firstPage.initialCostUsd);
  assert.deepEqual(beyond.summary, firstPage.summary);
  assert.equal(await fingerprint(source), beforePages, 'Page reads write no accounting or receipt rows');

  const correction = await svc.trade.correct(owner, account, first.value.trade.tradeId, {
    requestId: randomUUID(),
    expectedJournalRevision: 2,
    ...execution(firstInstrument, 'buy', '2025-01-02T00:00:00.000Z', 0, '1', '120'),
  });
  assert.equal(correction.created, true);
  assert.equal(correction.value.journalRevision, 3);
  const beforeStale = await fingerprint(source);
  await status(
    () =>
      at(svc, owner, account, '2025-01-04T00:00:00.000Z', {
        limit: '1',
        offset: '1',
        journalRevision: '2',
      }),
    409,
  );
  assert.equal(await fingerprint(source), beforeStale, 'Stale continuation refusal writes no rows');
  const current = await at(svc, owner, account, '2025-01-04T00:00:00.000Z');
  assert.equal(current.journalRevision, 3);
  assert.deepEqual(current.summary, summary({ grossBuysUsd: '520', remainingCostUsd: '520' }));
  assert.deepEqual(
    current.items.map((item) => [item.instrumentId, item.quantity, item.costUsd]),
    expectedIds.map((id) => [
      id,
      expectedPositions[id].quantity,
      id === firstInstrument ? '120' : expectedPositions[id].costUsd,
    ]),
  );
}

async function coherentRead(source, svc, f) {
  stage = 'HIST-003-B actual repeatable-read/read-only snapshot across committed correction';
  const { owner, firstInstrument } = f;
  const account = await carryAccount(svc, owner, firstInstrument, 'Coherent historical carry');
  const buy = execution(firstInstrument, 'buy', '2025-01-02T00:00:00.000Z', 0, '1', '50');
  const created = await svc.trade.create(owner, account, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    ...buy,
  });
  const rawQuery = { at: '2025-01-02T00:00:00.000Z' };
  const before = await svc.history.getSnapshot(owner, account, rawQuery);
  const reader = startWorker();
  const writer = startWorker();
  try {
    const pids = await Promise.all([reader.ready, writer.ready]);
    assert.notEqual(pids[0].process, pids[1].process);
    assert.notEqual(pids[0].database, pids[1].database);
    assert.notEqual(pids[0].database, (await source.query('SELECT pg_backend_pid() AS pid'))[0].pid);
    reader.go({ service: 'history', method: 'getSnapshot', args: [owner, account, rawQuery], readBarrier: true });
    await reader.barrier;
    writer.go({
      service: 'trade',
      method: 'correct',
      args: [owner, account, created.value.trade.tradeId, {
        requestId: randomUUID(),
        expectedJournalRevision: 1,
        ...execution(firstInstrument, 'buy', '2025-01-02T00:00:00.000Z', 0, '1', '80'),
      }],
    });
    const committed = await writer.finished;
    assert.equal(committed.ok, true);
    assert.equal(committed.value.created, true);
    reader.release();
    const read = await reader.finished;
    assert.equal(read.ok, true);
    assert.equal(read.paused, true);
    assert.deepEqual(read.value, before, 'Reader returns the complete old RR snapshot');
    assert.ok(read.statements.some((sql) => /REPEATABLE READ/i.test(sql)));
    assert.ok(read.statements.some((sql) => /READ ONLY/i.test(sql)));
    const after = await svc.history.getSnapshot(owner, account, rawQuery);
    assert.equal(after.journalRevision, before.journalRevision + 1);
    assert.deepEqual(before.summary, summary({ grossBuysUsd: '50', remainingCostUsd: '350' }));
    assert.deepEqual(after.summary, summary({ grossBuysUsd: '80', remainingCostUsd: '380' }));
    assert.deepEqual(before.items, [
      {
        instrumentId: firstInstrument,
        instrumentName: 'First same-symbol instrument',
        instrumentSymbol: 'SAME',
        quantity: '3',
        costUsd: '350',
      },
    ]);
    assert.deepEqual(after.items, [
      {
        instrumentId: firstInstrument,
        instrumentName: 'First same-symbol instrument',
        instrumentSymbol: 'SAME',
        quantity: '3',
        costUsd: '380',
      },
    ]);
  } finally {
    try {
      reader.release();
    } finally {
      await stopWorkers([reader, writer]);
    }
  }
}

async function supportedMaxima(source, svc, f) {
  stage = 'HIST-003-B all100 baseline lots and1000 maximum-precision active trades';
  const { owner, firstInstrument: instrument } = f;
  const account = await newAccount(svc, owner, 'Historical supported maxima');
  await svc.accounting.saveOpening(owner, account, {
    requestId: randomUUID(), expectedRevision: 0, asOf: coverageFrom,
    positions: [{ instrumentId: instrument, quantity: '100', costStatus: 'known', totalCostUsd: '100' }],
  });
  await svc.carry.initialize(owner, account, {
    requestId: randomUUID(), expectedOpeningRevision: 1, assertReviewed: true,
    lots: Array.from({ length: 100 }, (_, index) => lot(instrument, index, { originalCostUsd: '1' })),
  });
  const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
  const seeded = Array.from({ length: 999 }, (_, index) => {
    const fields = execution(instrument, 'buy', coverageFrom, index, maximum, maximum);
    return { id: randomUUID(), requestId: randomUUID(), revision: index + 1, order: index,
      payload: JSON.stringify({ kind: 'create', expectedJournalRevision: index, ...fields }) };
  });
  // Valid fixture history only in the guarded fresh synthetic database. The final
  // actual service command validates/recomputes all1000 heads plus immutable lots.
  await source.transaction(async (manager) => {
    await manager.query(`INSERT INTO account_trades(id,"ownerId","accountId","currentVersion","createdAt")
      SELECT x.id,$1,$2,1,clock_timestamp() FROM jsonb_to_recordset($3::jsonb) AS x(id uuid)`,
      [owner, account, JSON.stringify(seeded)]);
    await manager.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId",
      "canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,x.id,1,x.revision,x."requestId",x.payload,'create',$4,'buy',$5::timestamptz,x."order",$6::numeric,$6::numeric,0,clock_timestamp()
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,"requestId" uuid,revision integer,"order" integer,payload text)`,
      [owner, account, JSON.stringify(seeded), instrument, coverageFrom, maximum]);
    await manager.query('UPDATE account_trade_journals SET "currentRevision"=999 WHERE "ownerId"=$1 AND "accountId"=$2', [owner, account]);
  });
  const last = await svc.trade.create(owner, account, {
    requestId: randomUUID(), expectedJournalRevision: 999,
    ...execution(instrument, 'buy', coverageFrom, 999, maximum, maximum),
  });
  assert.equal(last.value.journalRevision, 1000);
  const before = await fingerprint(source);
  const snapshot = await at(svc, owner, account, coverageFrom, { limit: '1' });
  // Independently checked with Python Decimal(precision100), not production helpers.
  const buys = '999999999999999999999999999999999999999999999999999.999999999999999999999999999';
  const total = '1000000000000000000000000000000000000000000000000099.999999999999999999999999999';
  assert.equal(snapshot.journalRevision, 1000);
  assert.equal(snapshot.initialCostUsd, '100');
  assert.deepEqual(snapshot.summary, summary({ grossBuysUsd: buys, remainingCostUsd: total }));
  assert.deepEqual(snapshot.items, [{ instrumentId: instrument, instrumentName: 'First same-symbol instrument',
    instrumentSymbol: 'SAME', quantity: total, costUsd: total }]);
  assert.equal(snapshot.nextOffset, null, 'Aggregate all1100 lots before limit1');
  const empty = await at(svc, owner, account, coverageFrom, { offset: '1', limit: '1', journalRevision: '1000' });
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.summary, snapshot.summary);
  assert.equal(empty.initialCostUsd, '100');
  assert.equal(empty.nextOffset, null);
  assert.equal(await fingerprint(source), before, 'Maximum-bound historical reads preserve every row');
}

async function invalidSavedHistory(source, svc, f) {
  stage = 'HIST-003 deliberately malformed saved baseline returns private409';
  const { owner, firstInstrument } = f;
  const account = await carryAccount(svc, owner, firstInstrument, 'Malformed synthetic baseline');
  // Deliberately invalidate chronology only in this fresh isolated fixture. SQL
  // storage constraints remain enabled; a saved domain error is not caller input.
  await source.query(`UPDATE account_carry_in_lots SET "acquiredAt"='2025-01-02T00:00:00Z'
    WHERE "ownerId"=$1 AND "accountId"=$2`, [owner, account]);
  const before = await fingerprint(source);
  await status(() => at(svc, owner, account, coverageFrom), 409);
  assert.equal(await fingerprint(source), before, 'Refusal never repairs or rewrites saved history');
}

async function main() {
  sentinel();
  if (!require('node:fs').existsSync(historyModule)) {
    console.error(
      'PREREQUISITE historical-accounting production service is absent; fixture DB not created',
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
      'Refuse existing fixture databases; never reuse or drop owner data',
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
  assert.equal(migrated.status, 0, 'Actual explicit migrations build the fresh fixture');
  const source = productionSource();
  try {
    await source.initialize();
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const migrations = await source.query('SELECT name FROM migrations ORDER BY timestamp');
    assert.equal(migrations.length, 42);
    assert.equal(migrations[15].name, 'AddKnownCostCarryIn1790060000000');
    assert.equal(migrations[16].name, 'AddExternalUsdFlows1790070000000');
    assert.equal(migrations[17].name, 'AddManualUsdPrices1790080000000');
    assert.equal(migrations[18].name, 'AddDailyDisplayFx1790090000000');
    assert.equal(migrations[19].name, 'AddOwnedTransfers1790100000000');
    const svc = services(source);
    const fixture = await seed(source, svc);
    for (const run of [coverageAndFailures, pagesAndRevision, coherentRead, supportedMaxima, invalidSavedHistory]) {
      await run(source, svc, fixture);
    }
    console.log('PASS HIST-002/003 synthetic production-service PostgreSQL acceptance');
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

const watchdog = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded historical-accounting fixture at stage: ${stage}`);
  process.exit(1);
}, 240000);
watchdog.unref();
(process.argv[2] === '--worker' ? workerMain() : main())
  .catch(() => {
    for (const child of children) child.kill('SIGKILL');
    console.error(`FAIL isolated historical-accounting fixture at stage: ${stage} (details withheld)`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
