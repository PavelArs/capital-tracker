'use strict';

// Actual compiled production services and synthetic PostgreSQL only (PCUR-1/2).
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_purchase_currency_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
let stage = 'isolated configuration';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function productionSource() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database }))
    .createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource(options);
}
function services(source) {
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const { CsvImportService } = require('/app/backend/dist/accounting/csv-import.service.js');
  return { accounting: new AccountingService(source), trade: new TradeService(source),
    csv: new CsvImportService(source) };
}
async function status(action, expected) {
  let failed = false, actual;
  try { await action(); } catch (error) { failed = true; actual = error?.getStatus?.(); }
  assert.ok(failed, 'Expected a deliberate service rejection');
  assert.equal(actual, expected);
}
async function fingerprint(source) {
  const tables = await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const values = [];
  for (const { tablename } of tables) values.push([tablename,
    await source.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  return digest(JSON.stringify(values));
}
async function rejectedSql(source, sql, params, code) {
  const runner = source.createQueryRunner();
  let failure;
  try {
    await runner.connect(); await runner.startTransaction();
    try { await runner.query(sql, params); } catch (error) { failure = error; }
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { await runner.release(); }
  }
  assert.ok([code].flat().includes(failure?.driverError?.code ?? failure?.code), 'PostgreSQL rejects for the intended SQLSTATE');
}

// Previous USD-only formula from csv-import-db.cjs; PCUR-COMPAT requires it to remain exact.
function legacyHash(account, batch, value, rows, revision) {
  const { format: f, mapping: m } = value, c = m.columns;
  const format = [f.delimiter, f.decimalSeparator, f.timestampMode, f.fixedOffset ?? null];
  const mapping = [[c.instrument, c.side, c.occurredAt, c.order, c.quantity, c.grossUsd, c.feeUsd, c.currency ?? null],
    [...m.instruments].sort((a, b) => compare(a.source, b.source)).map(v => [v.source, v.instrumentId]),
    [...m.sides].sort((a, b) => compare(a.source, b.source)).map(v => [v.source, v.side])];
  return digest(Buffer.from(JSON.stringify(['usd-csv-preview-v1', 'usd-csv-v1', account, batch.batchId,
    batch.sha256, format, mapping, true, rows.map(({ ordinal, startLine, execution: e }) =>
      [ordinal, startLine, [e.instrumentId, e.side, e.occurredAt, e.orderWithinTimestamp, e.quantity, e.grossUsd, e.feeUsd]]),
    revision])));
}

function csv(lines) { return Buffer.from(lines.join('\n') + '\n', 'utf8'); }
function mapping(instrument, columns = {}, extra = {}) {
  return { format: { delimiter: ';', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: { columns: { instrument: 0, side: 1, occurredAt: 2, order: 3, quantity: 4, grossUsd: 5, feeUsd: 6, ...columns },
      instruments: [{ source: 'BTC', instrumentId: instrument }], sides: [{ source: 'buy', side: 'buy' }] },
    assertUsd: true, ...extra };
}
async function journal(svc, owner, name) {
  const account = (await svc.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await svc.trade.initialize(owner, account, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
  return account;
}
async function importFile(svc, owner, account, bytes, value) {
  const uploaded = (await svc.csv.upload(owner, account, { filename: 'purchases.csv', bytes })).value;
  const preview = await svc.csv.preview(owner, account, uploaded.batchId, value);
  return { uploaded, preview };
}
async function confirm(svc, owner, account, uploaded, preview, value) {
  assert.equal(preview.canConfirm, true);
  const input = { requestId: randomUUID(), expectedJournalRevision: preview.journalRevision,
    parserVersion: preview.parserVersion, ...value, previewHash: preview.previewHash };
  const result = await svc.csv.confirm(owner, account, uploaded.batchId, input);
  assert.equal(result.created, true);
  return { input, receipt: result.value };
}

async function migrateAndShape(source) {
  stage = 'PCUR-MIGRATE fresh schema';
  const migrations = await source.query('SELECT name FROM migrations ORDER BY timestamp');
  assert.equal(migrations.at(-1).name, 'AddTradePaymentRecords1790500000000');
  const columns = await source.query(`SELECT column_name,data_type,numeric_precision,numeric_scale,is_nullable
    FROM information_schema.columns WHERE table_name='account_trade_version_payments' ORDER BY ordinal_position`);
  assert.deepEqual(columns.map(c => [c.column_name, c.data_type, c.numeric_precision, c.numeric_scale, c.is_nullable]), [
    ['ownerId', 'uuid', null, null, 'NO'], ['accountId', 'uuid', null, null, 'NO'], ['tradeId', 'uuid', null, null, 'NO'],
    ['version', 'integer', 32, 0, 'NO'], ['currency', 'text', null, null, 'NO'], ['gross', 'numeric', 78, 30, 'NO'],
    ['fee', 'numeric', 78, 30, 'NO'], ['perUsd', 'numeric', 78, 30, 'NO']]);
  assert.deepEqual(await source.query('SELECT * FROM account_trade_version_payments'), []);
  const { AddTradePaymentRecords1790500000000 } = require('/app/backend/dist/migrations/1790500000000-AddTradePaymentRecords.js');
  await assert.rejects(() => new AddTradePaymentRecords1790500000000().down(), /recovery plan/);
  const replay = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(replay.status, 0); assert.match(replay.stdout, /Migrations applied: 0/);
  console.log('PASS PCUR-MIGRATE additive empty payment table, refused downgrade and no-op replay');
}

async function usdCompat(source, svc, owner, instrument) {
  stage = 'PCUR-COMPAT / PCUR-SHAPE USD import';
  const account = await journal(svc, owner, 'USD purchases');
  const bytes = csv(['asset;side;at;order;quantity;gross;fee;currency', 'BTC;buy;2025-06-13T00:00:00Z;0;0.00918359;1000;0;USD']);
  const value = mapping(instrument, { currency: 7 });
  const { uploaded, preview } = await importFile(svc, owner, account, bytes, value);
  assert.deepEqual(preview.rows, [{ ordinal: 1, startLine: 2, execution: { instrumentId: instrument, side: 'buy',
    occurredAt: '2025-06-13T00:00:00.000Z', orderWithinTimestamp: 0, quantity: '0.00918359', grossUsd: '1000', feeUsd: '0' } }]);
  assert.equal(preview.previewHash, legacyHash(account, uploaded, value, preview.rows, 0));
  const { input } = await confirm(svc, owner, account, uploaded, preview, value);
  const [command] = await source.query('SELECT "canonicalPayload" FROM account_csv_import_commands WHERE "requestId"=$1', [input.requestId]);
  const c = value.mapping.columns;
  assert.equal(command.canonicalPayload, JSON.stringify(['usd-csv-command-v1', 'confirm', uploaded.batchId, 0, 'usd-csv-v1',
    [';', '.', 'offset', null], [[c.instrument, c.side, c.occurredAt, c.order, c.quantity, c.grossUsd, c.feeUsd, c.currency],
      [['BTC', instrument]], [['buy', 'buy']]], true, preview.previewHash]));
  const [batch] = await source.query('SELECT "acceptedSettings" FROM account_csv_imports WHERE id=$1', [uploaded.batchId]);
  assert.deepEqual(batch.acceptedSettings, { parserVersion: 'usd-csv-v1', ...value });
  const trades = await svc.trade.listTrades(owner, account);
  assert.equal(trades.items.length, 1); assert.equal('payment' in trades.items[0], false);
  const rows = await svc.csv.rows(owner, account, uploaded.batchId);
  assert.equal('payment' in rows.items[0].createVersion, false);
  assert.deepEqual(await source.query('SELECT * FROM account_trade_version_payments'), []);
  console.log('PASS PCUR-COMPAT / PCUR-SHAPE USD-only hash, payload, accepted settings and response shape unchanged');
}

async function rubPurchase(source, svc, owner, instrument) {
  stage = 'PCUR-RUB preview, confirm and read-back';
  const account = await journal(svc, owner, 'Bybit RUB purchases');
  const bytes = csv(['asset;side;at;order;quantity;gross;fee', 'BTC;buy;2025-11-21T00:00:00Z;0;0.01;100000;0']);
  const value = mapping(instrument, {}, { payment: { currency: 'RUB', perUsd: '79.0246' } });
  const { uploaded, preview } = await importFile(svc, owner, account, bytes, value);
  const payment = { currency: 'RUB', gross: '100000', fee: '0', perUsd: '79.0246' };
  assert.deepEqual(preview.rowErrors, []);
  assert.deepEqual(preview.rows, [{ ordinal: 1, startLine: 2, execution: { instrumentId: instrument, side: 'buy',
    occurredAt: '2025-11-21T00:00:00.000Z', orderWithinTimestamp: 0, quantity: '0.01', grossUsd: '1265.42873991', feeUsd: '0' },
  payment }]);
  assert.equal(preview.candidateSummary.remainingCostUsd, '1265.42873991');
  assert.notEqual(preview.previewHash, legacyHash(account, uploaded, mapping(instrument), preview.rows, 0),
    'Payment settings are bound into the preview hash');
  await status(() => svc.csv.confirm(owner, account, uploaded.batchId, { requestId: randomUUID(), expectedJournalRevision: 0,
    parserVersion: preview.parserVersion, ...value, payment: { currency: 'RUB', perUsd: '80' }, previewHash: preview.previewHash }), 409);
  await confirm(svc, owner, account, uploaded, preview, value);
  const trades = await svc.trade.listTrades(owner, account);
  assert.deepEqual(trades.items.map(t => [t.grossUsd, t.feeUsd, t.payment]), [['1265.42873991', '0', payment]]);
  const state = await svc.trade.getJournal(owner, account);
  assert.equal(state.journal.summary.remainingCostUsd, '1265.42873991');
  const rows = await svc.csv.rows(owner, account, uploaded.batchId);
  assert.deepEqual(rows.items[0].createVersion.payment, payment);
  const versions = await svc.trade.listVersions(owner, account, trades.items[0].tradeId);
  assert.deepEqual(versions.items[0].payment, payment);
  const stored = await source.query('SELECT currency,gross::text,fee::text,"perUsd"::text FROM account_trade_version_payments WHERE "accountId"=$1', [account]);
  assert.deepEqual(stored, [{ currency: 'RUB', gross: '100000.000000000000000000000000000000',
    fee: '0.000000000000000000000000000000', perUsd: '79.024600000000000000000000000000' }]);
  const [batch] = await source.query('SELECT "acceptedSettings" FROM account_csv_imports WHERE id=$1', [uploaded.batchId]);
  assert.deepEqual(batch.acceptedSettings.payment, { currency: 'RUB', perUsd: '79.0246' });

  stage = 'PCUR-RUB rollback keeps the voided payment';
  const detail = await svc.csv.detail(owner, account, uploaded.batchId);
  assert.equal(detail.rollbackReview.eligible, true);
  await svc.csv.rollback(owner, account, uploaded.batchId, { requestId: randomUUID(), expectedJournalRevision: 1 });
  const after = await svc.csv.rows(owner, account, uploaded.batchId);
  assert.deepEqual(after.items[0].rollbackVersion.payment, payment);
  assert.equal(after.items[0].rollbackVersion.kind, 'void');
  console.log('PASS PCUR-RUB 100000 RUB at 79.0246 -> 1265.42873991 USD stored with exact payment, FIFO cost and rollback');
}

async function mixed(source, svc, owner, instrument) {
  stage = 'PCUR-MIXED currency and rate columns';
  const account = await journal(svc, owner, 'Mixed currencies');
  const bytes = csv(['asset;side;at;order;quantity;gross;fee;currency;rate',
    'BTC;buy;2025-07-01T00:00:00Z;0;0.001;500;1;USD;',
    'BTC;buy;2025-07-01T00:00:00Z;1;0.01;1000.5;0.5;USDT;',
    'BTC;buy;2026-07-15T00:00:00Z;0;0.003;30000;0;RUB;77.9568']);
  const value = mapping(instrument, { currency: 7, rate: 8 });
  const { uploaded, preview } = await importFile(svc, owner, account, bytes, value);
  assert.deepEqual(preview.rowErrors, []);
  assert.deepEqual(preview.rows.map(r => [r.execution.grossUsd, r.execution.feeUsd, r.payment]), [
    ['500', '1', undefined],
    ['1000.5', '0.5', { currency: 'USDT', gross: '1000.5', fee: '0.5', perUsd: '1' }],
    ['384.82852041', '0', { currency: 'RUB', gross: '30000', fee: '0', perUsd: '77.9568' }]]);
  assert.equal('payment' in preview.rows[0], false);
  await confirm(svc, owner, account, uploaded, preview, value);
  const stored = await source.query('SELECT currency FROM account_trade_version_payments WHERE "accountId"=$1 ORDER BY currency', [account]);
  assert.deepEqual(stored.map(r => r.currency), ['RUB', 'USDT']);
  console.log('PASS PCUR-MIXED USD without payment, USDT at 1, RUB 30000 at 77.9568 -> 384.82852041');
}

async function errors(source, svc, owner, instrument) {
  stage = 'PCUR-ERRORS';
  const account = await journal(svc, owner, 'Rejected currencies');
  const bytes = csv(['asset;side;at;order;quantity;gross;fee;currency;rate',
    'BTC;buy;2025-07-01T00:00:00Z;0;0.001;100;0;EUR;',
    'BTC;buy;2025-07-01T00:00:00Z;1;0.001;100;0;rub;80',
    'BTC;buy;2025-07-01T00:00:00Z;2;0.001;100;0;USD;2']);
  const before = await fingerprint(source);
  const value = mapping(instrument, { currency: 7, rate: 8 });
  const uploaded = (await svc.csv.upload(owner, account, { filename: 'bad.csv', bytes })).value;
  const afterUpload = await fingerprint(source);
  assert.notEqual(afterUpload, before);
  const preview = await svc.csv.preview(owner, account, uploaded.batchId, value);
  assert.equal(preview.canConfirm, false); assert.equal(preview.previewHash, null); assert.equal(preview.candidateSummary, null);
  assert.deepEqual(preview.rowErrors, [{ ordinal: 1, field: 'rate', code: 'missing-rate' },
    { ordinal: 2, field: 'currency', code: 'invalid-currency' }, { ordinal: 3, field: 'rate', code: 'invalid-rate' }]);
  await status(() => svc.csv.preview(owner, account, uploaded.batchId, { ...value, payment: { currency: 'RUB' } }), 400);
  await status(() => svc.csv.preview(owner, account, uploaded.batchId, mapping(instrument, {}, { payment: { currency: 'USD' } })), 400);
  await status(() => svc.csv.confirm(owner, account, uploaded.batchId, { requestId: randomUUID(), expectedJournalRevision: 0,
    parserVersion: 'usd-csv-v1', ...value, previewHash: '0'.repeat(64) }), 409); // existing nonconfirmable-batch conflict
  assert.equal(await fingerprint(source), afterUpload, 'Refused previews/confirm write nothing');
  console.log('PASS PCUR-ERRORS missing/invalid currency or rate stays nonconfirmable; contradictory settings 400 without writes');
}

async function constraints(source, owner) {
  stage = 'PCUR-MIGRATE database constraints';
  const [version] = await source.query(`SELECT v."ownerId",v."accountId",v."tradeId",v.version FROM account_trade_versions v
    LEFT JOIN account_trade_version_payments p USING ("ownerId","accountId","tradeId",version)
    WHERE p.currency IS NULL AND v."ownerId"=$1 LIMIT 1`, [owner]);
  const key = [version.ownerId, version.accountId, version.tradeId, version.version];
  const insert = `INSERT INTO account_trade_version_payments ("ownerId","accountId","tradeId",version,currency,gross,fee,"perUsd")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
  await rejectedSql(source, insert, [version.ownerId, version.accountId, randomUUID(), 1, 'RUB', '1', '0', '1'], '23503');
  for (const bad of [['USD', '1', '0', '1'], ['rub', '1', '0', '1'], ['RU', '1', '0', '1'], ['RUB', '0', '0', '1'],
    ['RUB', '1', '-1', '1'], ['RUB', '1', '0', '0'], ['RUB', 'NaN', '0', '1'], ['RUB', '1', '0', 'Infinity']])
    // Typed numeric(78,30) refuses infinity itself (22003); every other value hits a CHECK.
    await rejectedSql(source, insert, [...key, ...bad], bad.includes('Infinity') ? ['22003', '23514'] : '23514');
  const runner = source.createQueryRunner();
  try {
    await runner.connect(); await runner.startTransaction();
    await runner.query(insert, [...key, 'RUB', '1', '0', '1']);
    await runner.rollbackTransaction();
  } finally { await runner.release(); }
  console.log('PASS PCUR-MIGRATE payment rows require an existing version and valid currency/amounts/rate');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact isolated synthetic settings required');
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Refuse existing fixture databases; never reuse or drop owner data');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(migrated.status, 0);
  const source = productionSource(); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const [user] = await source.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES('currency-owner@example.invalid','synthetic-direct-service-not-a-login-hash',true) RETURNING id`);
    const owner = user.id;
    await source.query('INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)', [owner, randomUUID()]);
    const svc = services(source);
    const instrument = (await svc.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Bitcoin', symbol: 'BTC' })).value.id;
    await migrateAndShape(source);
    await usdCompat(source, svc, owner, instrument);
    await rubPurchase(source, svc, owner, instrument);
    await mixed(source, svc, owner, instrument);
    await errors(source, svc, owner, instrument);
    await constraints(source, owner);
    console.log('PASS isolated purchase-currency production-service/PG acceptance');
  } finally { await source.destroy(); }
}

const watchdog = setTimeout(() => {
  console.error(`FAIL bounded purchase-currency fixture at stage: ${stage}`);
  process.exit(1);
}, 120000);
watchdog.unref();
main().catch((error) => {
  console.error(`FAIL isolated purchase-currency database acceptance at stage: ${stage}`);
  if (process.env.PCUR_DEBUG === '1') console.error(error);
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
