'use strict';

// Actual compiled production services and synthetic PostgreSQL only.
// Missing future code/schema is a prerequisite failure, never behavioral RED.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_csv_imports_e2e';
const csvTables = ['account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
const accountingTables = ['manual_accounts', 'accounting_instruments',
  'account_opening_snapshots', 'account_opening_positions'];
const mutableTables = [...csvTables, ...tradeTables, ...accountingTables];
const children = new Set();
const observedStatements = [];
const coverageFrom = '2025-01-01T00:00:00.000Z';
const zeros = { grossBuysUsd: '0', buyFeesUsd: '0', grossSalesUsd: '0', sellFeesUsd: '0',
  netSalesUsd: '0', consumedCostUsd: '0', realizedUsd: '0', remainingCostUsd: '0' };
let stage = 'isolated configuration';

function sentinel(worker = false) {
  for (const [key, value] of Object.entries(settings)) {
    assert.equal(process.env[key], worker && key === 'DB_NAME' ? database : value,
      'Exact isolated synthetic settings required');
  }
}

function services(source) {
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const { CsvImportService } = require('/app/backend/dist/accounting/csv-import.service.js');
  return { accounting: new AccountingService(source), trade: new TradeService(source),
    csv: new CsvImportService(source) };
}

function productionSource(statements) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database }))
    .createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  // Observe the real statements without replacing any database operation/result.
  // Parameters are neither captured nor printed.
  if (statements) {
    options.logging = ['query'];
    options.logger = { logQuery: query => statements.push(query), logQueryError() {},
      logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} };
  }
  return new DataSource(options);
}

async function rows(source, table) {
  assert.match(table, /^[a-z_]+$/);
  return source.query(`SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY row`);
}

async function fingerprint(source, legacy = false) {
  const tables = await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const values = [];
  for (const { tablename } of tables) {
    if (legacy && mutableTables.includes(tablename)) continue;
    values.push([tablename, await rows(source, tablename)]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

async function status(action, expected) {
  let failed = false, actual;
  try { await action(); } catch (error) { failed = true; actual = error?.getStatus?.(); }
  assert.ok(failed, 'Expected a deliberate service rejection');
  assert.equal(actual, expected, 'Reject for the specified domain boundary, not incidental SQL failure');
}

async function rejectedSql(source, action, codes, constraint) {
  const runner = source.createQueryRunner();
  let failure;
  try {
    await runner.connect(); await runner.startTransaction();
    try { await action(runner); } catch (error) { failure = error; }
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { await runner.release(); }
  }
  assert.ok(codes.includes(failure?.driverError?.code ?? failure?.code),
    'Actual PostgreSQL must reject for the intended SQLSTATE');
  if (constraint) assert.equal(failure?.driverError?.constraint ?? failure?.constraint, constraint);
}

async function workerMain() {
  sentinel(true);
  const statements = [];
  const source = productionSource(statements);
  await source.initialize();
  try {
    const commandReady = new Promise(resolve => process.once('message', resolve));
    const [{ pid: databasePid }] = await source.query('SELECT pg_backend_pid() AS pid');
    process.send({ type: 'ready', pid: { process: process.pid, database: databasePid } });
    const { service, method, args, readBarrier } = await commandReady;
    const allowed = service === 'csv' ? ['upload', 'preview', 'confirm', 'rollback', 'detail', 'rows'] :
      service === 'trade' ? ['create', 'correct', 'getJournal'] : [];
    assert.ok(allowed.includes(method));
    statements.length = 0;
    let paused = false;
    if (readBarrier) {
      const { readSync, writeSync } = require('node:fs');
      const capture = source.logger.logQuery;
      source.logger.logQuery = query => {
        if (!paused && /^\s*SELECT\b/i.test(query) && /accounting_instruments|account_trade_versions/i.test(query)) {
          assert.ok(statements.some(sql => /^\s*SELECT\b/i.test(sql) && /manual_accounts|account_trade_journals|account_csv_imports/i.test(sql)),
            'The real read must anchor its snapshot before the observed version/label query');
          assert.ok(statements.some(sql => /REPEATABLE READ/i.test(sql)), 'Actual transaction must request RR');
          assert.ok(statements.some(sql => /READ ONLY/i.test(sql)), 'Actual transaction must be read-only');
          paused = true;
          writeSync(1, 'SYNTHETIC_READ_BARRIER\n');
          const byte = Buffer.alloc(1);
          assert.equal(readSync(0, byte, 0, 1, null), 1);
          assert.equal(byte[0], 1);
        }
        capture(query);
      };
    }
    let result;
    try { result = { ok: true, result: await services(source)[service][method](...args), statements, paused }; }
    catch (error) { result = { ok: false, status: error?.getStatus?.() ?? null }; }
    process.send({ type: 'result', result });
  } finally { await source.destroy(); process.disconnect(); }
}

function startWorker() {
  const child = spawn(process.execPath, [__filename, '--worker'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'], serialization: 'advanced',
  });
  children.add(child);
  let readyResolve, readyReject, resultResolve, resultReject, barrierResolve, barrierReject, result;
  let output = '', errors = '', released = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const finished = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const barrier = new Promise((resolve, reject) => { barrierResolve = resolve; barrierReject = reject; });
  ready.catch(() => {}); finished.catch(() => {}); barrier.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output === 'SYNTHETIC_READ_BARRIER\n') barrierResolve();
    else if (Buffer.byteLength(output) > 1024) child.kill('SIGKILL');
  });
  child.stderr.on('data', chunk => { errors += chunk; if (Buffer.byteLength(errors) > 16384) child.kill('SIGKILL'); });
  child.stdin.on('error', () => {}); // Child exit is checked independently; cleanup must not emit an unhandled EPIPE.
  child.on('message', message => {
    if (message.type === 'ready') readyResolve(message.pid);
    if (message.type === 'result') result = message.result;
  });
  const fail = () => {
    const error = new Error('Isolated CSV worker failed (private details withheld)');
    readyReject(error); resultReject(error); barrierReject(error);
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    clearTimeout(timer); children.delete(child);
    if (code !== 0 || signal || result === undefined || errors !== '' || !['', 'SYNTHETIC_READ_BARRIER\n'].includes(output)) fail();
    else { resultResolve(result); if (!result.paused) barrierReject(new Error('Read stage was not observed')); }
  });
  return { child, ready, finished, barrier, go: command => child.send(command),
    release: () => {
      if (!released && !child.stdin.destroyed) { released = true; child.stdin.write(Buffer.from([1])); }
    } };
}

async function stopWorkers(workers) {
  for (const worker of workers) if (children.has(worker.child)) worker.child.kill('SIGKILL');
  await Promise.allSettled(workers.map(worker => worker.finished));
}

