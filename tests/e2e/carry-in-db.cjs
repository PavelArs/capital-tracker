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
const database = 'capital_tracker_carry_in_e2e';
const csvTables = ['account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
const accountingTables = ['manual_accounts', 'accounting_instruments',
  'account_opening_snapshots', 'account_opening_positions'];
const lotTable = 'account_carry_in_lots';
const mutableTables = [...csvTables, ...tradeTables, ...accountingTables, lotTable];
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
  const { CarryInService } = require('/app/backend/dist/accounting/carry-in.service.js');
  return { accounting: new AccountingService(source), trade: new TradeService(source),
    csv: new CsvImportService(source), carry: new CarryInService(source) };
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
      service === 'trade' ? ['create', 'correct', 'getJournal', 'listLots'] :
      service === 'carry' ? ['initialize', 'state', 'preview', 'listLots'] :
      service === 'accounting' ? ['saveOpening'] : [];
    assert.ok(allowed.includes(method));
    statements.length = 0;
    let paused = false;
    if (readBarrier) {
      const { readSync, writeSync } = require('node:fs');
      const capture = source.logger.logQuery;
      source.logger.logQuery = query => {
        if (!paused && /^\s*SELECT\b/i.test(query) && /accounting_instruments|account_trade_versions|account_carry_in_lots/i.test(query)) {
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
    const error = new Error('Isolated carry-in worker failed (private details withheld)');
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

const lot = (instrumentId, order = 0, changes = {}) => ({ instrumentId,
  acquiredAt: '2024-12-31T00:00:00.000Z', orderWithinTimestamp: order,
  originalQuantity: '1', originalCostUsd: '100', remainingQuantity: '1', ...changes });
const init = (lots, changes = {}) => ({ requestId: randomUUID(), expectedOpeningRevision: 1,
  lots, assertReviewed: true, ...changes });
const execution = (instrumentId, order = 0, changes = {}) => ({ instrumentId, side: 'sell',
  occurredAt: '2025-01-02T00:00:00.000Z', orderWithinTimestamp: order,
  quantity: '1.5', grossUsd: '450', feeUsd: '0', ...changes });
const tradeCommand = (instrumentId, revision = 0, changes = {}) => ({ requestId: randomUUID(),
  expectedJournalRevision: revision, ...execution(instrumentId, revision, changes) });
const previewInput = command => ({ expectedOpeningRevision: command.expectedOpeningRevision, lots: command.lots });
const canonical = command => JSON.stringify(['ct-known-cost-carry-in-v1', command.expectedOpeningRevision,
  true, [...command.lots].sort((a,b) => a.acquiredAt.localeCompare(b.acquiredAt) || a.orderWithinTimestamp-b.orderWithinTimestamp)
    .map(l => [l.instrumentId,l.acquiredAt,l.orderWithinTimestamp,l.originalQuantity,l.originalCostUsd,l.remainingQuantity])]);

async function unchanged(source, action, expected) {
  const before = await fingerprint(source);
  await status(action, expected);
  assert.equal(await fingerprint(source), before, 'Refusal preserves every row and does not reserve a key');
}
async function newAccount(svc, owner, name) {
  return (await svc.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
}
async function openingAccount(svc, owner, instrument, name, quantity = '2', cost = '300') {
  const account = await newAccount(svc, owner, name);
  const input = { requestId: randomUUID(), expectedRevision: 0, asOf: coverageFrom,
    positions: [{ instrumentId: instrument, quantity, costStatus: cost === null ? 'unknown' : 'known', totalCostUsd: cost }] };
  const saved = await svc.accounting.saveOpening(owner, account, input);
  assert.equal(saved.created, true);
  return { account, input, opening: saved.value };
}
async function initializedAccount(svc, owner, instrument, name) {
  const value = await openingAccount(svc, owner, instrument, name);
  const input = init([lot(instrument), lot(instrument, 1, { originalCostUsd: '200' })]);
  const saved = await svc.carry.initialize(owner, value.account, input);
  assert.equal(saved.created, true);
  return { ...value, command: input, receipt: saved.value };
}
function originReceipt(value, account, command, cost = '300') {
  assert.deepEqual(Object.keys(value).sort(), ['accountId','requestId','originKind','coverageFrom',
    'openingRevision','lotCount','carryInCostUsd','createdAt'].sort());
  assert.deepEqual({ ...value, createdAt: undefined }, { accountId: account, requestId: command.requestId,
    originKind: 'known-cost-carry-in', coverageFrom, openingRevision: command.expectedOpeningRevision,
    lotCount: command.lots.length, carryInCostUsd: cost, createdAt: undefined });
  assert.equal(new Date(value.createdAt).toISOString(), value.createdAt);
}
async function journal(svc, owner, account) { return (await svc.trade.getJournal(owner, account)).journal; }
async function csvBatch(svc, owner, account, instrument, trades) {
  const bytes = Buffer.from('\uFEFFinstrument,side,time,order,quantity,gross,fee\r\n' +
    trades.map(t => ['TOKEN', t.side, t.occurredAt, t.orderWithinTimestamp, t.quantity, t.grossUsd, t.feeUsd].join(',')).join('\r\n') + '\r\n');
  const uploaded = await svc.csv.upload(owner, account, { filename: 'Сохранённые исходные сделки.csv', bytes });
  const settings = { format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: { columns: { instrument: 0, side: 1, occurredAt: 2, order: 3, quantity: 4, grossUsd: 5, feeUsd: 6 },
      instruments: [{ source: 'TOKEN', instrumentId: instrument }],
      sides: [...new Set(trades.map(t => t.side))].sort().map(side => ({ source: side, side })) }, assertUsd: true };
  assert.equal(uploaded.created, true);
  assert.equal(uploaded.value.sha256, createHash('sha256').update(bytes).digest('hex'));
  return { bytes, identity: uploaded.value, settings };
}
async function csvConfirm(svc, owner, account, batch, revision) {
  const preview = await svc.csv.preview(owner, account, batch.identity.batchId, batch.settings);
  assert.equal(preview.canConfirm, true); assert.equal(preview.journalRevision, revision);
  const input = { requestId: randomUUID(), expectedJournalRevision: revision, parserVersion: 'usd-csv-v1',
    ...batch.settings, previewHash: preview.previewHash };
  const saved = await svc.csv.confirm(owner, account, batch.identity.batchId, input);
  assert.equal(saved.created, true);
  return { input, saved: saved.value };
}

async function seed(source, svc) {
  const users = [];
  for (const email of ['carry-owner@example.invalid','carry-other@example.invalid']) {
    const [user] = await source.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES($1,'synthetic-direct-service-not-a-login-hash',true) RETURNING id`, [email]);
    users.push(user.id);
    await source.query(`INSERT INTO crypto_wallets("userId",type,address,balance)
      VALUES($1,'bitcoin',$2,'1.250000000000000001')`, [user.id, 'synthetic-' + email]);
    await source.query(`INSERT INTO assets("userId",name,category,amount,"currencyId",date)
      SELECT $1,'Preserved synthetic finance','savings','123.45',id,'2026-01-01' FROM currencies WHERE code='USD'`, [user.id]);
  }
  const [owner, other] = users;
  await source.query('INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)', [owner,randomUUID()]);
  const { AuthRequestLimitsService } = require('/app/backend/dist/auth/request-limits.service.js');
  await new AuthRequestLimitsService(source).admit('login-account', 'carry-owner@example.invalid');
  const instruments = [];
  for (let i=0;i<2;i++) instruments.push((await svc.accounting.createInstrument(owner,
    { requestId: randomUUID(), name: `Literal <b>carry ${i}</b>`, symbol: 'SAME' })).value.id);
  const foreignInstrument = (await svc.accounting.createInstrument(other,
    { requestId: randomUUID(), name: 'Foreign carry evidence', symbol: 'SAME' })).value.id;
  const foreign = await openingAccount(svc, other, foreignInstrument, 'Preserved foreign opening');
  const retainedAccounts = [foreign.account];
  for (const rolledBack of [false,true]) {
    const account = await newAccount(svc, owner, `Preserved CSV ${rolledBack}`);
    retainedAccounts.push(account);
    await svc.trade.initialize(owner, account, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
    const batch = await csvBatch(svc, owner, account, instruments[0], [execution(instruments[0], 0,
      { side:'buy',quantity:'1',grossUsd:'100' })]);
    await csvConfirm(svc, owner, account, batch, 0);
    if (rolledBack) await svc.csv.rollback(owner, account, batch.identity.batchId,
      { requestId: randomUUID(), expectedJournalRevision: 1 });
  }
  return { owner, other, instruments, foreignInstrument, foreignAccount: foreign.account, retainedAccounts };
}

async function discoveryAndReconciliation(source, svc, f) {
  stage = 'CARRY-001-B / CARRY-002-B discovery, exact reconciliation, owner and raw boundaries';
  const { owner, other, instruments:[instrument, extra], foreignInstrument, foreignAccount } = f;
  const value = await openingAccount(svc, owner, instrument, 'Exact opening evidence');
  const input = init([lot(instrument),lot(instrument,1,{originalCostUsd:'200'})]);
  assert.deepEqual(await svc.trade.getJournal(owner,value.account), { accountId:value.account,
    eligible:false,ineligibilityReason:'opening-history',journal:null });
  assert.deepEqual(await svc.carry.state(owner,value.account), { accountId:value.account,
    eligible:true,ineligibilityReason:null,opening:value.opening,origin:null });
  const empty = await newAccount(svc,owner,'No implicit origin');
  assert.deepEqual(await svc.carry.state(owner,empty), { accountId:empty,eligible:false,
    ineligibilityReason:'no-current-opening',opening:null,origin:null });
  await unchanged(source,()=>svc.carry.initialize(owner,empty,input),409);
  const unknown = await openingAccount(svc,owner,instrument,'Unknown is not zero','2',null);
  assert.equal((await svc.carry.state(owner,unknown.account)).ineligibilityReason,'unknown-cost');
  await unchanged(source,()=>svc.carry.preview(owner,unknown.account,previewInput(input)),409);
  await unchanged(source,()=>svc.carry.initialize(owner,unknown.account,input),409);
  for (const raw of [{...input,expectedOpeningRevision:'1'},{...input,assertReviewed:'true'},
    {...input,ownerId:owner},{...input,lots:[{...input.lots[0],originalQuantity:{toString:'2'}}]},
    {...input,lots:[lot(instrument),lot(instrument)]}]) {
    await unchanged(source,()=>svc.carry.initialize(owner,value.account,raw),400);
  }
  await unchanged(source,()=>svc.carry.initialize(owner,value.account,{...input,expectedOpeningRevision:2}),409);
  for (const method of ['state','listLots']) {
    await unchanged(source,()=>svc.carry[method](owner,foreignAccount),404);
    await unchanged(source,()=>svc.carry[method](other,value.account),404);
  }
  for (const method of ['preview','initialize']) {
    await unchanged(source,()=>svc.carry[method](owner,foreignAccount,method==='preview'?previewInput(input):input),404);
    const foreign = {...input,lots:[lot(foreignInstrument)]};
    await unchanged(source,()=>svc.carry[method](owner,value.account,method==='preview'?previewInput(foreign):foreign),404);
  }
  const before = await fingerprint(source);
  const valid = await svc.carry.preview(owner,value.account,previewInput(input));
  assert.equal(valid.canInitialize,true); assert.deepEqual(valid.issues,[]);
  assert.equal(valid.carryInCostUsd,'300');
  assert.deepEqual(valid.reconciliation.map(({instrumentName,instrumentSymbol,...r})=>r), [{
    instrumentId:instrument,openingQuantity:'2',openingCostUsd:'300',carriedQuantity:'2',carriedCostUsd:'300'}]);
  const mismatches = [
    [ [lot(instrument),lot(instrument,1,{originalCostUsd:'200.000000000000000000000000000001'})],
      [{code:'cost-mismatch',instrumentId:instrument,ordinal:null}] ],
    [ [lot(instrument),lot(instrument,1,{originalQuantity:'1.000000000000000000000000000001',remainingQuantity:'1.000000000000000000000000000001',originalCostUsd:'200'})],
      [{code:'quantity-mismatch',instrumentId:instrument,ordinal:null}] ],
    [ [lot(extra,0,{originalQuantity:'2',remainingQuantity:'2',originalCostUsd:'300'})],
      [{code:'extra-instrument',instrumentId:extra,ordinal:null},{code:'missing-instrument',instrumentId:instrument,ordinal:null}] ],
    [ [lot(instrument),lot(instrument,1,{originalCostUsd:'200',acquiredAt:'2025-01-01T00:00:00.001Z'})],
      [{code:'acquisition-after-coverage',instrumentId:null,ordinal:2}] ],
  ];
  for (const [lots,issues] of mismatches) {
    const preview = await svc.carry.preview(owner,value.account,{expectedOpeningRevision:1,lots});
    assert.equal(preview.canInitialize,false); assert.deepEqual(preview.issues,issues);
    await status(()=>svc.carry.initialize(owner,value.account,init(lots)),409);
  }
  assert.equal(await fingerprint(source),before,'Every preview and rejected reconciliation is read-only');
  await source.query('UPDATE manual_accounts SET "currentRevision"=NULL WHERE id=$1',[value.account]);
  try {
    assert.equal((await svc.carry.state(owner,value.account)).ineligibilityReason,'no-current-opening');
    await unchanged(source,()=>svc.carry.initialize(owner,value.account,input),409);
    await unchanged(source,()=>svc.trade.initialize(owner,value.account,{requestId:randomUUID(),coverageFrom,assertEmpty:true}),409);
  } finally { await source.query('UPDATE manual_accounts SET "currentRevision"=1 WHERE id=$1',[value.account]); }
  const accepted = await svc.carry.initialize(owner,value.account,input);
  assert.equal(accepted.created,true); originReceipt(accepted.value,value.account,input);
  assert.equal((await source.query('SELECT "canonicalPayload" FROM account_trade_journals WHERE "accountId"=$1',[value.account]))[0].canonicalPayload,canonical(input));
  console.log('PASS CARRY-001-B / CARRY-002-B exact preview issues, known/unknown eligibility, raw/foreign refusal and preserved prior opening');
}

async function allocationAndReplay(source, svc, f) {
  stage = 'CARRY-002-A / CARRY-003-A original allocation phase and immutable replay';
  const { owner,instruments:[instrument,second] } = f;
  const value = await openingAccount(svc,owner,instrument,'Original allocation phase','3','0.000000000000000000000000000002');
  const input = init([lot(instrument,0,{originalQuantity:'4',remainingQuantity:'3',originalCostUsd:'0.000000000000000000000000000002',acquiredAt:coverageFrom})]);
  const saved = await svc.carry.initialize(owner,value.account,input);
  originReceipt(saved.value,value.account,input,'0.000000000000000000000000000002');
  const evidence = await svc.carry.listLots(owner,value.account);
  assert.equal(evidence.items.length,1);
  assert.equal(evidence.items[0].priorDisposedQuantity,'1');
  assert.equal(evidence.items[0].priorAllocatedCostUsd,'0');
  assert.equal(evidence.items[0].carriedCostUsd,'0.000000000000000000000000000002');
  const costs = ['0.000000000000000000000000000001','0','0.000000000000000000000000000001'];
  for (let index=0;index<3;index++) {
    // The first execution has exactly the baseline acquisition timestamp/order.
    const sale = await svc.trade.create(owner,value.account,tradeCommand(instrument,index,
      {quantity:'1',grossUsd:'1',occurredAt:coverageFrom,orderWithinTimestamp:index}));
    assert.equal(sale.value.journalRevision,index+1);
    const matches = await svc.trade.listMatches(owner,value.account,sale.value.trade.tradeId);
    assert.deepEqual(matches.items,[{ sourceKind:'carry-in',sellTradeId:sale.value.trade.tradeId,
      sellVersion:1,lotId:evidence.items[0].lotId,openingRevision:1,ordinal:1,quantity:'1',costUsd:costs[index] }]);
  }
  const state = await journal(svc,owner,value.account);
  assert.equal(state.versionCount,3); assert.equal(state.activeTradeCount,3);
  assert.deepEqual(state.summary,{...zeros,grossSalesUsd:'3',netSalesUsd:'3',
    consumedCostUsd:'0.000000000000000000000000000002',realizedUsd:'2.999999999999999999999999999998'});
  assert.deepEqual((await svc.trade.listLots(owner,value.account)).items,[]);
  assert.deepEqual(await svc.carry.listLots(owner,value.account),evidence,'Exhausted lots remain immutable provenance');
  await unchanged(source,()=>svc.carry.initialize(owner,value.account,{...input,lots:[{...input.lots[0],originalQuantity:'3'}]}),409);
  const before = await fingerprint(source);
  const equivalent = {...input,requestId:input.requestId.toUpperCase(),lots:[{...input.lots[0],
    instrumentId:instrument.toUpperCase(),acquiredAt:'2025-01-01T03:00:00+03:00',originalQuantity:'04.00',remainingQuantity:'03.0'}]};
  assert.deepEqual(await svc.carry.initialize(owner,value.account.toUpperCase(),equivalent),{created:false,value:saved.value});
  assert.deepEqual(await svc.accounting.saveOpening(owner,value.account,value.input),{created:false,value:value.opening});
  assert.equal(await fingerprint(source),before);
  await source.query('UPDATE manual_accounts SET "currentRevision"=NULL WHERE id=$1',[value.account]);
  try {
    const altered = await fingerprint(source);
    assert.deepEqual(await svc.carry.initialize(owner,value.account,equivalent),{created:false,value:saved.value});
    assert.deepEqual((await svc.carry.state(owner,value.account)).opening,value.opening,'Pinned evidence ignores a moving pointer');
    assert.equal(await fingerprint(source),altered);
  } finally { await source.query('UPDATE manual_accounts SET "currentRevision"=1 WHERE id=$1',[value.account]); }
  await unchanged(source,()=>svc.carry.initialize(owner,value.account,init(input.lots)),409);
  await unchanged(source,()=>svc.accounting.saveOpening(owner,value.account,{...value.input,requestId:randomUUID(),expectedRevision:1}),409);
  await unchanged(source,()=>svc.trade.initialize(owner,value.account,{requestId:input.requestId,coverageFrom,assertEmpty:true}),409);

  const zero = await openingAccount(svc,owner,second,'Known zero is evidence','1','0');
  const zeroInput = init([lot(second,0,{originalCostUsd:'0'})]);
  await svc.carry.initialize(owner,zero.account,zeroInput);
  const zeroSale = await svc.trade.create(owner,zero.account,tradeCommand(second,0,{quantity:'1',grossUsd:'1'}));
  assert.deepEqual((await journal(svc,owner,zero.account)).summary,{...zeros,grossSalesUsd:'1',netSalesUsd:'1',realizedUsd:'1'});
  assert.equal((await svc.trade.listMatches(owner,zero.account,zeroSale.value.trade.tradeId)).items[0].costUsd,'0');
  console.log('PASS CARRY-002-A / CARRY-003-A actual original-phase[1,0,1], exact zero, boundary-time sale, exhaustion and replay before live pointer checks');
}

async function manualAndCsv(source, svc, f) {
  stage = 'CARRY-001-A / CARRY-004-A same seeded manual and CSV calculations';
  const {owner,instruments:[instrument]} = f;
  const expected = {...zeros,grossSalesUsd:'450',netSalesUsd:'450',consumedCostUsd:'200',realizedUsd:'250',remainingCostUsd:'100'};
  const manual = await initializedAccount(svc,owner,instrument,'Manual covered sale');
  const original = await svc.carry.listLots(owner,manual.account);
  const saleInput = tradeCommand(instrument);
  const sale = await svc.trade.create(owner,manual.account,saleInput);
  assert.deepEqual((await journal(svc,owner,manual.account)).summary,expected);
  const matches = (await svc.trade.listMatches(owner,manual.account,sale.value.trade.tradeId)).items;
  assert.deepEqual(matches.map(({lotId,sellTradeId,...m})=>m), [
    {sourceKind:'carry-in',sellVersion:1,openingRevision:1,ordinal:1,quantity:'1',costUsd:'100'},
    {sourceKind:'carry-in',sellVersion:1,openingRevision:1,ordinal:2,quantity:'0.5',costUsd:'100'}]);
  assert.deepEqual(matches.map(m=>m.lotId),original.items.map(l=>l.lotId));
  const correction = await svc.trade.correct(owner,manual.account,sale.value.trade.tradeId,
    {...saleInput,requestId:randomUUID(),expectedJournalRevision:1,grossUsd:'430'});
  assert.equal(correction.value.trade.version,2);
  assert.deepEqual((await journal(svc,owner,manual.account)).summary,
    {...expected,grossSalesUsd:'430',netSalesUsd:'430',realizedUsd:'230'});
  assert.deepEqual(await svc.carry.listLots(owner,manual.account),original);
  assert.equal((await svc.trade.listVersions(owner,manual.account,sale.value.trade.tradeId)).items.length,2);

  const imported = await initializedAccount(svc,owner,instrument,'CSV covered sale');
  const importedEvidence = await svc.carry.listLots(owner,imported.account);
  const batch = await csvBatch(svc,owner,imported.account,instrument,[execution(instrument)]);
  const beforePreview = await fingerprint(source);
  const preview = await svc.csv.preview(owner,imported.account,batch.identity.batchId,batch.settings);
  assert.equal(preview.canConfirm,true); assert.equal(preview.journalRevision,0);
  assert.deepEqual(preview.summaryBefore,{...zeros,remainingCostUsd:'300'});
  assert.deepEqual(preview.candidateSummary,expected);
  assert.equal(await fingerprint(source),beforePreview,'Preview never writes a provisional baseline or trade');
  const confirmed = await csvConfirm(svc,owner,imported.account,batch,0);
  assert.equal(confirmed.saved.firstJournalRevision,1); assert.equal(confirmed.saved.lastJournalRevision,1);
  assert.deepEqual((await journal(svc,owner,imported.account)).summary,expected);
  const detail = await svc.csv.detail(owner,imported.account,batch.identity.batchId);
  assert.equal(detail.rollbackReview.eligible,true);
  assert.deepEqual(detail.rollbackReview.summaryBefore,expected);
  assert.deepEqual(detail.rollbackReview.summaryAfter,{...zeros,remainingCostUsd:'300'});
  const rollback = {requestId:randomUUID(),expectedJournalRevision:1};
  const rolled = await svc.csv.rollback(owner,imported.account,batch.identity.batchId,rollback);
  assert.equal(rolled.created,true); assert.equal(rolled.value.lastJournalRevision,2);
  const afterRollback = await journal(svc,owner,imported.account);
  assert.deepEqual(afterRollback.summary,{...zeros,remainingCostUsd:'300'});
  assert.equal(afterRollback.activeTradeCount,0); assert.equal(afterRollback.versionCount,2);
  assert.deepEqual(await svc.carry.listLots(owner,imported.account),importedEvidence);
  const links = await svc.csv.rows(owner,imported.account,batch.identity.batchId);
  assert.equal(links.batchState,'rolled-back'); assert.equal(links.items.length,1);
  assert.equal(links.items[0].createVersion.version,1); assert.equal(links.items[0].rollbackVersion.version,2);
  const [stored] = await source.query('SELECT encode("originalBytes",\'hex\') AS bytes FROM account_csv_imports WHERE id=$1',[batch.identity.batchId]);
  assert.equal(stored.bytes,batch.bytes.toString('hex'));
  const beforeReplay = await fingerprint(source);
  assert.deepEqual(await svc.csv.confirm(owner,imported.account,batch.identity.batchId,confirmed.input),{created:false,value:confirmed.saved});
  assert.deepEqual(await svc.csv.rollback(owner,imported.account,batch.identity.batchId,rollback),{created:false,value:rolled.value});
  assert.deepEqual(await svc.carry.initialize(owner,imported.account,imported.command),{created:false,value:imported.receipt});
  assert.deepEqual(await svc.accounting.saveOpening(owner,imported.account,imported.input),{created:false,value:imported.opening});
  assert.equal(await fingerprint(source),beforeReplay);
  await unchanged(source,()=>svc.accounting.saveOpening(owner,imported.account,{...imported.input,requestId:randomUUID(),expectedRevision:1}),409);
  console.log('PASS CARRY-001-A / CARRY-004-A manual and imported250/100, covered correction230, whole rollback to baseline and immutable original/provenance/replay');
}

async function races(source, svc, f) {
  stage = 'CARRY-003-A real process account locks, same-key, conflicting-key and opening races';
  const {owner,instruments:[instrument]} = f;
  for (const identical of [true,false]) {
    const value = await openingAccount(svc,owner,instrument,`Concurrent initialization ${identical}`);
    const input = init([lot(instrument),lot(instrument,1,{originalCostUsd:'200'})]);
    const second = identical ? input : {...input,requestId:randomUUID()};
    const result = await processRace(source,value.account,[input,second].map(command=>({service:'carry',method:'initialize',args:[owner,value.account,command]})));
    assert.equal(result.filter(r=>r.ok && r.result.created).length,1);
    if (identical) {
      assert.equal(result.filter(r=>r.ok && !r.result.created).length,1);
      assert.deepEqual(result[0].result.value,result[1].result.value);
    } else {
      assert.equal(result.filter(r=>!r.ok && r.status===409).length,1);
      const loser = result[0].ok ? second : input;
      assert.equal((await source.query('SELECT 1 FROM account_trade_journals WHERE "accountId"=$1 AND "requestId"=$2',[value.account,loser.requestId])).length,0);
    }
    assert.equal((await svc.carry.listLots(owner,value.account)).items.length,2);
  }
  const value = await openingAccount(svc,owner,instrument,'Opening replacement versus initialization');
  const input = init([lot(instrument),lot(instrument,1,{originalCostUsd:'200'})]);
  const replacement = {...value.input,requestId:randomUUID(),expectedRevision:1};
  const results = await processRace(source,value.account,[
    {service:'carry',method:'initialize',args:[owner,value.account,input]},
    {service:'accounting',method:'saveOpening',args:[owner,value.account,replacement]},
  ]);
  assert.equal(results.filter(r=>r.ok && r.result.created).length,1);
  assert.equal(results.filter(r=>!r.ok && r.status===409).length,1);
  const pointer = (await source.query('SELECT "currentRevision" FROM manual_accounts WHERE id=$1',[value.account]))[0].currentRevision;
  assert.equal(pointer,results[0].ok?1:2);
  if (!results[0].ok) {
    const retried = await svc.carry.initialize(owner,value.account,{...input,expectedOpeningRevision:2});
    assert.equal(retried.created,true,'The rejected original key was not consumed by a stale opening');
  }
  const one = await openingAccount(svc,owner,instrument,'Competing covered sales','1','100');
  await svc.carry.initialize(owner,one.account,init([lot(instrument)]));
  const sales = [0,1].map(order=>tradeCommand(instrument,0,{quantity:'1',grossUsd:String(200+order),orderWithinTimestamp:order}));
  const sold = await processRace(source,one.account,sales.map(command=>({service:'trade',method:'create',args:[owner,one.account,command]})));
  assert.equal(sold.filter(r=>r.ok).length,1); assert.equal(sold.filter(r=>r.status===409).length,1);
  const winner = sold.find(r=>r.ok).result;
  assert.equal((await journal(svc,owner,one.account)).summary.remainingCostUsd,'0');
  assert.equal((await svc.trade.listMatches(owner,one.account,winner.value.trade.tradeId)).items[0].quantity,'1');
  assert.equal((await svc.trade.listLots(owner,one.account)).items.length,0);
  console.log('PASS CARRY-003-A observed independent account-lock waits, once-only origin, opening CAS and distinct-chronology covered-sale conservation');
}

async function deferredCommit(source, svc, f) {
  stage = 'CARRY-003-B actual deferred COMMIT after complete baseline writes';
  const {owner,instruments:[instrument]} = f;
  const value = await openingAccount(svc,owner,instrument,'Deferred complete carry-in commit');
  const input = init([lot(instrument),lot(instrument,1,{originalCostUsd:'200'})]);
  const before = await fingerprint(source);
  let installed = false;
  try {
    await source.query('CREATE SEQUENCE synthetic_carry_commit_attempt START 1'); installed=true;
    await source.query(`CREATE FUNCTION synthetic_carry_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."requestId"='${input.requestId}'::uuid THEN
          IF NEW."originKind"<>'known-cost-carry-in' OR NEW."openingRevision"<>1 OR NEW."currentRevision"<>0
            OR (SELECT count(*) FROM account_carry_in_lots WHERE "ownerId"=NEW."ownerId" AND "accountId"=NEW."accountId" AND "openingRevision"=1)<>2
            OR (SELECT sum("remainingQuantity") FROM account_carry_in_lots WHERE "accountId"=NEW."accountId")<>2
            OR (SELECT sum("originalCostUsd") FROM account_carry_in_lots WHERE "accountId"=NEW."accountId")<>300
            OR NOT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=NEW."ownerId" AND "accountId"=NEW."accountId" AND revision=1)
            OR NOT EXISTS(SELECT 1 FROM manual_accounts WHERE id=NEW."accountId" AND "currentRevision"=1)
            OR EXISTS(SELECT 1 FROM account_trades WHERE "accountId"=NEW."accountId")
            OR EXISTS(SELECT 1 FROM account_trade_versions WHERE "accountId"=NEW."accountId") THEN
            RAISE EXCEPTION 'synthetic carry stage missed complete writes';
          END IF;
          PERFORM nextval('synthetic_carry_commit_attempt');
          RAISE EXCEPTION 'synthetic-carry-private-canary' USING DETAIL=NEW."canonicalPayload";
        END IF;
        RETURN NULL;
      END $$`);
    await source.query(`CREATE CONSTRAINT TRIGGER synthetic_carry_commit_failure AFTER INSERT ON account_trade_journals
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_carry_commit_failure()`);
    observedStatements.length=0;
    let failure;
    try { await svc.carry.initialize(owner,value.account,input); } catch(error) { failure=error; }
    assert.ok(failure,'Storage failure must propagate');
    assert.ok((failure.driverError?.code??failure.code)==='P0001'||failure.getStatus?.()===500);
    assert.ok(observedStatements.some(sql=>/^COMMIT\b/i.test(sql)));
    assert.deepEqual((await source.query('SELECT last_value::text AS value,is_called FROM synthetic_carry_commit_attempt'))[0],
      {value:'1',is_called:true},'A nontransactional witness saw all baseline writes exactly once');
    assert.equal(await fingerprint(source),before,'Every journal/lot write rolls back, and the opening pointer remains unchanged');
  } finally {
    if (installed) {
      try { await source.query('DROP TRIGGER IF EXISTS synthetic_carry_commit_failure ON account_trade_journals'); }
      finally {
        try { await source.query('DROP FUNCTION IF EXISTS synthetic_carry_commit_failure()'); }
        finally { await source.query('DROP SEQUENCE synthetic_carry_commit_attempt'); }
      }
    }
  }
  const accepted = await svc.carry.initialize(owner,value.account,input);
  assert.equal(accepted.created,true);
  const after = await fingerprint(source);
  assert.deepEqual(await svc.carry.initialize(owner,value.account,input),{created:false,value:accepted.value});
  assert.equal(await fingerprint(source),after);
  console.log('PASS CARRY-003-B actual deferred COMMIT, complete-write sequence witness, full rollback and explicit original-key retry once');
}

async function sqlIntegrity(source, svc, f) {
  stage = 'CARRY-006-A actual SQL finite bounds, composite source identity and RESTRICT';
  const {owner,other,instruments:[instrument,extra],foreignInstrument,foreignAccount} = f;
  const value = await initializedAccount(svc,owner,instrument,'SQL baseline constraints');
  const baseline = await svc.carry.listLots(owner,value.account);
  const id = baseline.items[0].lotId;
  const before = await fingerprint(source);
  const columns = await source.query(`SELECT column_name,data_type,is_nullable,numeric_precision,numeric_scale,datetime_precision
    FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[lotTable]);
  assert.deepEqual(columns.map(c=>c.column_name).sort(),['id','ownerId','accountId','openingRevision','ordinal',
    'instrumentId','acquiredAt','orderWithinTimestamp','originalQuantity','originalCostUsd','remainingQuantity','createdAt'].sort());
  for (const column of columns) {
    assert.equal(column.is_nullable,'NO');
    if (['originalQuantity','originalCostUsd','remainingQuantity'].includes(column.column_name)) {
      assert.equal(column.data_type,'numeric'); assert.equal(column.numeric_precision,78); assert.equal(column.numeric_scale,30);
    }
    if (['acquiredAt','createdAt'].includes(column.column_name)) assert.equal(column.datetime_precision,3);
  }
  const constraints = await source.query(`SELECT conname,contype,confdeltype FROM pg_constraint WHERE conrelid=$1::regclass`,[lotTable]);
  for (const suffix of ['pkey','identity_key','ordinal_key','chronology_key','owner_fk','journal_fk','position_fk',
    'ordinal_check','opening_revision_check','order_check','quantities_check','cost_check','acquired_at_check','created_at_check']) {
    assert.ok(constraints.some(c=>c.conname===`${lotTable}_${suffix}`));
  }
  for (const c of constraints.filter(c=>c.contype==='f')) assert.equal(c.confdeltype,'r','Baseline parents must be RESTRICT');
  for (const field of ['originalQuantity','originalCostUsd','remainingQuantity']) {
    for (const input of ['NaN','Infinity','-Infinity','-1','1'+'0'.repeat(48),null,
      ...(field==='originalCostUsd'?[]:['0'])]) {
      await rejectedSql(source,r=>r.query(`UPDATE ${lotTable} SET "${field}"=$1 WHERE id=$2`,[input,id]),['23514','22003','23502']);
    }
  }
  for (const field of ['acquiredAt','createdAt']) for (const input of ['infinity','-infinity',null,
    ...(field==='createdAt'?[]:['1969-12-31T23:59:59.999Z','10000-01-01T00:00:00Z'])]) {
    await rejectedSql(source,r=>r.query(`UPDATE ${lotTable} SET "${field}"=$1 WHERE id=$2`,[input,id]),['23514','23502']);
  }
  for (const [field,input,code] of [['remainingQuantity','2','23514'],['ordinal',0,'23514'],['ordinal',101,'23514'],
    ['ordinal',2,'23505'],['openingRevision',0,'23514'],['openingRevision',2,'23503'],
    ['orderWithinTimestamp',-1,'23514'],['orderWithinTimestamp',1,'23505'],
    ['instrumentId',extra,'23503'],['instrumentId',foreignInstrument,'23503'],
    ['ownerId',other,'23503'],['accountId',foreignAccount,'23503']]) {
    await rejectedSql(source,r=>r.query(`UPDATE ${lotTable} SET "${field}"=$1 WHERE id=$2`,[input,id]),[code]);
  }
  await rejectedSql(source,r=>r.query('UPDATE account_trade_journals SET "openingRevision"=NULL WHERE "accountId"=$1',[value.account]),['23514']);
  await rejectedSql(source,r=>r.query("UPDATE account_trade_journals SET \"originKind\"='declared-empty' WHERE \"accountId\"=$1",[value.account]),['23514']);
  for (const [table,constraint] of [
    ['account_trade_journals','account_carry_in_lots_journal_fk'],
    ['account_opening_snapshots','account_opening_positions_ownerId_accountId_revision_fkey'],
    ['account_opening_positions','account_carry_in_lots_position_fk']]) {
    stage = `CARRY-006-A referenced ${table} deletion RESTRICT refusal`;
    await rejectedSql(source,r=>r.query(`DELETE FROM ${table} WHERE "accountId"=$1`,[value.account]),['23001'],constraint);
  }
  const transaction = source.createQueryRunner();
  try {
    await transaction.connect(); await transaction.startTransaction();
    await transaction.query('DELETE FROM owner_auth WHERE id=1');
    assert.deepEqual(await rows(transaction,lotTable),await rows(source,lotTable),'Removable owner binding is not a history parent');
  } finally {
    try { if (transaction.isTransactionActive) await transaction.rollbackTransaction(); }
    finally { await transaction.release(); }
  }
  assert.equal(await fingerprint(source),before);
  console.log('PASS CARRY-006-A actual exact schema, finite numeric/time bounds, owned composite source position and RESTRICT constraints');
}

async function coherentReads(source, svc, f) {
  stage = 'CARRY-004-A actual RR/read-only, baseline snapshot and coherent manual/CSV results';
  const {owner,instruments:[instrument]}=f;
  for (const mode of ['state','preview','journal','csv-preview','csv-detail']) {
    const initialized = !['state','preview'].includes(mode);
    const value = initialized ? await initializedAccount(svc,owner,instrument,`Coherent ${mode}`) :
      await openingAccount(svc,owner,instrument,`Coherent ${mode}`);
    let service='carry', method=mode, args=[owner,value.account], writerCommand;
    let base;
    if (initialized) {
      const buy = tradeCommand(instrument,0,{side:'buy',quantity:'1',grossUsd:'100'});
      base = await svc.trade.create(owner,value.account,buy);
      const sale = execution(instrument,1,{quantity:'2.5'});
      if (mode==='journal') {
        await svc.trade.create(owner,value.account,{requestId:randomUUID(),expectedJournalRevision:1,...sale});
        service='trade'; method='getJournal';
      } else {
        const batch = await csvBatch(svc,owner,value.account,instrument,[sale]);
        if (mode==='csv-detail') await csvConfirm(svc,owner,value.account,batch,1);
        service='csv'; method=mode==='csv-preview'?'preview':'detail';
        args=[owner,value.account,batch.identity.batchId,...(method==='preview'?[batch.settings]:[])];
      }
      writerCommand={service:'trade',method:'correct',args:[owner,value.account,base.value.trade.tradeId,
        {...buy,requestId:randomUUID(),expectedJournalRevision:mode==='csv-preview'?1:2,grossUsd:'120'}]};
    } else if (mode==='preview') {
      args.push({expectedOpeningRevision:1,lots:[lot(instrument),lot(instrument,1,{originalCostUsd:'200'})]});
      writerCommand={service:'accounting',method:'saveOpening',args:[owner,value.account,
        {...value.input,requestId:randomUUID(),expectedRevision:1}]};
    } else {
      writerCommand={service:'carry',method:'initialize',args:[owner,value.account,
        init([lot(instrument),lot(instrument,1,{originalCostUsd:'200'})])]};
    }
    const before=await svc[service][method](...args);
    const reader=startWorker(),writer=startWorker();
    try {
      const [a,b]=await Promise.all([reader.ready,writer.ready]);
      assert.notEqual(a.process,b.process); assert.notEqual(a.database,b.database);
      reader.go({service,method,args,readBarrier:true});
      await reader.barrier;
      writer.go(writerCommand);
      const committed=await writer.finished;
      assert.equal(committed.ok,true); assert.equal(committed.result.created,true);
      reader.release();
      const read=await reader.finished;
      assert.equal(read.ok,true); assert.equal(read.paused,true);
      assert.deepEqual(read.result,before,'Reader retains one complete old revision after an actual service write commits');
      assert.ok(read.statements.some(sql=>/REPEATABLE READ/i.test(sql)));
      assert.ok(read.statements.some(sql=>/READ ONLY/i.test(sql)));
      if (mode==='preview') await unchanged(source,()=>svc.carry.preview(...args),409);
      else {
        const after=await svc[service][method](...args);
        if (mode==='state') { assert.equal(before.origin,null); assert.equal(after.origin.originKind,'known-cost-carry-in'); }
        else {
          const summary = response => mode==='journal'?response.journal.summary:
            mode==='csv-preview'?response.candidateSummary:response.rollbackReview.summaryBefore;
          assert.deepEqual(summary(before),{...zeros,grossBuysUsd:'100',grossSalesUsd:'450',netSalesUsd:'450',
            consumedCostUsd:'350',realizedUsd:'100',remainingCostUsd:'50'});
          assert.deepEqual(summary(after),{...zeros,grossBuysUsd:'120',grossSalesUsd:'450',netSalesUsd:'450',
            consumedCostUsd:'360',realizedUsd:'90',remainingCostUsd:'60'});
        }
      }
    } finally {
      try { reader.release(); }
      finally { await stopWorkers([reader,writer]); }
    }
  }
  console.log('PASS CARRY-004-A observed real RR/read-only process barriers retain pre-init/opening and seeded manual/CSV snapshots across committed writers');
}

async function boundsAndPages(source, svc, f) {
  stage = 'CARRY-002-B / CARRY-004-A 100 baseline lots plus 1000 active trades and immutable/current pages';
  const {owner,instruments:[instrument]}=f;
  const value=await openingAccount(svc,owner,instrument,'Full baseline and active budget','100','100');
  const input=init(Array.from({length:100},(_,index)=>lot(instrument,index,{originalCostUsd:'1'})));
  const accepted=await svc.carry.initialize(owner,value.account,input);
  originReceipt(accepted.value,value.account,input,'100');
  const initial=await journal(svc,owner,value.account);
  assert.equal(initial.journalRevision,0); assert.equal(initial.activeTradeCount,0); assert.equal(initial.versionCount,0);
  assert.deepEqual(initial.summary,{...zeros,remainingCostUsd:'100'});
  const first=await svc.carry.listLots(owner,value.account);
  assert.equal(first.items.length,50); assert.equal(first.nextAfterOrdinal,50);
  const next=await svc.carry.listLots(owner,value.account,{afterOrdinal:'50',limit:'100'});
  assert.equal(next.items.length,50); assert.equal(next.nextAfterOrdinal,null);
  assert.deepEqual([...first.items,...next.items].map(l=>l.ordinal),Array.from({length:100},(_,i)=>i+1));
  assert.deepEqual(await svc.carry.listLots(owner,value.account,{afterOrdinal:'100'}),
    {accountId:value.account,openingRevision:1,items:[],nextAfterOrdinal:null});
  for (const raw of [{afterOrdinal:50},{afterOrdinal:'101'},{limit:'101'},{limit:'01'},{journalRevision:'0'}]) {
    await unchanged(source,()=>svc.carry.listLots(owner,value.account,raw),400);
  }
  const buyInput=tradeCommand(instrument,0,{side:'buy',quantity:'1',grossUsd:'1'});
  const bought=await svc.trade.create(owner,value.account,buyInput);
  const immutable=await svc.carry.listLots(owner,value.account,{afterOrdinal:'50'});
  assert.deepEqual(immutable,next);
  const page=await svc.trade.listLots(owner,value.account,{limit:'100'});
  assert.equal(page.journalRevision,1); assert.equal(page.items.length,100); assert.equal(page.nextOffset,100);
  assert.ok(page.items.every(item=>item.sourceKind==='carry-in'));
  const tail=await svc.trade.listLots(owner,value.account,{limit:'100',offset:'100',journalRevision:'1'});
  assert.equal(tail.items.length,1); assert.equal(tail.items[0].buyTradeId,bought.value.trade.tradeId);
  assert.equal(Object.hasOwn(tail.items[0],'sourceKind'),false,'Existing buy provenance has no extra discriminator');
  // Valid fixture-only create history inside this fresh allowlisted database. Every
  // head has one immutable version; the final actual service command recomputes all.
  const seeded=Array.from({length:998},(_,i)=>{
    const revision=i+2,executionValue=execution(instrument,revision-1,{side:'buy',quantity:'1',grossUsd:'1'});
    return {id:randomUUID(),requestId:randomUUID(),revision,order:revision-1,
      payload:JSON.stringify({kind:'create',expectedJournalRevision:revision-1,...executionValue})};
  });
  await source.transaction(async manager=>{
    await manager.query(`INSERT INTO account_trades(id,"ownerId","accountId","currentVersion","createdAt")
      SELECT x.id,$1,$2,1,$4::timestamptz FROM jsonb_to_recordset($3::jsonb) AS x(id uuid)`,
      [owner,value.account,JSON.stringify(seeded),bought.value.trade.createdAt]);
    await manager.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId",
      "canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,x.id,1,x.revision,x."requestId",x.payload,'create',$4,'buy','2025-01-02T00:00:00Z',x."order",1,1,0,$5::timestamptz
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,"requestId" uuid,revision integer,"order" integer,payload text)`,
      [owner,value.account,JSON.stringify(seeded),instrument,bought.value.trade.createdAt]);
    await manager.query('UPDATE account_trade_journals SET "currentRevision"=999 WHERE "accountId"=$1',[value.account]);
  });
  await unchanged(source,()=>svc.trade.listLots(owner,value.account,{offset:'100',journalRevision:'1'}),409);
  const last=await svc.trade.create(owner,value.account,tradeCommand(instrument,999,{side:'buy',quantity:'1',grossUsd:'1'}));
  assert.equal(last.value.journalRevision,1000);
  const state=await journal(svc,owner,value.account);
  assert.equal(state.activeTradeCount,1000); assert.equal(state.versionCount,1000);
  assert.deepEqual(state.limits,{activeTrades:1000,versions:10000});
  assert.deepEqual(state.summary,{...zeros,grossBuysUsd:'1000',remainingCostUsd:'1100'});
  await unchanged(source,()=>svc.trade.create(owner,value.account,tradeCommand(instrument,1000,{side:'buy',quantity:'1',grossUsd:'1'})),409);
  const before=await fingerprint(source);
  assert.deepEqual(await svc.carry.initialize(owner,value.account,input),{created:false,value:accepted.value});
  assert.deepEqual(await svc.carry.listLots(owner,value.account),first);
  assert.equal(await fingerprint(source),before);
  console.log('PASS CARRY-002-B / CARRY-004-A 100 immutable lots spend no1000-trade capacity; exact full calculation, old buy shape and pinned bounded pages');
}

async function main() {
  sentinel();
  const admin=new Client({host:settings.DB_HOST,port:5432,user:settings.DB_USERNAME,
    password:settings.DB_PASSWORD,database:settings.DB_NAME,connectionTimeoutMillis:5000});
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0,
      'Refuse existing fixture databases; never reuse or drop owner data');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated=spawnSync(process.execPath,['/app/backend/dist/migrate.js'],{
    cwd:'/app/backend',env:{...process.env,...settings,DB_NAME:database},encoding:'utf8',timeout:60000});
  assert.equal(migrated.error,undefined); assert.equal(migrated.signal,null); assert.equal(migrated.status,0);
  const source=productionSource(observedStatements); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name,database);
    const migrations=await source.query('SELECT name FROM migrations ORDER BY timestamp');
    assert.equal(migrations.length, 27); assert.equal(migrations[15].name,'AddKnownCostCarryIn1790060000000');
    assert.equal(migrations[16].name, 'AddExternalUsdFlows1790070000000');
    assert.equal(migrations[17].name, 'AddManualUsdPrices1790080000000');
    assert.equal(migrations[18].name, 'AddDailyDisplayFx1790090000000');
    assert.equal(migrations[19].name, 'AddOwnedTransfers1790100000000');
    assert.deepEqual(await rows(source,lotTable),[]);
    const svc=services(source),fixture=await seed(source,svc);
    const legacy=await fingerprint(source,true),retained=new Map();
    for (const table of mutableTables) retained.set(table,await rows(source,table));
    for (const run of [discoveryAndReconciliation,allocationAndReplay,manualAndCsv,races,deferredCommit,sqlIntegrity,coherentReads,boundsAndPages]) {
      await run(source,svc,fixture);
      assert.equal(await fingerprint(source,true),legacy,'Financial, owner, admissions and migrations remain byte-exact');
      for (const [table,previous] of retained) {
        const current=new Set((await rows(source,table)).map(value=>value.row));
        for (const value of previous) assert.ok(current.has(value.row),'Every preexisting opening, USD and CSV source/receipt/provenance row remains exact');
      }
    }
    console.log('PASS isolated carry-in production-service/PG acceptance; populated migrations and real authentication/HTTPS are separate gates');
  } finally { await source.destroy(); }
}

const watchdog=setTimeout(()=>{
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded isolated carry-in fixture at stage: ${stage}`);
  process.exit(1);
},240000);
watchdog.unref();
(process.argv[2]==='--worker'?workerMain():main()).catch(()=>{
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL isolated carry-in database acceptance at stage: ${stage} (private assertion details withheld)`);
  process.exitCode=1;
}).finally(()=>clearTimeout(watchdog));
