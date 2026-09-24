'use strict';

// Actual production services and PostgreSQL. No repository/auth/backend mocks.
// Missing future module/schema is a prerequisite failure, never behavioral RED.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_owned_transfers_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const at = '2025-01-06T00:00:00.000Z';
const transferTables = ['owner_transfer_journals', 'owned_transfers', 'owned_transfer_versions'];
let stage = 'isolated configuration';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  return { accounting: make('accounting.service', 'AccountingService'),
    trade: make('trade.service', 'TradeService'), transfer: make('owned-transfer.service', 'OwnedTransferService'),
    csv: make('csv-import.service', 'CsvImportService'), history: make('historical-accounting.service', 'HistoricalAccountingService'),
    valuation: make('historical-valuation.service', 'HistoricalValuationService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    portfolio: make('manual-portfolio-valuation.service', 'ManualPortfolioValuationService') };
}
async function fingerprint(db, excluded = []) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const rows = [];
  for (const { tablename } of tables) {
    if (excluded.includes(tablename)) continue;
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([tablename, await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function unchanged(db, action, status) {
  const before = await fingerprint(db);
  await assert.rejects(action, error => error.getStatus?.() === status,
    'Specified domain rejection, not an incidental SQL error');
  assert.equal(await fingerprint(db), before, 'Rejection cannot reserve a key or alter any row');
}
async function account(s, owner, name, start = coverageFrom) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (start) await s.trade.initialize(owner, id, { requestId: randomUUID(), coverageFrom: start, assertEmpty: true });
  return id;
}
const trade = (instrumentId, revision, changes = {}) => ({ requestId: randomUUID(),
  expectedJournalRevision: revision, instrumentId, side: 'buy', occurredAt: '2025-01-02T00:00:00.000Z',
  orderWithinTimestamp: revision, quantity: '1', grossUsd: '100', feeUsd: '0', ...changes });
const movement = (f, a, b, fromRevision, toRevision, changes = {}) => ({ requestId: randomUUID(),
  fromAccountId: a, toAccountId: b, expectedFromJournalRevision: fromRevision,
  expectedToJournalRevision: toRevision, assertInternal: true, instrumentId: f.token,
  occurredAt: '2025-01-03T00:00:00.000Z', orderWithinTimestamp: 0, quantity: '1.5',
  feeInstrumentId: f.token, feeQuantity: '0.1', ...changes });
async function journal(s, owner, id) { return (await s.trade.getJournal(owner, id)).journal; }
async function setup(s, f, name) {
  const a = await account(s, f.owner, `${name} A`);
  const b = await account(s, f.owner, `${name} B`);
  const first = await s.trade.create(f.owner, a, trade(f.token, 0));
  await s.trade.create(f.owner, a, trade(f.token, 1, { grossUsd: '200' }));
  return { a, b, first: first.value, input: movement(f, a, b, 2, 0) };
}
const corrections = (saved, from, to, changes = {}) => ({ requestId: randomUUID(),
  expectedVersion: saved.version, expectedFromJournalRevision: from, expectedToJournalRevision: to,
  assertInternal: true, instrumentId: saved.instrumentId, occurredAt: saved.occurredAt,
  orderWithinTimestamp: saved.orderWithinTimestamp, quantity: saved.quantity,
  feeInstrumentId: saved.feeInstrumentId, feeQuantity: saved.feeQuantity, ...changes });

async function exactAndRestatement(db, s, f) {
  stage = 'TRANSFER-001-A/003-A exact economics and immutable receipts';
  const { a, b, first, input } = await setup(s, f, 'Exact');
  const saved = await s.transfer.create(f.owner, input);
  assert.equal(saved.created, true);
  const target = saved.value.transfer.transferId;
  assert.equal(saved.value.transfer.fromJournalRevision, 3);
  assert.equal(saved.value.transfer.toJournalRevision, 1);
  let sender = await journal(s, f.owner, a), receiver = await journal(s, f.owner, b);
  assert.equal(sender.summary.remainingCostUsd, '80');
  assert.equal(receiver.summary.remainingCostUsd, '200');
  assert.equal(sender.summary.realizedUsd, '0');
  assert.equal(receiver.summary.realizedUsd, '0');
  assert.equal(sender.transferSummary.feeConsumedBasisUsd, '20');
  assert.equal(sender.versionCount, 2, 'Passive transfer tick is not a local trade version');
  assert.equal(receiver.versionCount, 0);
  assert.deepEqual(sender.revisionBudget, { used: 3, limit: 10000 });
  const allocation = await s.transfer.allocation(f.owner, target, {});
  assert.equal(allocation.principalBasisUsd, '200');
  assert.equal(allocation.feeConsumedBasisUsd, '20');
  assert.deepEqual(allocation.items.map(row => [row.kind, row.quantity, row.costUsd]),
    [['principal', '1', '100'], ['principal', '0.5', '100'], ['fee', '0.1', '20']]);
  assert.equal(allocation.items[0].origin.tradeId, first.trade.tradeId);
  const sale = await s.trade.create(f.owner, b, trade(f.token, 1, { side: 'sell', quantity: '1.2',
    grossUsd: '360', occurredAt: '2025-01-04T00:00:00.000Z' }));
  receiver = await journal(s, f.owner, b);
  assert.equal(receiver.summary.consumedCostUsd, '140');
  assert.equal(receiver.summary.realizedUsd, '220');
  assert.equal(receiver.summary.remainingCostUsd, '60');
  assert.equal((await journal(s, f.owner, a)).journalRevision, 4, 'Receiver sale invalidates connected source');
  const oldReceipt = saved.value;
  await s.trade.correct(f.owner, a, first.trade.tradeId, trade(f.token, 4, { grossUsd: '120', orderWithinTimestamp: 0 }));
  receiver = await journal(s, f.owner, b);
  assert.equal(receiver.summary.consumedCostUsd, '160');
  assert.equal(receiver.summary.realizedUsd, '200');
  assert.equal(receiver.summary.remainingCostUsd, '60');
  assert.equal(receiver.journalRevision, 3);
  assert.equal(receiver.versionCount, 1);
  assert.equal((await journal(s, f.owner, a)).versionCount, 3);
  assert.deepEqual(await s.transfer.create(f.owner, input), { created: false, value: oldReceipt });
  await unchanged(db, () => s.transfer.create(f.owner, { ...input, quantity: '1.4' }), 409);
  await unchanged(db, () => s.transfer.allocation(f.owner, target,
    { fromJournalRevision: '3', toJournalRevision: '1' }), 409);
  await unchanged(db, () => s.trade.listLots(f.owner, b, { journalRevision: '2' }), 409);
  await unchanged(db, () => s.trade.correct(f.owner, a, first.trade.tradeId,
    trade(f.token, 5, { quantity: '0.1', orderWithinTimestamp: 0 })), 409);
  await unchanged(db, () => s.transfer.void(f.owner, target, { requestId: randomUUID(),
    expectedVersion: 1, expectedFromJournalRevision: 5, expectedToJournalRevision: 3 }), 409);
  assert.deepEqual((await s.transfer.listVersions(f.owner, target, {})).items, [oldReceipt.transfer]);
  assert.equal((await s.trade.listVersions(f.owner, b, sale.value.trade.tradeId, {})).items[0].journalRevision, 2);
  const snapshot = await s.history.getSnapshot(f.owner, b, { at });
  assert.equal(snapshot.summary.realizedUsd, '200');
  assert.equal(snapshot.items[0].quantity, '0.3');
  assert.equal(snapshot.items[0].costUsd, '60');
  await s.prices.set(f.owner, f.token, { requestId: randomUUID(), expectedRevision: 0,
    observedAt: at, priceUsd: '300', assertReviewed: true });
  assert.equal((await s.valuation.getSnapshot(f.owner, b, { at })).totalValueUsd, '90');
  assert.equal((await s.portfolio.preview(f.owner, { at, accountIds: [a, b] }, {})).totalValueUsd, '210');
  assert.deepEqual((await s.history.getSnapshot(f.owner, b, { at: '2025-01-02T23:59:59.999Z' })).items, []);
  assert.equal((await s.history.getSnapshot(f.owner, b, { at: input.occurredAt })).items[0].quantity, '1.5');
  console.log('PASS TRANSFER-001-A/003-A exact connected economics/replay/history/valuation');
}

async function correctionVoidAndPrivacy(db, s, f) {
  stage = 'TRANSFER-002/003-D coverage, privacy, correction and graph split';
  const { a, b, input } = await setup(s, f, 'Lifecycle');
  const later = await account(s, f.owner, 'Later origin', '2025-01-04T00:00:00.000Z');
  const uninitialized = await account(s, f.owner, 'Uninitialized', null);
  const foreign = await account(s, f.other, 'Foreign account');
  for (const [patch, code] of [[{ toAccountId: later }, 409], [{ toAccountId: a }, 409],
    [{ toAccountId: uninitialized }, 409], [{ toAccountId: foreign }, 404],
    [{ instrumentId: f.foreignToken }, 404], [{ feeInstrumentId: f.foreignToken }, 404],
    [{ assertInternal: false }, 400], [{ quantity: 1.5 }, 400], [{ feeQuantity: '0' }, 400]]) {
    await unchanged(db, () => s.transfer.create(f.owner, { ...input, ...patch }), code);
  }
  const saved = (await s.transfer.create(f.owner, input)).value;
  const target = saved.transfer.transferId;
  await unchanged(db, () => s.transfer.correct(f.owner, target,
    corrections(saved.transfer, 3, 1, { occurredAt: '2024-12-31T23:59:59.999Z' })), 409);
  const correctedInput = corrections(saved.transfer, 3, 1, { quantity: '1', feeInstrumentId: null, feeQuantity: '0' });
  const corrected = (await s.transfer.correct(f.owner, target, correctedInput)).value;
  assert.equal(corrected.transfer.version, 2);
  assert.equal((await journal(s, f.owner, a)).summary.remainingCostUsd, '200');
  assert.equal((await journal(s, f.owner, b)).summary.remainingCostUsd, '100');
  const voidInput = { requestId: randomUUID(), expectedVersion: 2,
    expectedFromJournalRevision: 4, expectedToJournalRevision: 2 };
  const voided = (await s.transfer.void(f.owner, target, voidInput)).value;
  assert.equal(voided.transfer.kind, 'void');
  assert.equal(voided.transfer.quantity, '1');
  assert.equal((await journal(s, f.owner, a)).journalRevision, 5);
  assert.equal((await journal(s, f.owner, b)).journalRevision, 3, 'Disconnected receiver pin still advances');
  assert.equal((await journal(s, f.owner, a)).summary.remainingCostUsd, '300');
  assert.equal((await journal(s, f.owner, b)).summary.remainingCostUsd, '0');
  assert.deepEqual((await s.transfer.allocation(f.owner, target, {})).items, []);
  await unchanged(db, () => s.transfer.void(f.owner, target, { ...voidInput, requestId: randomUUID(),
    expectedVersion: 3, expectedFromJournalRevision: 5, expectedToJournalRevision: 3 }), 409);
  assert.deepEqual(await s.transfer.correct(f.owner, target, correctedInput), { created: false, value: corrected });
  assert.deepEqual(await s.transfer.void(f.owner, target, voidInput), { created: false, value: voided });
  const before = await fingerprint(db);
  const page = await s.transfer.listVersions(f.owner, target, { limit: '2' });
  assert.deepEqual(page.items, [voided.transfer, corrected.transfer]);
  assert.equal(page.nextBeforeVersion, 2);
  assert.deepEqual((await s.transfer.listVersions(f.owner, target, { beforeVersion: '2' })).items, [saved.transfer]);
  await unchanged(db, () => s.transfer.allocation(f.other, target, {}), 404);
  assert.equal(await fingerprint(db), before);
  console.log('PASS TRANSFER-002/003-D coverage/privacy/lifecycle/split');
}

async function coherentSnapshot(db, s, f) {
  stage = 'TRANSFER-004-B actual two-connection repeatable-read barrier';
  const { a, b, first, input } = await setup(s, f, 'Snapshot');
  await s.transfer.create(f.owner, input);
  const previous = await s.history.getSnapshot(f.owner, b, { at });
  const reader = source();
  await reader.initialize();
  let release, arrived, pending;
  const gate = new Promise(resolve => { release = resolve; });
  const barrier = new Promise(resolve => { arrived = resolve; });
  const statements = [];
  const create = reader.createQueryRunner.bind(reader);
  let paused = false;
  reader.createQueryRunner = (...args) => {
    const runner = create(...args), query = runner.query.bind(runner);
    runner.query = async (sql, ...rest) => {
      statements.push(sql);
      if (!paused && /SELECT.*account_trade_versions/s.test(sql)) {
        paused = true;
        assert.ok(runner.isTransactionActive);
        const [{ pid }] = await query('SELECT pg_backend_pid() AS pid');
        arrived(pid);
        await gate;
      }
      return query(sql, ...rest);
    };
    return runner;
  };
  const timeout = setTimeout(() => release(), 10000);
  try {
    pending = services(reader).history.getSnapshot(f.owner, b, { at });
    const readerPid = await Promise.race([barrier, pending.then(() => { throw new Error('Read barrier not reached'); })]);
    const [{ pid: writerPid }] = await db.query('SELECT pg_backend_pid() AS pid');
    assert.notEqual(readerPid, writerPid);
    assert.ok(statements.some(sql => /REPEATABLE READ/.test(sql)));
    assert.ok(statements.some(sql => /READ ONLY/.test(sql)));
    await s.trade.correct(f.owner, a, first.trade.tradeId, trade(f.token, 3,
      { grossUsd: '120', orderWithinTimestamp: 0 }));
    const afterWrite = await fingerprint(db);
    release();
    assert.deepEqual(await pending, previous);
    const current = await s.history.getSnapshot(f.owner, b, { at });
    assert.equal(previous.items[0].costUsd, '200');
    assert.equal(current.items[0].costUsd, '220');
    assert.equal(current.journalRevision, previous.journalRevision + 1);
    assert.equal(await fingerprint(db), afterWrite, 'Both actual reads are write-free');
  } finally {
    clearTimeout(timeout); release(); await pending?.catch(() => {}); await reader.destroy();
  }
  console.log('PASS TRANSFER-004-B coherent source/receiver snapshot');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value,
    'Exact isolated synthetic settings required');
  assert.ok(existsSync('/app/backend/dist/accounting/owned-transfer.service.js'),
    'Missing module is prerequisite failure, not behavioral RED');
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Never reuse or drop a pre-existing database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(migrated.status, 0, 'Actual schema20 migration');
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 20);
    for (const table of transferTables) assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('owned-transfer-owner@example.invalid','synthetic-not-a-hash',true),
      ('owned-transfer-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const token = (await s.accounting.createInstrument(owner.id, { requestId: randomUUID(), name: 'Token', symbol: 'SAME' })).value.id;
    const foreignToken = (await s.accounting.createInstrument(other.id, { requestId: randomUUID(), name: 'Foreign', symbol: 'SAME' })).value.id;
    const f = { owner: owner.id, other: other.id, token, foreignToken };
    const mutable = [...transferTables, 'manual_accounts', 'accounting_instruments', 'account_trade_journals',
      'account_trades', 'account_trade_versions', 'manual_usd_price_versions'];
    const preserved = await fingerprint(db, mutable);
    for (const check of [exactAndRestatement, correctionVoidAndPrivacy, coherentSnapshot]) await check(db, s, f);
    assert.equal(await fingerprint(db, mutable), preserved, 'External flows/auth/legacy/provider tables unchanged');
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 180000);
watchdog.unref();
main().catch(error => { console.error(`FAIL ${stage}: ${error.message}`); process.exitCode = 1; })
  .finally(() => clearTimeout(watchdog));