async function processRace(source, account, commands) {
  const workers = commands.map(() => startWorker());
  const blocker = source.createQueryRunner();
  try {
    const pids = await Promise.all(workers.map(worker => worker.ready));
    assert.equal(new Set(pids.map(pid => pid.process)).size, commands.length);
    assert.equal(new Set(pids.map(pid => pid.database)).size, commands.length);
    await blocker.connect(); await blocker.startTransaction();
    await blocker.query('SELECT id FROM manual_accounts WHERE id=$1 FOR UPDATE', [account]);
    workers.forEach((worker, index) => worker.go(commands[index]));
    const deadline = performance.now() + 5000;
    let observed = false;
    while (performance.now() < deadline) {
      const [waiting] = await source.query(`SELECT
        count(*) FILTER (WHERE position('manual_accounts' in query)>0)::int AS row_waits,
        count(*) FILTER (WHERE position('pg_advisory_xact_lock' in query)>0
          AND position('accounting-owner:' in query)>0)::int AS owner_waits
        FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'
          AND cardinality(pg_blocking_pids(pid))>0`, [database]);
      if (waiting.row_waits === 1 && waiting.owner_waits === workers.length - 1) {
        observed = true; break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed,
      'Real contenders wait at one locked account row and serialize on the accounting-owner advisory lock');
    await blocker.commitTransaction();
    return await Promise.all(workers.map(worker => worker.finished));
  } finally {
    try {
      try { if (blocker.isTransactionActive) await blocker.rollbackTransaction(); }
      finally { await blocker.release(); }
    } finally { await stopWorkers(workers); }
  }
}

const execution = (instrumentId, order = 0, changes = {}) => ({ instrumentId, side: 'buy',
  occurredAt: '2025-01-02T00:00:00.000Z', orderWithinTimestamp: order,
  quantity: '1', grossUsd: '100', feeUsd: '0', ...changes });
const command = (instrument, revision, changes = {}) => ({ requestId: randomUUID(),
  expectedJournalRevision: revision, ...execution(instrument, revision, changes) });
const rollbackCommand = revision => ({ requestId: randomUUID(), expectedJournalRevision: revision });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Trusted fixture generation is not an alternate parser for untrusted input.
function sourceFile(executions, note = 'synthetic original', bom = true) {
  const quote = value => /[,"\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  const lines = ['instrument,side,time,order,quantity,gross,fee,note'];
  for (const value of executions) lines.push([
    'TOKEN', value.side.toUpperCase(), value.occurredAt, String(value.orderWithinTimestamp),
    value.quantity, value.grossUsd, value.feeUsd, note,
  ].map(quote).join(','));
  return Buffer.from((bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n', 'utf8');
}
function settingsFor(instrument, executions) {
  return { format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: { columns: { instrument: 0, side: 1, occurredAt: 2, order: 3, quantity: 4, grossUsd: 5, feeUsd: 6 },
      instruments: [{ source: 'TOKEN', instrumentId: instrument }],
      sides: [...new Set(executions.map(value => value.side))].sort(compare)
        .map(side => ({ source: side.toUpperCase(), side })) }, assertUsd: true };
}
function tuples(settings) {
  const { format: f, mapping: m } = settings, c = m.columns;
  return [[f.delimiter, f.decimalSeparator, f.timestampMode, f.fixedOffset ?? null],
    [[c.instrument, c.side, c.occurredAt, c.order, c.quantity, c.grossUsd, c.feeUsd, c.currency ?? null],
      [...m.instruments].sort((a, b) => compare(a.source, b.source))
        .map(value => [value.source, value.instrumentId.toLowerCase()]),
      [...m.sides].sort((a, b) => compare(a.source, b.source)).map(value => [value.source, value.side])]];
}
function expectedHash(account, batch, settings, expectedRows, revision, parserVersion = 'usd-csv-v1') {
  const [format, mapping] = tuples(settings);
  return digest(Buffer.from(JSON.stringify(['usd-csv-preview-v1', parserVersion, account, batch.batchId,
    batch.sha256, format, mapping, true, expectedRows.map(({ ordinal, startLine, execution: e }) =>
      [ordinal, startLine, [e.instrumentId, e.side, e.occurredAt, e.orderWithinTimestamp, e.quantity, e.grossUsd, e.feeUsd]]), revision])));
}
function expectedPayload(batch, input, kind = 'confirm') {
  if (kind === 'rollback') return JSON.stringify(['usd-csv-command-v1', kind, batch, input.expectedJournalRevision]);
  const [format, mapping] = tuples(input);
  return JSON.stringify(['usd-csv-command-v1', kind, batch, input.expectedJournalRevision,
    input.parserVersion, format, mapping, true, input.previewHash]);
}
function receipt(value, account, batch, input, kind, count) {
  assert.deepEqual(Object.keys(value).sort(), ['accountId', 'batchId', 'requestId', 'kind', 'rowCount',
    'firstJournalRevision', 'lastJournalRevision', 'createdAt'].sort());
  assert.deepEqual({ ...value, createdAt: undefined }, { accountId: account, batchId: batch,
    requestId: input.requestId, kind, rowCount: count, firstJournalRevision: input.expectedJournalRevision + 1,
    lastJournalRevision: input.expectedJournalRevision + count, createdAt: undefined });
  assert.match(value.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
}
async function newAccount(accounting, owner, name) {
  return (await accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
}
async function newJournal(svc, owner, name) {
  const account = await newAccount(svc.accounting, owner, name);
  await svc.trade.initialize(owner, account, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
  return account;
}
async function batch(svc, owner, account, instrument, executions, note) {
  const bytes = sourceFile(executions, note);
  const uploaded = await svc.csv.upload(owner, account, { filename: 'Синтетические сделки 📒.csv', bytes });
  assert.equal(uploaded.created, true);
  assert.equal(uploaded.value.sha256, digest(bytes)); assert.equal(uploaded.value.byteLength, bytes.length);
  const settings = settingsFor(instrument, executions);
  const expectedRows = executions.map((value, index) => ({ ordinal: index + 1, startLine: index + 2, execution: value }));
  return { account, bytes, uploaded: uploaded.value, settings, expectedRows };
}
async function previewCommand(svc, owner, value, revision) {
  const preview = await svc.csv.preview(owner, value.account, value.uploaded.batchId, value.settings);
  assert.equal(preview.canConfirm, true); assert.equal(preview.journalRevision, revision);
  assert.deepEqual(preview.rows, value.expectedRows); assert.deepEqual(preview.rowErrors, []);
  assert.deepEqual(preview.batchErrors, []);
  assert.deepEqual(preview.ignoredColumns, [{ index: 7, header: 'note' }]);
  assert.equal(preview.previewHash, expectedHash(value.account, value.uploaded, value.settings, value.expectedRows, revision));
  return { requestId: randomUUID(), expectedJournalRevision: revision, parserVersion: 'usd-csv-v1',
    ...value.settings, previewHash: preview.previewHash };
}
async function confirm(svc, owner, value, revision) {
  const input = await previewCommand(svc, owner, value, revision);
  const result = await svc.csv.confirm(owner, value.account, value.uploaded.batchId, input);
  assert.equal(result.created, true);
  receipt(result.value, value.account, value.uploaded.batchId, input, 'confirm', value.expectedRows.length);
  return { input, value: result.value };
}
async function unchanged(source, action, expected) {
  const before = await fingerprint(source);
  await status(action, expected);
  assert.equal(await fingerprint(source), before, 'A refused operation changes no row or accepted key');
}
async function seed(source, svc) {
  const users = [];
  for (const email of ['csv-owner@example.invalid', 'csv-other@example.invalid']) {
    const [user] = await source.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES($1,'synthetic-direct-service-not-a-login-hash',true) RETURNING id`, [email]);
    users.push(user.id);
    await source.query(`INSERT INTO crypto_wallets("userId",type,address,balance)
      VALUES($1,'bitcoin',$2,'1.250000000000000001')`, [user.id, 'synthetic-' + email]);
    for (const [table, category] of [['assets', 'savings'], ['liabilities', 'loans']]) {
      await source.query(`INSERT INTO ${table}("userId",name,category,amount,"currencyId",date)
        SELECT $1,'Preserved synthetic finance',$2,'123.45',id,'2026-01-01'
        FROM currencies WHERE code='USD'`, [user.id, category]);
    }
  }
  const [owner, other] = users;
  await source.query('INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)', [owner, randomUUID()]);
  const { AuthRequestLimitsService } = require('/app/backend/dist/auth/request-limits.service.js');
  await new AuthRequestLimitsService(source).admit('login-account', 'csv-owner@example.invalid');
  const instruments = [];
  for (let index = 0; index < 2; index++) instruments.push((await svc.accounting.createInstrument(owner,
    { requestId: randomUUID(), name: 'Synthetic CSV instrument ' + index, symbol: 'SAME' })).value.id);
  const foreignInstrument = (await svc.accounting.createInstrument(other,
    { requestId: randomUUID(), name: 'Foreign CSV instrument', symbol: 'SAME' })).value.id;
  const foreignAccount = await newJournal(svc, other, 'Foreign CSV journal');
  const retainedAccount = await newJournal(svc, owner, 'Preserved prior USD history');
  const old = await svc.trade.create(owner, retainedAccount, command(instruments[0], 0));
  await svc.trade.correct(owner, retainedAccount, old.value.trade.tradeId,
    command(instruments[0], 1, { grossUsd: '120' }));
  await svc.trade.void(owner, retainedAccount, old.value.trade.tradeId, rollbackCommand(2));
  for (const costStatus of ['known', 'unknown']) {
    const account = await newAccount(svc.accounting, owner, 'Preserved ' + costStatus + ' opening');
    await svc.accounting.saveOpening(owner, account, { requestId: randomUUID(), expectedRevision: 0,
      asOf: coverageFrom, positions: [{ instrumentId: instruments[0], quantity: '2', costStatus,
        totalCostUsd: costStatus === 'known' ? '0' : null }] });
  }
  return { owner, other, instruments, foreignInstrument, foreignAccount, retainedAccount };
}

async function originals(source, svc, fixture) {
  stage = 'CSV-001-A/B / CSV-002-A/C / CSV-007-A originals, read-only parsing and scoped identities';
  const { owner, other, instruments: [instrument], foreignAccount, foreignInstrument } = fixture;
  const account = await newJournal(svc, owner, 'Private source identity');
  const executions = [execution(instrument)];
  const value = await batch(svc, owner, account, instrument, executions);
  const id = value.uploaded.batchId;
  const [stored] = await source.query(`SELECT encode("originalBytes",'hex') AS bytes,sha256,"byteLength",filename,state,
    "acceptedSettings" FROM account_csv_imports WHERE id=$1`, [id]);
  assert.deepEqual(stored, { bytes: value.bytes.toString('hex'), sha256: digest(value.bytes), byteLength: value.bytes.length,
    filename: 'Синтетические сделки 📒.csv', state: 'draft', acceptedSettings: null });
  const before = await fingerprint(source);
  assert.deepEqual(await svc.csv.upload(owner, account.toUpperCase(), { filename: 'Renamed.csv', bytes: value.bytes }),
    { created: false, value: value.uploaded });
  assert.deepEqual(await svc.csv.inspect(owner, account, id, { delimiter: ',' }), { batchId: id, valid: true,
    headers: ['instrument', 'side', 'time', 'order', 'quantity', 'gross', 'fee', 'note'], error: null,
    rows: [{ ordinal: 1, startLine: 2, cells: ['TOKEN', 'BUY', executions[0].occurredAt, '0', '1', '100', '0', 'synthetic original'] }] });
  await previewCommand(svc, owner, value, 0);
  const detail = await svc.csv.detail(owner, account, id);
  assert.equal(detail.batch.filename, stored.filename); assert.equal(detail.acceptedSettings, null);
  assert.deepEqual(detail.rollbackReview, { journalRevision: 0, eligible: false, reason: 'not-committed',
    removedTradeCount: 0, additionalVersionCount: 0, summaryBefore: zeros, summaryAfter: null });
  assert.deepEqual(await svc.csv.rows(owner, account, id), { batchId: id, batchState: 'draft', items: [], nextAfterOrdinal: null });
  assert.deepEqual(await svc.csv.list(owner, account), { items: [{ ...value.uploaded, accountId: account,
    filename: stored.filename, state: 'draft' }], nextCursor: null });
  assert.equal(await fingerprint(source), before, 'Inspect/preview/detail/list/source replay write absolutely nothing');
  for (const method of ['inspect', 'preview', 'detail', 'rows']) {
    const body = method === 'inspect' ? { delimiter: ',' } : method === 'preview' ? value.settings : {};
    await unchanged(source, () => svc.csv[method](other, account, id, body), 404);
  }
  await unchanged(source, () => svc.csv.upload(owner, foreignAccount, { filename: 'Source.csv', bytes: value.bytes }), 404);
  const uninitialized = await newAccount(svc.accounting, owner, 'Absent journal');
  await unchanged(source, () => svc.csv.upload(owner, uninitialized, { filename: 'Source.csv', bytes: value.bytes }), 409);
  await unchanged(source, () => svc.csv.preview(owner, account, id, { ...value.settings,
    mapping: { ...value.settings.mapping, instruments: [{ source: 'TOKEN', instrumentId: foreignInstrument }] } }), 404);
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xc0, 0xaf]), Buffer.from([0xff, 0xfe]),
    Buffer.from('a\0b'), Buffer.from('a\rb')]) {
    await unchanged(source, () => svc.csv.upload(owner, account, { filename: 'Source.csv', bytes }), 400);
  }
  await unchanged(source, () => svc.csv.upload(owner, account,
    { filename: 'Source.csv', bytes: Buffer.alloc(262145, 97) }), 413);
  const different = Buffer.from(value.bytes.toString('utf8').replace('synthetic original', 'another original'));
  // Simulate a digest-index hit with unequal bytes, without claiming a real SHA collision.
  await source.query('UPDATE account_csv_imports SET sha256=$2 WHERE id=$1', [id, digest(different)]);
  try { await unchanged(source, () => svc.csv.upload(owner, account, { filename: 'Mismatch.csv', bytes: different }), 409); }
  finally { await source.query('UPDATE account_csv_imports SET sha256=$2 WHERE id=$1', [id, value.uploaded.sha256]); }
  const malformed = await svc.csv.upload(owner, account, { filename: 'Malformed.csv', bytes: Buffer.from('a,b\n1,2\n3,"unfinished') });
  const malformedBefore = await fingerprint(source);
  const inspection = await svc.csv.inspect(owner, account, malformed.value.batchId, { delimiter: ',' });
  assert.equal(inspection.valid, false); assert.deepEqual(inspection.headers, []); assert.deepEqual(inspection.rows, []);
  assert.equal(inspection.error.code, 'csv-syntax');
  const invalidPreview = await svc.csv.preview(owner, account, malformed.value.batchId, value.settings);
  assert.equal(invalidPreview.canConfirm, false); assert.equal(invalidPreview.previewHash, null);
  assert.equal(invalidPreview.candidateSummary, null); assert.deepEqual(invalidPreview.rows, []);
  assert.equal(await fingerprint(source), malformedBefore);
  console.log('PASS CSV-001-A/B / CSV-002-A/C / CSV-007-A exact private source, read-only draft operations and real owner identity boundaries');
}

async function wholeBatch(source, svc, fixture) {
  stage = 'CSV-003-A/B / CSV-005-A / CSV-TRADE-001 source-order-independent FIFO and immutable receipts';
  const { owner, instruments: [instrument] } = fixture;
  const account = await newJournal(svc, owner, 'Whole source candidate');
  const executions = [execution(instrument, 0, { side: 'sell', occurredAt: '2025-01-04T00:00:00.000Z', quantity: '1.5', grossUsd: '450' }),
    execution(instrument, 0), execution(instrument, 0, { occurredAt: '2025-01-03T00:00:00.000Z', grossUsd: '200' })];
  const value = await batch(svc, owner, account, instrument, executions);
  const beforePreview = await fingerprint(source);
  const input = await previewCommand(svc, owner, value, 0);
  const equivalent = { ...value.settings, mapping: { ...value.settings.mapping,
    instruments: [{ source: 'TOKEN', instrumentId: instrument.toUpperCase() }],
    sides: [...value.settings.mapping.sides].reverse() } };
  assert.equal((await svc.csv.preview(owner, account, value.uploaded.batchId, equivalent)).previewHash, input.previewHash);
  assert.equal(await fingerprint(source), beforePreview);
  const saved = await svc.csv.confirm(owner, account, value.uploaded.batchId, input);
  assert.equal(saved.created, true); receipt(saved.value, account, value.uploaded.batchId, input, 'confirm', 3);
  const summary = { grossBuysUsd: '300', buyFeesUsd: '0', grossSalesUsd: '450', sellFeesUsd: '0',
    netSalesUsd: '450', consumedCostUsd: '200', realizedUsd: '250', remainingCostUsd: '100' };
  const journal = (await svc.trade.getJournal(owner, account)).journal;
  assert.equal(journal.journalRevision, 3); assert.equal(journal.activeTradeCount, 3); assert.equal(journal.versionCount, 3);
  assert.deepEqual(journal.summary, summary);
  const provenance = await svc.csv.rows(owner, account, value.uploaded.batchId, { limit: '100' });
  assert.equal(provenance.batchState, 'committed'); assert.equal(provenance.items.length, 3); assert.equal(provenance.nextAfterOrdinal, null);
  const generatedKeys = new Set();
  for (const [index, row] of provenance.items.entries()) {
    assert.equal(row.ordinal, index + 1); assert.equal(row.startLine, index + 2); assert.equal(row.rollbackVersion, null);
    assert.equal(row.createVersion.tradeId, row.tradeId); assert.equal(row.createVersion.version, 1);
    assert.equal(row.createVersion.kind, 'create'); assert.equal(row.createVersion.journalRevision, index + 1);
    for (const [key, expected] of Object.entries(executions[index])) assert.equal(row.createVersion[key], expected);
    assert.match(row.createVersion.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    generatedKeys.add(row.createVersion.requestId);
    const [stored] = await source.query(`SELECT "canonicalPayload",quantity::text AS quantity FROM account_trade_versions
      WHERE "ownerId"=$1 AND "accountId"=$2 AND "tradeId"=$3 AND version=1`, [owner, account, row.tradeId]);
    assert.equal(stored.canonicalPayload, JSON.stringify({ kind: 'create', expectedJournalRevision: index, ...executions[index] }));
    assert.equal(stored.quantity, index === 0 ? '1.5' + '0'.repeat(29) : '1.' + '0'.repeat(30));
  }
  assert.equal(generatedKeys.size, 3); assert.ok(!generatedKeys.has(input.requestId));
  const [storedCommand] = await source.query('SELECT "canonicalPayload" FROM account_csv_import_commands WHERE "requestId"=$1', [input.requestId]);
  assert.equal(storedCommand.canonicalPayload, expectedPayload(value.uploaded.batchId, input));
  const lots = (await svc.trade.listLots(owner, account)).items;
  assert.equal(lots.length, 1); assert.equal(lots[0].buyTradeId, provenance.items[2].tradeId);
  assert.equal(lots[0].remainingQuantity, '0.5'); assert.equal(lots[0].remainingCostUsd, '100');
  const matches = (await svc.trade.listMatches(owner, account, provenance.items[0].tradeId)).items;
  assert.deepEqual(matches.map(row => [row.buyTradeId, row.buyVersion, row.quantity, row.costUsd]),
    [[provenance.items[1].tradeId, 1, '1', '100'], [provenance.items[2].tradeId, 1, '0.5', '100']]);
  await svc.trade.correct(owner, account, provenance.items[1].tradeId,
    { requestId: randomUUID(), expectedJournalRevision: 3, ...executions[1], grossUsd: '120' });
  const afterCorrection = await fingerprint(source);
  assert.deepEqual(await svc.csv.confirm(owner, account.toUpperCase(), value.uploaded.batchId.toUpperCase(),
    { ...input, requestId: input.requestId.toUpperCase(), ...equivalent }), { created: false, value: saved.value });
  assert.equal(await fingerprint(source), afterCorrection, 'Old batch receipt cannot rewind corrected heads or current results');
  assert.equal((await svc.trade.getJournal(owner, account)).journal.summary.realizedUsd, '230');
  for (const changed of [{ ...input, expectedJournalRevision: 4 }, { ...input, previewHash: '0'.repeat(64) },
    { ...input, parserVersion: 'usd-csv-v0' }]) {
    await unchanged(source, () => svc.csv.confirm(owner, account, value.uploaded.batchId, changed), 409);
  }
  await unchanged(source, () => svc.csv.rollback(owner, account, value.uploaded.batchId,
    { requestId: input.requestId, expectedJournalRevision: 4 }), 409);
  await unchanged(source, () => svc.csv.confirm(owner, account, value.uploaded.batchId, { ...input, requestId: randomUUID() }), 409);
  await unchanged(source, () => svc.csv.preview(owner, account, value.uploaded.batchId, value.settings), 409);
  console.log('PASS CSV-003-A/B / CSV-005-A / CSV-TRADE-001 whole sale-first source commits250/100, exact provenance and immutable replay before current heads');
  return { ...value, saved, input, provenance };
}


async function historicalReceipt(source, svc, fixture) {
  stage = 'CSV-003-B historical receipt replay before current parser support';
  const { owner, instruments: [instrument] } = fixture;
  const account = await newJournal(svc, owner, 'Historical parser receipt');
  const value = await batch(svc, owner, account, instrument, [execution(instrument)]);
  const accepted = await confirm(svc, owner, value, 0);
  const target = value.uploaded.batchId;
  const [original] = await source.query(`SELECT i."acceptedSettings",c."canonicalPayload"
    FROM account_csv_imports i JOIN account_csv_import_commands c ON c."batchId"=i.id
    WHERE i.id=$1 AND c."requestId"=$2`, [target, accepted.input.requestId]);
  const draft = await batch(svc, owner, account, instrument, [execution(instrument, 1)], 'unsupported draft');
  const supported = await previewCommand(svc, owner, draft, 1);
  const beforeFixture = await fingerprint(source);
  const historical = { ...accepted.input, parserVersion: 'usd-csv-v0',
    previewHash: expectedHash(account, value.uploaded, value.settings, value.expectedRows, 0, 'usd-csv-v0') };
  // Construct an isolated historical receipt; the current writer never accepts unsupported versions.
  // Original bytes, source links, trade versions, heads and all receipt columns remain untouched.
  await source.transaction(async manager => {
    await manager.query('UPDATE account_csv_imports SET "acceptedSettings"=$2::jsonb WHERE id=$1',
      [target, JSON.stringify({ ...original.acceptedSettings, parserVersion: historical.parserVersion })]);
    await manager.query('UPDATE account_csv_import_commands SET "canonicalPayload"=$2 WHERE "requestId"=$1',
      [historical.requestId, expectedPayload(target, historical)]);
  });
  try {
    const afterHistoricalFixture = await fingerprint(source);
    assert.deepEqual(await svc.csv.confirm(owner, account, target, historical), { created: false, value: accepted.value });
    assert.equal(await fingerprint(source), afterHistoricalFixture);
    await unchanged(source, () => svc.csv.confirm(owner, account, target,
      { ...historical, previewHash: 'f'.repeat(64) }), 409);
    await unchanged(source, () => svc.csv.confirm(owner, account, target,
      { ...historical, requestId: randomUUID() }), 409);
    // A fresh draft demonstrates parser support refusal independently of terminal batch state.
    await unchanged(source, () => svc.csv.confirm(owner, account, draft.uploaded.batchId,
      { ...supported, parserVersion: historical.parserVersion,
        previewHash: expectedHash(account, draft.uploaded, draft.settings, draft.expectedRows, 1, historical.parserVersion) }), 409);
    assert.equal(await fingerprint(source), afterHistoricalFixture);
  } finally {
    await source.transaction(async manager => {
      await manager.query('UPDATE account_csv_imports SET "acceptedSettings"=$2::jsonb WHERE id=$1',
        [target, JSON.stringify(original.acceptedSettings)]);
      await manager.query('UPDATE account_csv_import_commands SET "canonicalPayload"=$2 WHERE "requestId"=$1',
        [historical.requestId, original.canonicalPayload]);
    });
  }
  assert.equal(await fingerprint(source), beforeFixture);
  console.log('PASS CSV-003-B isolated historical parser receipt replays before support checks; changed and new commands remain refused');
}

async function rollbackHistory(source, svc, fixture) {
  stage = 'CSV-004-A/B / CSV-005-B complete rollback reallocation, refusal and state-pinned provenance';
  const { owner, instruments: [instrument] } = fixture;
  const account = await newJournal(svc, owner, 'Rollback reallocation');
  const value = await batch(svc, owner, account, instrument, [execution(instrument)]);
  const accepted = await confirm(svc, owner, value, 0);
  await svc.trade.create(owner, account, command(instrument, 1, { occurredAt: '2025-01-03T00:00:00.000Z', grossUsd: '200' }));
  await svc.trade.create(owner, account, command(instrument, 2, { side: 'sell', occurredAt: '2025-01-04T00:00:00.000Z', grossUsd: '300' }));
  const original = await svc.csv.rows(owner, account, value.uploaded.batchId);
  const detail = await svc.csv.detail(owner, account, value.uploaded.batchId);
  assert.deepEqual(detail.rollbackReview, { journalRevision: 3, eligible: true, reason: null,
    removedTradeCount: 1, additionalVersionCount: 1,
    summaryBefore: { grossBuysUsd: '300', buyFeesUsd: '0', grossSalesUsd: '300', sellFeesUsd: '0', netSalesUsd: '300',
      consumedCostUsd: '100', realizedUsd: '200', remainingCostUsd: '200' },
    summaryAfter: { grossBuysUsd: '200', buyFeesUsd: '0', grossSalesUsd: '300', sellFeesUsd: '0', netSalesUsd: '300',
      consumedCostUsd: '200', realizedUsd: '100', remainingCostUsd: '0' } });
  const input = rollbackCommand(3);
  const saved = await svc.csv.rollback(owner, account, value.uploaded.batchId, input);
  assert.equal(saved.created, true); receipt(saved.value, account, value.uploaded.batchId, input, 'rollback', 1);
  assert.deepEqual((await svc.trade.getJournal(owner, account)).journal.summary, detail.rollbackReview.summaryAfter);
  assert.deepEqual((await svc.trade.listLots(owner, account)).items, []);
  const afterRows = await svc.csv.rows(owner, account, value.uploaded.batchId);
  assert.equal(afterRows.batchState, 'rolled-back'); assert.equal(afterRows.items.length, 1);
  assert.deepEqual(afterRows.items[0].createVersion, original.items[0].createVersion);
  assert.equal(afterRows.items[0].rollbackVersion.kind, 'void'); assert.equal(afterRows.items[0].rollbackVersion.version, 2);
  assert.equal(afterRows.items[0].rollbackVersion.tradeId, original.items[0].tradeId);
  await svc.trade.create(owner, account, command(instrument, 4, { occurredAt: '2025-01-05T00:00:00.000Z' }));
  const before = await fingerprint(source);
  assert.deepEqual(await svc.csv.rollback(owner, account, value.uploaded.batchId, input), { created: false, value: saved.value });
  assert.deepEqual(await svc.csv.confirm(owner, account, value.uploaded.batchId, accepted.input), { created: false, value: accepted.value });
  assert.deepEqual(await svc.csv.upload(owner, account, { filename: 'Again.csv', bytes: value.bytes }), { created: false, value: value.uploaded });
  assert.equal((await svc.csv.inspect(owner, account, value.uploaded.batchId, { delimiter: ',' })).valid, true);
  assert.equal(await fingerprint(source), before);
  for (const query of [{ afterOrdinal: '1', batchState: 'committed' }, { batchState: 'committed' }])
    await unchanged(source, () => svc.csv.rows(owner, account, value.uploaded.batchId, query), 409);
  for (const query of [{ afterOrdinal: '1' }, { afterOrdinal: 1 }, { limit: '101' }])
    await unchanged(source, () => svc.csv.rows(owner, account, value.uploaded.batchId, query), 400);

  const wholeAccount = await newJournal(svc, owner, 'Whole rollback and immutable page cursor');
  const whole = await batch(svc, owner, wholeAccount, instrument, [execution(instrument),
    execution(instrument, 1, { grossUsd: '200' }),
    execution(instrument, 2, { side: 'sell', quantity: '1.5', grossUsd: '450' })]);
  await confirm(svc, owner, whole, 0);
  const firstPage = await svc.csv.rows(owner, wholeAccount, whole.uploaded.batchId, { limit: '1' });
  assert.equal(firstPage.nextAfterOrdinal, 1);
  await svc.trade.create(owner, wholeAccount, command(instrument, 3,
    { occurredAt: '2025-01-05T00:00:00.000Z', grossUsd: '50' }));
  const rest = await svc.csv.rows(owner, wholeAccount, whole.uploaded.batchId,
    { afterOrdinal: '1', batchState: 'committed', limit: '2' });
  assert.deepEqual(rest.items.map(row => row.ordinal), [2, 3]);
  await svc.csv.rollback(owner, wholeAccount, whole.uploaded.batchId, rollbackCommand(4));
  assert.deepEqual((await svc.trade.getJournal(owner, wholeAccount)).journal.summary,
    { ...zeros, grossBuysUsd: '50', remainingCostUsd: '50' });
  await unchanged(source, () => svc.csv.rows(owner, wholeAccount, whole.uploaded.batchId,
    { afterOrdinal: '1', batchState: 'committed' }), 409);
  const complete = await svc.csv.rows(owner, wholeAccount, whole.uploaded.batchId, { batchState: 'rolled-back' });
  assert.equal(complete.items.length, 3);
  for (const row of complete.items) assert.equal(row.rollbackVersion.version, 2);

  for (const changed of ['dependent', 'corrected', 'voided']) {
    const target = await newJournal(svc, owner, 'Refused rollback ' + changed);
    const imported = await batch(svc, owner, target, instrument, [execution(instrument)]);
    await confirm(svc, owner, imported, 0);
    const row = (await svc.csv.rows(owner, target, imported.uploaded.batchId)).items[0];
    if (changed === 'dependent') await svc.trade.create(owner, target, command(instrument, 1,
      { side: 'sell', occurredAt: '2025-01-03T00:00:00.000Z' }));
    else if (changed === 'corrected') await svc.trade.correct(owner, target, row.tradeId,
      { requestId: randomUUID(), expectedJournalRevision: 1, ...execution(instrument) });
    else await svc.trade.void(owner, target, row.tradeId, rollbackCommand(1));
    const review = (await svc.csv.detail(owner, target, imported.uploaded.batchId)).rollbackReview;
    assert.equal(review.eligible, false); assert.equal(review.summaryAfter, null);
    assert.equal(review.reason, changed === 'dependent' ? 'insufficient-holdings' : 'modified-trade');
    await unchanged(source, () => svc.csv.rollback(owner, target, imported.uploaded.batchId, rollbackCommand(2)), 409);
  }
  console.log('PASS CSV-004-A/B / CSV-005-B safe200-to100 reallocation, immutable terminal evidence and atomic refusal of changed/dependent imports');
}

async function races(source, svc, fixture) {
  stage = 'CSV-003-B / CSV-004-B actual process locks, distinct chronology CAS and exact conservation';
  const { owner, instruments: [instrument] } = fixture;
  for (const sameKey of [true, false]) {
    const account = await newJournal(svc, owner, 'Concurrent confirmations ' + sameKey);
    const value = await batch(svc, owner, account, instrument, [execution(instrument)]);
    const input = await previewCommand(svc, owner, value, 0);
    const commands = [input, sameKey ? input : { ...input, requestId: randomUUID() }];
    const outcomes = await processRace(source, account, commands.map(body => ({ service: 'csv', method: 'confirm',
      args: [owner, account, value.uploaded.batchId, body] })));
    assert.equal(outcomes.filter(item => item.ok && item.result.created).length, 1);
    if (sameKey) {
      assert.equal(outcomes.filter(item => item.ok && !item.result.created).length, 1);
      assert.deepEqual(outcomes[0].result.value, outcomes[1].result.value);
    } else {
      assert.equal(outcomes.filter(item => !item.ok && item.status === 409).length, 1);
      const loser = commands[outcomes.findIndex(item => !item.ok)];
      assert.equal((await source.query('SELECT count(*)::int AS n FROM account_csv_import_commands WHERE "requestId"=$1', [loser.requestId]))[0].n, 0);
    }
    assert.equal((await svc.trade.getJournal(owner, account)).journal.journalRevision, 1);
    assert.equal((await svc.csv.rows(owner, account, value.uploaded.batchId)).items.length, 1);
  }
  const account = await newJournal(svc, owner, 'Import versus manual sale');
  await svc.trade.create(owner, account, command(instrument, 0));
  const value = await batch(svc, owner, account, instrument,
    [execution(instrument, 1, { side: 'sell', quantity: '0.75', grossUsd: '90' })]);
  const input = await previewCommand(svc, owner, value, 1);
  const manual = command(instrument, 1, { side: 'sell', quantity: '0.75', grossUsd: '90', orderWithinTimestamp: 2 });
  const outcomes = await processRace(source, account, [
    { service: 'csv', method: 'confirm', args: [owner, account, value.uploaded.batchId, input] },
    { service: 'trade', method: 'create', args: [owner, account, manual] },
  ]);
  assert.equal(outcomes.filter(item => item.ok && item.result.created).length, 1);
  assert.equal(outcomes.filter(item => !item.ok && item.status === 409).length, 1);
  const journal = (await svc.trade.getJournal(owner, account)).journal;
  assert.equal(journal.journalRevision, 2); assert.equal(journal.activeTradeCount, 2);
  assert.deepEqual(journal.summary, { grossBuysUsd: '100', buyFeesUsd: '0', grossSalesUsd: '90', sellFeesUsd: '0',
    netSalesUsd: '90', consumedCostUsd: '75', realizedUsd: '15', remainingCostUsd: '25' });
  assert.deepEqual((await svc.trade.listLots(owner, account)).items.map(row => [row.remainingQuantity, row.remainingCostUsd]), [['0.25', '25']]);
  const importLost = !outcomes[0].ok;
  const losingKey = importLost ? input.requestId : manual.requestId;
  const keyTable = importLost ? 'account_csv_import_commands' : 'account_trade_versions';
  assert.equal((await source.query(`SELECT count(*)::int AS n FROM ${keyTable} WHERE "requestId"=$1`, [losingKey]))[0].n, 0);
  await unchanged(source, () => importLost ? svc.csv.confirm(owner, account, value.uploaded.batchId, input) : svc.trade.create(owner, account, manual), 409);
  await svc.trade.create(owner, account, command(instrument, 2,
    { occurredAt: '2025-01-01T12:00:00.000Z', quantity: '0.5', grossUsd: '50' }));
  if (importLost) {
    const refreshed = { ...(await previewCommand(svc, owner, value, 3)), requestId: losingKey };
    assert.equal((await svc.csv.confirm(owner, account, value.uploaded.batchId, refreshed)).created, true);
  } else assert.equal((await svc.trade.create(owner, account, { ...manual, expectedJournalRevision: 3 })).created, true);
  assert.deepEqual((await svc.trade.getJournal(owner, account)).journal.summary,
    { grossBuysUsd: '150', buyFeesUsd: '0', grossSalesUsd: '180', sellFeesUsd: '0', netSalesUsd: '180',
      consumedCostUsd: '150', realizedUsd: '30', remainingCostUsd: '0' });

  const rollbackAccount = await newJournal(svc, owner, 'Rollback versus manual correction');
  const imported = await batch(svc, owner, rollbackAccount, instrument, [execution(instrument)]);
  await confirm(svc, owner, imported, 0);
  const target = (await svc.csv.rows(owner, rollbackAccount, imported.uploaded.batchId)).items[0].tradeId;
  const collision = await processRace(source, rollbackAccount, [
    { service: 'csv', method: 'rollback', args: [owner, rollbackAccount, imported.uploaded.batchId, rollbackCommand(1)] },
    { service: 'trade', method: 'correct', args: [owner, rollbackAccount, target, command(instrument, 1, { grossUsd: '120' })] },
  ]);
  assert.equal(collision.filter(item => item.ok && item.result.created).length, 1);
  assert.equal(collision.filter(item => !item.ok && item.status === 409).length, 1);
  assert.equal((await svc.trade.getJournal(owner, rollbackAccount)).journal.journalRevision, 2);
  console.log('PASS CSV-003-B / CSV-004-B observed independent process/account locks, once-only acceptance, sale conservation and rejected-key reuse');
}

async function deferredCommit(source, svc, fixture) {
  stage = 'CSV-003-C / CSV-004-B real deferred COMMIT after all batch writes';
  const { owner, instruments: [instrument] } = fixture;
  const account = await newJournal(svc, owner, 'Deferred CSV commit');
  const value = await batch(svc, owner, account, instrument, [execution(instrument), execution(instrument, 1, { grossUsd: '200' })]);
  let accepted;
  for (const kind of ['confirm', 'rollback']) {
    const input = kind === 'confirm' ? await previewCommand(svc, owner, value, 0) : rollbackCommand(2);
    const before = await fingerprint(source);
    const marker = 'synthetic-csv-commit-private-canary';
    let installed = false;
    try {
      await source.query('CREATE SEQUENCE synthetic_csv_commit_attempt START 1'); installed = true;
      await source.query(`CREATE FUNCTION synthetic_csv_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE rows_seen integer; versions_seen integer; expected_version integer;
        BEGIN
          IF NEW."requestId"='${input.requestId}'::uuid THEN
            expected_version := CASE WHEN NEW.kind='confirm' THEN 1 ELSE 2 END;
            SELECT count(*) INTO rows_seen FROM account_csv_import_rows r JOIN account_trades t
              ON t."ownerId"=r."ownerId" AND t."accountId"=r."accountId" AND t.id=r."tradeId"
              WHERE r."ownerId"=NEW."ownerId" AND r."accountId"=NEW."accountId" AND r."batchId"=NEW."batchId"
              AND r."createVersion"=1 AND t."currentVersion"=expected_version
              AND ((NEW.kind='confirm' AND r."rollbackVersion" IS NULL) OR (NEW.kind='rollback' AND r."rollbackVersion"=2));
            SELECT count(*) INTO versions_seen FROM account_trade_versions v JOIN account_csv_import_rows r
              ON v."ownerId"=r."ownerId" AND v."accountId"=r."accountId" AND v."tradeId"=r."tradeId"
              WHERE r."batchId"=NEW."batchId" AND v.version=expected_version
              AND v.kind=CASE WHEN NEW.kind='confirm' THEN 'create' ELSE 'void' END
              AND v."journalRevision" BETWEEN NEW."firstJournalRevision" AND NEW."lastJournalRevision";
            IF rows_seen<>NEW."rowCount" OR versions_seen<>NEW."rowCount"
              OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "ownerId"=NEW."ownerId"
                AND "accountId"=NEW."accountId" AND "currentRevision"=NEW."lastJournalRevision")
              OR NOT EXISTS(SELECT 1 FROM account_csv_imports WHERE id=NEW."batchId" AND "acceptedSettings" IS NOT NULL
                AND state=CASE WHEN NEW.kind='confirm' THEN 'committed' ELSE 'rolled-back' END) THEN
              RAISE EXCEPTION 'synthetic CSV stage missed complete writes';
            END IF;
            PERFORM nextval('synthetic_csv_commit_attempt');
            RAISE EXCEPTION '${marker}' USING DETAIL=NEW."canonicalPayload";
          END IF;
          RETURN NULL;
        END $$`);
      await source.query(`CREATE CONSTRAINT TRIGGER synthetic_csv_commit_failure AFTER INSERT ON account_csv_import_commands
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_csv_commit_failure()`);
      observedStatements.length = 0;
      let failure;
      try { await svc.csv[kind](owner, account, value.uploaded.batchId, input); } catch (error) { failure = error; }
      assert.ok(failure, 'Real storage failure must propagate');
      assert.ok((failure.driverError?.code ?? failure.code) === 'P0001' || failure.getStatus?.() === 500);
      assert.ok(observedStatements.some(sql => /^COMMIT\b/i.test(sql)), 'Failure occurs during actual COMMIT');
      assert.deepEqual((await source.query('SELECT last_value::text AS value,is_called FROM synthetic_csv_commit_attempt'))[0],
        { value: '1', is_called: true }, 'Nontransactional witness observed every required write exactly once');
      assert.equal(await fingerprint(source), before, 'All source-link/version/head/state/command writes rolled back');
    } finally {
      if (installed) {
        try { await source.query('DROP TRIGGER IF EXISTS synthetic_csv_commit_failure ON account_csv_import_commands'); }
        finally {
          try { await source.query('DROP FUNCTION IF EXISTS synthetic_csv_commit_failure()'); }
          finally { await source.query('DROP SEQUENCE synthetic_csv_commit_attempt'); }
        }
      }
    }
    accepted = await svc.csv[kind](owner, account, value.uploaded.batchId, input);
    assert.equal(accepted.created, true); receipt(accepted.value, account, value.uploaded.batchId, input, kind, 2);
    const after = await fingerprint(source);
    assert.deepEqual(await svc.csv[kind](owner, account, value.uploaded.batchId, input), { created: false, value: accepted.value });
    assert.equal(await fingerprint(source), after);
  }
  assert.equal(accepted.value.lastJournalRevision, 4);
  console.log('PASS CSV-003-C / CSV-004-B actual deferred COMMIT rollback of full confirm/rollback, independent complete-write witnesses and explicit retry');
}

async function coherentReads(source, svc, fixture) {
  stage = 'CSV-005-A/B real RR read-only snapshots across concurrent service writes';
  const { owner, instruments: [instrument] } = fixture;
  for (const method of ['preview', 'detail', 'rows']) {
    const account = await newJournal(svc, owner, 'Coherent CSV ' + method);
    const base = await svc.trade.create(owner, account, command(instrument, 0));
    const value = await batch(svc, owner, account, instrument, [execution(instrument, 1,
      { quantity: '0.5', grossUsd: '60' })]);
    if (method !== 'preview') await confirm(svc, owner, value, 1);
    const args = [owner, account, value.uploaded.batchId,
      method === 'preview' ? value.settings : method === 'rows' ? { limit: '1' } : undefined];
    const before = await svc.csv[method](...args);
    const reader = startWorker(), writer = startWorker();
    try {
      const [a, b] = await Promise.all([reader.ready, writer.ready]);
      assert.notEqual(a.process, b.process); assert.notEqual(a.database, b.database);
      reader.go({ service: 'csv', method, args, readBarrier: true });
      await reader.barrier;
      if (method === 'rows') writer.go({ service: 'csv', method: 'rollback',
        args: [owner, account, value.uploaded.batchId, rollbackCommand(2)] });
      else writer.go({ service: 'trade', method: 'correct', args: [owner, account, base.value.trade.tradeId,
        { requestId: randomUUID(), expectedJournalRevision: method === 'preview' ? 1 : 2,
          ...execution(instrument), grossUsd: '120' }] });
      const changed = await writer.finished;
      assert.equal(changed.ok, true); assert.equal(changed.result.created, true);
      reader.release();
      const read = await reader.finished;
      assert.equal(read.ok, true); assert.equal(read.paused, true);
      assert.ok(read.statements.some(sql => /REPEATABLE READ/i.test(sql)));
      assert.ok(read.statements.some(sql => /READ ONLY/i.test(sql)));
      assert.deepEqual(read.result, before, 'One real snapshot retains old status, revision, values, labels and summaries');
      const after = await svc.csv[method](...args);
      if (method === 'rows') {
        assert.equal(after.batchState, 'rolled-back'); assert.equal(before.batchState, 'committed');
        assert.equal(after.items[0].rollbackVersion.version, 2); assert.equal(before.items[0].rollbackVersion, null);
      } else {
        const oldRevision = method === 'preview' ? before.journalRevision : before.rollbackReview.journalRevision;
        const newRevision = method === 'preview' ? after.journalRevision : after.rollbackReview.journalRevision;
        assert.equal(newRevision, oldRevision + 1);
        assert.notDeepEqual(method === 'preview' ? after.candidateSummary : after.rollbackReview.summaryBefore,
          method === 'preview' ? before.candidateSummary : before.rollbackReview.summaryBefore);
      }
    } finally {
      try { reader.release(); }
      finally { await stopWorkers([reader, writer]); }
    }
  }
  console.log('PASS CSV-005-A/B observed real RR/read-only and actual writer commits preserve coherent preview/detail/provenance snapshots');
}

async function sqlIntegrity(source, svc, fixture) {
  stage = 'CSV-001-A / CSV-003-C / CSV-007-A actual byte/state/range/composite PostgreSQL constraints';
  const { owner, other, instruments: [instrument] } = fixture;
  const foreignAccount = await newJournal(svc, other, 'SQL foreign import integrity');
  const account = await newJournal(svc, owner, 'SQL import integrity');
  const value = await batch(svc, owner, account, instrument, [execution(instrument)]);
  const accepted = await confirm(svc, owner, value, 0);
  const provenance = (await svc.csv.rows(owner, account, value.uploaded.batchId)).items[0];
  const foreignTrade = await svc.trade.create(other, foreignAccount, command(fixture.foreignInstrument, 0));
  const another = await batch(svc, owner, account, instrument, [execution(instrument, 1)], 'another source');
  const before = await fingerprint(source);
  const updateImport = (assignment, parameters = []) => runner => runner.query(
    `UPDATE account_csv_imports SET ${assignment} WHERE id=$1`, [value.uploaded.batchId, ...parameters]);
  for (const assignment of ['"byteLength"=0', '"byteLength"=262145', '"byteLength"="byteLength"+1',
    "sha256='not-a-digest'", "filename='../private.csv'", "filename=repeat('a',121)",
    "state='draft'", '"acceptedSettings"=NULL', "\"acceptedSettings\"='[]'::jsonb", "\"createdAt\"='infinity'"])
    await rejectedSql(source, updateImport(assignment), ['23514']);
  await rejectedSql(source, updateImport('"originalBytes"=NULL'), ['23502']);
  await rejectedSql(source, updateImport('"ownerId"=$2', [other]), ['23503']);
  await rejectedSql(source, updateImport('"accountId"=$2', [foreignAccount]), ['23503']);
  const updateCommand = assignment => runner => runner.query(`UPDATE account_csv_import_commands SET ${assignment}
    WHERE "ownerId"=$1 AND "accountId"=$2 AND "requestId"=$3`, [owner, account, accepted.input.requestId]);
  for (const assignment of ["kind='other'", '"rowCount"=0', '"rowCount"=101', '"firstJournalRevision"=0',
    '"lastJournalRevision"=10001', '"lastJournalRevision"="lastJournalRevision"+1', "\"createdAt\"='infinity'"])
    await rejectedSql(source, updateCommand(assignment), ['23514']);
  await rejectedSql(source, updateCommand('"canonicalPayload"=NULL'), ['23502']);
  await rejectedSql(source, runner => runner.query(`INSERT INTO account_csv_import_commands SELECT *
    FROM account_csv_import_commands WHERE "requestId"=$1`, [accepted.input.requestId]), ['23505']);
  const updateRow = (assignment, parameters = []) => runner => runner.query(`UPDATE account_csv_import_rows SET ${assignment}
    WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3`, [owner, account, value.uploaded.batchId, ...parameters]);
  for (const assignment of ['ordinal=0', 'ordinal=101', '"startLine"=1', '"startLine"=262146',
    '"createVersion"=2', '"rollbackVersion"=3']) await rejectedSql(source, updateRow(assignment), ['23514']);
  await rejectedSql(source, updateRow('"tradeId"=NULL'), ['23502']);
  await rejectedSql(source, updateRow('"tradeId"=$4', [foreignTrade.value.trade.tradeId]), ['23503']);
  await rejectedSql(source, updateRow('"rollbackVersion"=2'), ['23503']);
  await rejectedSql(source, runner => runner.query(`INSERT INTO account_csv_import_rows
    ("ownerId","accountId","batchId",ordinal,"startLine","tradeId","createVersion") VALUES($1,$2,$3,1,2,$4,1)`,
    [owner, account, another.uploaded.batchId, provenance.tradeId]), ['23505']);
  for (const [table, predicate, parameters, constraint] of [
    ['account_csv_imports', 'id=$1', [value.uploaded.batchId], 'account_csv_import_commands_ownerId_accountId_batchId_fkey'],
    ['account_trade_versions', '"tradeId"=$1 AND version=1', [provenance.tradeId], 'account_trades_current_version'],
    ['account_trade_journals', '"accountId"=$1', [account], 'account_trades_ownerId_accountId_fkey'],
  ]) {
    stage = `CSV-007-A referenced ${table} deletion RESTRICT refusal`;
    await rejectedSql(source, runner => runner.query(`DELETE FROM ${table} WHERE ${predicate}`, parameters), ['23001'], constraint);
  }
  // Owner binding is transient authentication state, not the parent of retained evidence.
  const runner = source.createQueryRunner();
  try {
    await runner.connect(); await runner.startTransaction();
    await runner.query('DELETE FROM owner_auth WHERE id=1');
    assert.equal((await runner.query('SELECT count(*)::int AS n FROM account_csv_import_rows WHERE "batchId"=$1', [value.uploaded.batchId]))[0].n, 1);
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { await runner.release(); }
  }
  assert.equal(await fingerprint(source), before);
  console.log('PASS CSV-001-A / CSV-003-C / CSV-007-A actual byte/state/range/finite/composite constraints and RESTRICT without owner-binding history coupling');
}

async function seedActive(source, svc, owner, instrument, count) {
  const account = await newJournal(svc, owner, 'Valid active boundary ' + count);
  const first = await svc.trade.create(owner, account, command(instrument, 0, { grossUsd: '1' }));
  const values = Array.from({ length: count - 1 }, (_, index) => {
    const revision = index + 2, tradeId = randomUUID(), requestId = randomUUID();
    return { tradeId, requestId, revision, order: revision - 1,
      payload: JSON.stringify({ kind: 'create', expectedJournalRevision: revision - 1,
        ...execution(instrument, revision - 1, { grossUsd: '1' }) }) };
  });
  await source.transaction(async manager => {
    await manager.query(`INSERT INTO account_trades(id,"ownerId","accountId","currentVersion","createdAt")
      SELECT x."tradeId",$1,$2,1,$4 FROM jsonb_to_recordset($3::jsonb) AS x("tradeId" uuid)`,
    [owner, account, JSON.stringify(values), first.value.trade.createdAt]);
    await manager.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision",
      "requestId","canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,x."tradeId",1,x.revision,x."requestId",x.payload,'create',$4,'buy','2025-01-02T00:00:00Z',x."order",1,1,0,$5
      FROM jsonb_to_recordset($3::jsonb) AS x("tradeId" uuid,"requestId" uuid,revision integer,"order" integer,payload text)`,
    [owner, account, JSON.stringify(values), instrument, first.value.trade.createdAt]);
    await manager.query('UPDATE account_trade_journals SET "currentRevision"=$2 WHERE "accountId"=$1', [account, count]);
  });
  return account;
}
async function seedVersions(source, svc, owner, instrument, count) {
  const account = await newJournal(svc, owner, 'Valid version boundary ' + count);
  const first = await svc.trade.create(owner, account, command(instrument, 0, { grossUsd: '1' }));
  const values = Array.from({ length: count - 1 }, (_, index) => {
    const version = index + 2;
    return { version, requestId: randomUUID(), payload: JSON.stringify({ kind: 'correct', tradeId: first.value.trade.tradeId,
      expectedJournalRevision: version - 1, ...execution(instrument, 0, { grossUsd: '1' }) }) };
  });
  await source.transaction(async manager => {
    await manager.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision",
      "requestId","canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,$3,x.version,x.version,x."requestId",x.payload,'correct',$5,'buy','2025-01-02T00:00:00Z',0,1,1,0,$6
      FROM jsonb_to_recordset($4::jsonb) AS x(version integer,"requestId" uuid,payload text)`,
    [owner, account, first.value.trade.tradeId, JSON.stringify(values), instrument, first.value.trade.createdAt]);
    await manager.query('UPDATE account_trades SET "currentVersion"=$2 WHERE id=$1', [first.value.trade.tradeId, count]);
    await manager.query('UPDATE account_trade_journals SET "currentRevision"=$2 WHERE "accountId"=$1', [account, count]);
  });
  return account;
}

async function capacities(source, svc, fixture) {
  stage = 'CSV-001-B/C / CSV-002-B / CSV-003-C valid complete file and journal boundary seeds';
  const { owner, instruments: [instrument] } = fixture;
  for (const kind of ['active', 'versions']) {
    const start = kind === 'active' ? 998 : 9998;
    const account = await (kind === 'active' ? seedActive : seedVersions)(source, svc, owner, instrument, start);
    const state = (await svc.trade.getJournal(owner, account)).journal;
    assert.equal(state.journalRevision, start); assert.equal(state.versionCount, start);
    assert.equal(state.activeTradeCount, kind === 'active' ? 998 : 1);
    assert.equal(state.summary.remainingCostUsd, kind === 'active' ? '998' : '1');
    const overflow = await batch(svc, owner, account, instrument,
      [1000, 1001, 1002].map(order => execution(instrument, order, { grossUsd: '1' })));
    const before = await fingerprint(source);
    const preview = await svc.csv.preview(owner, account, overflow.uploaded.batchId, overflow.settings);
    assert.equal(preview.canConfirm, false); assert.equal(preview.previewHash, null); assert.equal(preview.candidateSummary, null);
    assert.ok(preview.batchErrors.some(error => error.code === (kind === 'active' ? 'active-trade-cap' : 'version-cap')));
    assert.equal(await fingerprint(source), before);
    const rejected = { requestId: randomUUID(), expectedJournalRevision: start, parserVersion: 'usd-csv-v1',
      ...overflow.settings, previewHash: expectedHash(account, overflow.uploaded, overflow.settings, overflow.expectedRows, start) };
    await unchanged(source, () => svc.csv.confirm(owner, account, overflow.uploaded.batchId, rejected), 409);
    const legal = await batch(svc, owner, account, instrument,
      [1000, 1001].map(order => execution(instrument, order, { grossUsd: '1' })));
    const accepted = await confirm(svc, owner, legal, start);
    const after = (await svc.trade.getJournal(owner, account)).journal;
    assert.equal(after.journalRevision, start + 2); assert.equal(after.versionCount, start + 2);
    assert.equal(after.activeTradeCount, kind === 'active' ? 1000 : 3);
    assert.equal(after.summary.remainingCostUsd, kind === 'active' ? '1000' : '3');
    const atCap = await fingerprint(source);
    assert.deepEqual(await svc.csv.confirm(owner, account, legal.uploaded.batchId, accepted.input), { created: false, value: accepted.value });
    assert.equal(await fingerprint(source), atCap);
    if (kind === 'versions') {
      const review = (await svc.csv.detail(owner, account, legal.uploaded.batchId)).rollbackReview;
      assert.equal(review.reason, 'version-cap'); assert.equal(review.additionalVersionCount, 2);
      await unchanged(source, () => svc.csv.rollback(owner, account, legal.uploaded.batchId, rollbackCommand(10000)), 409);
    }
  }

  const hundredAccount = await newJournal(svc, owner, 'Exact hundred-row batch');
  const hundred = await batch(svc, owner, hundredAccount, instrument,
    Array.from({ length: 100 }, (_, order) => execution(instrument, order, { grossUsd: '1' })));
  const accepted = await confirm(svc, owner, hundred, 0);
  assert.equal(accepted.value.rowCount, 100); assert.equal(accepted.value.lastJournalRevision, 100);
  const hundredRows = await svc.csv.rows(owner, hundredAccount, hundred.uploaded.batchId, { limit: '100' });
  assert.deepEqual(hundredRows.items.map(row => row.ordinal), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(hundredRows.nextAfterOrdinal, null);

  const quotaAccount = await newJournal(svc, owner, 'Retained files across all states');
  const rolled = await batch(svc, owner, quotaAccount, instrument, [execution(instrument)]);
  await confirm(svc, owner, rolled, 0);
  await svc.csv.rollback(owner, quotaAccount, rolled.uploaded.batchId, rollbackCommand(1));
  const committed = await batch(svc, owner, quotaAccount, instrument, [execution(instrument, 1)]);
  await confirm(svc, owner, committed, 2);
  // Explicit isolated fixture seed:255 unique bounded valid originals, including
  // one real rolled-back and one real committed batch. No fake economic history.
  const sources = Array.from({ length: 253 }, (_, index) => {
    const bytes = sourceFile([execution(instrument, index + 10)], 'quota draft ' + index);
    return { id: randomUUID(), sha256: digest(bytes), hex: bytes.toString('hex'), byteLength: bytes.length,
      filename: 'Synthetic quota ' + index + '.csv' };
  });
  await source.query(`INSERT INTO account_csv_imports(id,"ownerId","accountId",sha256,"originalBytes","byteLength",filename,state,"acceptedSettings","createdAt")
    SELECT x.id,$1,$2,x.sha256,decode(x.hex,'hex'),x."byteLength",x.filename,'draft',NULL,$4::timestamptz
    FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,sha256 text,hex text,"byteLength" integer,filename text)`,
  [owner, quotaAccount, JSON.stringify(sources), rolled.uploaded.createdAt]);
  const candidateSources = ['last-slot-A', 'last-slot-B'].map(note => sourceFile([execution(instrument, 300)], note));
  const outcomes = await processRace(source, quotaAccount, candidateSources.map((bytes, index) => ({ service: 'csv', method: 'upload',
    args: [owner, quotaAccount, { filename: 'Last slot ' + index + '.csv', bytes }] })));
  assert.equal(outcomes.filter(result => result.ok && result.result.created).length, 1);
  assert.equal(outcomes.filter(result => !result.ok && result.status === 409).length, 1);
  const [totals] = await source.query(`SELECT count(*)::int AS count,sum("byteLength")::text AS bytes,
    count(*) FILTER(WHERE state='draft')::int AS drafts,
    count(*) FILTER(WHERE state='committed')::int AS committed,
    count(*) FILTER(WHERE state='rolled-back')::int AS rolled
    FROM account_csv_imports WHERE "accountId"=$1`, [quotaAccount]);
  assert.equal(totals.count, 256); assert.equal(totals.drafts, 254); assert.equal(totals.committed, 1); assert.equal(totals.rolled, 1);
  assert.ok(BigInt(totals.bytes) <= 67108864n);
  const capBefore = await fingerprint(source);
  assert.deepEqual(await svc.csv.upload(owner, quotaAccount, { filename: 'Repeat.csv', bytes: rolled.bytes }),
    { created: false, value: rolled.uploaded });
  assert.equal(await fingerprint(source), capBefore);
  const loser = candidateSources[outcomes.findIndex(result => !result.ok)];
  await unchanged(source, () => svc.csv.upload(owner, quotaAccount, { filename: 'No extra slot.csv', bytes: loser }), 409);
  const independentAccount = await newJournal(svc, owner, 'Separate file namespace');
  assert.equal((await svc.csv.upload(owner, independentAccount, { filename: 'Same bytes.csv', bytes: rolled.bytes })).created, true);

  // Valid262144-byte CSV:32 bounded fields per row; trim only trusted filler to
  // reach the raw-byte boundary, never ask the parser to truncate an input.
  const header = Array.from({ length: 32 }, (_, index) => 'h' + index).join(',');
  const first = Array.from({ length: 32 }, () => 'a'.repeat(4096));
  const second = [...first];
  const encode = () => Buffer.from([header, first.join(','), second.join(',')].join('\r\n') + '\r\n');
  const excess = encode().length - 262144;
  assert.ok(excess > 0 && excess < 4096);
  second[31] = second[31].slice(0, -excess);
  const maximumBytes = encode(); assert.equal(maximumBytes.length, 262144);
  const maximum = await svc.csv.upload(owner, independentAccount, { filename: 'Maximum.csv', bytes: maximumBytes });
  const inspection = await svc.csv.inspect(owner, independentAccount, maximum.value.batchId, { delimiter: ',' });
  assert.equal(inspection.valid, true); assert.equal(inspection.headers.length, 32); assert.equal(inspection.rows.length, 2);
  assert.equal(Buffer.byteLength(inspection.rows[0].cells[0]), 4096);
  assert.equal((await source.query('SELECT encode("originalBytes",\'hex\') AS bytes FROM account_csv_imports WHERE id=$1',
    [maximum.value.batchId]))[0].bytes, maximumBytes.toString('hex'));
  console.log('PASS CSV-001-B/C / CSV-002-B / CSV-003-C complete valid100-row/1000-active/10000-version and256-file boundaries, last-slot race and replay at caps');
}

async function main() {
  sentinel();
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Refuse existing fixture databases; never reuse or drop owner data');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(migrated.error, undefined); assert.equal(migrated.signal, null); assert.equal(migrated.status, 0);
  const source = productionSource(observedStatements); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const migrations = await source.query('SELECT name FROM migrations ORDER BY timestamp');
    assert.equal(migrations.length, 31); assert.equal(migrations[14].name, 'AddUsdCsvImports1790050000000');
    assert.equal(migrations[15].name, 'AddKnownCostCarryIn1790060000000');
    assert.equal(migrations[16].name, 'AddExternalUsdFlows1790070000000');
    assert.equal(migrations[17].name, 'AddManualUsdPrices1790080000000');
    assert.equal(migrations[18].name, 'AddDailyDisplayFx1790090000000');
    assert.equal(migrations[19].name, 'AddOwnedTransfers1790100000000');
    for (const table of csvTables) assert.deepEqual(await rows(source, table), []);
    const svc = services(source);
    const fixture = await seed(source, svc);
    const legacy = await fingerprint(source, true);
    const retained = new Map();
    for (const table of [...accountingTables, ...tradeTables]) retained.set(table, await rows(source, table));
    const preserve = async () => {
      assert.equal(await fingerprint(source, true), legacy,
        'Seeded prior financial/users/owner-binding/admission and migration rows remain exact');
      for (const [table, previous] of retained) {
        const current = new Set((await rows(source, table)).map(value => value.row));
        for (const value of previous) assert.ok(current.has(value.row), 'Every preexisting manual/USD row remains byte-exact');
      }
    };
    for (const run of [originals, wholeBatch, historicalReceipt, rollbackHistory, races, deferredCommit, coherentReads, sqlIntegrity, capacities]) {
      await run(source, svc, fixture);
      await preserve();
    }
    console.log('PASS isolated CSV production-service/PG acceptance; populated upgrade and actual session/MFA HTTP evidence remain separate gates');
  } finally { await source.destroy(); }
}

const watchdog = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded isolated CSV fixture at stage: ${stage}`);
  process.exit(1);
}, 180000);
watchdog.unref();
(process.argv[2] === '--worker' ? workerMain() : main()).catch(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL isolated CSV database acceptance at stage: ${stage} (private assertion details withheld)`);
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
