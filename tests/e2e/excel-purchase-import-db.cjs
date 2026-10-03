'use strict';

// SHEET-1..3 against the actual compiled services and a synthetic PostgreSQL database.
// Missing future code is a prerequisite failure, never behavioral RED.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_excel_import_e2e';
const writeTables = ['account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows',
  'account_trade_journals', 'account_trades', 'account_trade_versions', 'manual_usd_price_versions'];
const coverageFrom = '2025-01-01T00:00:00.000Z';
const header = ['Дата', 'Купил', 'Количество', 'Купил за', 'За количество', 'в USD', 'Курс',
  'Текущий курс', 'Текущая стоимость', 'Разница', 'Доход'];
const sample = ['13.06.2025', 'BTC', '0,00918359', 'USDT', '1000', '1000', '108889,8786', '84945',
  '780,1000526', '-219,8999475', '-21,99%'];
const reference = { usdAmount: '5', rate: '6', currentRate: '7', currentValue: '8', difference: '9',
  returnPercent: '10' };
let stage = 'isolated configuration';

function sentinel() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated synthetic settings required');
}

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
  const { ManualPriceService } = require('/app/backend/dist/accounting/manual-price.service.js');
  return { accounting: new AccountingService(source), trade: new TradeService(source),
    csv: new CsvImportService(source), prices: new ManualPriceService(source) };
}

async function fingerprint(source) {
  const values = [];
  for (const table of writeTables)
    values.push(await source.query(`SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY row`));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

async function status(action, expected) {
  let actual = 'no rejection';
  try { await action(); } catch (error) {
    actual = error?.getStatus?.() ?? 'unexpected error';
    if (process.env.SHEET_PROBE_DEBUG === '1' && actual !== expected) console.error(error);
  }
  assert.equal(actual, expected, 'Reject at the specified domain boundary');
}

async function unchanged(source, action, expected) {
  const before = await fingerprint(source);
  await status(action, expected);
  assert.equal(await fingerprint(source), before, 'A refused request writes nothing');
}

const tsv = (rows, ending = '\r\n') => Buffer.from([header, ...rows].map((row) => row.join('\t')).join(ending) + ending, 'utf8');
const withDate = (date, changes = {}) => sample.map((cell, index) =>
  index === 0 ? date : changes[index] ?? cell);
function sheetSettings(instrumentId) {
  return { format: { delimiter: '\t', decimalSeparator: ',', timestampMode: 'day-month-year-utc' },
    mapping: { columns: { instrument: 1, occurredAt: 0, quantity: 2, grossUsd: 5 },
      instruments: [{ source: 'BTC', instrumentId }], sides: [], allRowsSide: 'buy' },
    assertUsd: true, feeIncludedInGross: true };
}
const purchase = (instrumentId, occurredAt, order, changes = {}) => ({ instrumentId, side: 'buy',
  occurredAt, orderWithinTimestamp: order, quantity: '0.00918359', grossUsd: '1000', feeUsd: '0', ...changes });

async function upload(svc, owner, account, bytes, filename = 'Покупки.tsv') {
  return (await svc.csv.upload(owner, account, { filename, bytes })).value;
}
async function confirm(svc, owner, account, batch, input, preview) {
  assert.equal(preview.canConfirm, true);
  const result = await svc.csv.confirm(owner, account, batch, { ...input, requestId: randomUUID(),
    expectedJournalRevision: preview.journalRevision, parserVersion: preview.parserVersion,
    previewHash: preview.previewHash });
  assert.equal(result.created, true);
  return result.value;
}
async function journal(svc, owner, name) {
  const account = (await svc.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await svc.trade.initialize(owner, account, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
  return account;
}

async function seed(source, svc) {
  const owners = [];
  for (const email of ['sheet-owner@example.invalid', 'sheet-other@example.invalid']) {
    const [user] = await source.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES($1,'synthetic-direct-service-not-a-login-hash',true) RETURNING id`, [email]);
    owners.push(user.id);
  }
  const [owner, other] = owners;
  const btc = (await svc.accounting.createInstrument(owner,
    { requestId: randomUUID(), name: 'Bitcoin', symbol: 'BTC' })).value.id;
  return { owner, other, btc };
}

async function sampleImport(source, svc, fx) {
  stage = 'SHEET-SAMPLE owner sample row imports as one midnight-UTC purchase';
  const account = await journal(svc, fx.owner, 'Excel purchases');
  const batch = await upload(svc, fx.owner, account, tsv([sample]));
  const input = sheetSettings(fx.btc);
  const before = await fingerprint(source);
  const preview = await svc.csv.preview(fx.owner, account, batch.batchId, input);
  assert.equal(await fingerprint(source), before, 'Preview writes nothing');
  assert.deepEqual(preview.rowErrors, []); assert.deepEqual(preview.batchErrors, []);
  assert.deepEqual(preview.rows, [{ ordinal: 1, startLine: 2,
    execution: purchase(fx.btc, '2025-06-13T00:00:00.000Z', 1) }]);
  assert.deepEqual(preview.ignoredColumns.map((column) => column.header),
    ['Купил за', 'За количество', 'Курс', 'Текущий курс', 'Текущая стоимость', 'Разница', 'Доход']);
  assert.equal(preview.candidateSummary.grossBuysUsd, '1000');
  assert.equal(preview.candidateSummary.buyFeesUsd, '0');
  assert.equal(preview.candidateSummary.remainingCostUsd, '1000');
  assert.match(preview.previewHash, /^[0-9a-f]{64}$/);
  const receipt = await confirm(svc, fx.owner, account, batch.batchId, input, preview);
  assert.equal(receipt.rowCount, 1);
  const [stored] = await source.query(`SELECT v."occurredAt", v."orderWithinTimestamp" AS "order",
    trim_scale(v.quantity)::text AS quantity, trim_scale(v."grossUsd")::text AS "grossUsd",
    trim_scale(v."feeUsd")::text AS "feeUsd", v.side FROM account_trade_versions v
    JOIN account_csv_import_rows r ON r."tradeId"=v."tradeId" AND r."createVersion"=v.version
    WHERE r."batchId"=$1`, [batch.batchId]);
  assert.equal(stored.occurredAt.toISOString(), '2025-06-13T00:00:00.000Z');
  assert.deepEqual({ ...stored, occurredAt: null }, { occurredAt: null, order: 1, quantity: '0.00918359',
    grossUsd: '1000', feeUsd: '0', side: 'buy' });
  const detail = await svc.csv.detail(fx.owner, account, batch.batchId);
  assert.equal(detail.batch.state, 'committed');
  assert.deepEqual(detail.acceptedSettings, { parserVersion: 'usd-csv-v1', ...input });
  console.log('PASS SHEET-SAMPLE tab/date/no-side/no-fee sample stored as buy 0.00918359 for 1000 USD at 2025-06-13T00:00Z order 1');
  return { account, batch: batch.batchId };
}

async function sameDay(source, svc, fx) {
  stage = 'SHEET-SAME-DAY identical same-day rows continue after existing orders';
  const account = await journal(svc, fx.owner, 'Same-day purchases');
  await svc.trade.create(fx.owner, account, { requestId: randomUUID(), expectedJournalRevision: 0,
    ...purchase(fx.btc, '2025-07-01T00:00:00.000Z', 4, { quantity: '2', grossUsd: '7' }) });
  const july = withDate('01.07.2025');
  const batch = await upload(svc, fx.owner, account, tsv([july, withDate('05.08.2025'), july]));
  const input = sheetSettings(fx.btc);
  const preview = await svc.csv.preview(fx.owner, account, batch.batchId, input);
  assert.deepEqual(preview.rows.map((row) => [row.execution.occurredAt, row.execution.orderWithinTimestamp]), [
    ['2025-07-01T00:00:00.000Z', 5], ['2025-08-05T00:00:00.000Z', 1], ['2025-07-01T00:00:00.000Z', 6]]);
  await confirm(svc, fx.owner, account, batch.batchId, input, preview);
  const stored = await source.query(`SELECT r.ordinal, v."orderWithinTimestamp" AS "order" FROM account_csv_import_rows r
    JOIN account_trade_versions v ON v."tradeId"=r."tradeId" AND v.version=r."createVersion"
    WHERE r."batchId"=$1 ORDER BY r.ordinal`, [batch.batchId]);
  assert.deepEqual(stored, [{ ordinal: 1, order: 5 }, { ordinal: 2, order: 1 }, { ordinal: 3, order: 6 }]);
  console.log('PASS SHEET-SAME-DAY two identical 01.07.2025 rows kept as orders 5 and 6 after an existing order 4');
}

async function explicitAndInvalid(source, svc, fx) {
  stage = 'SHEET-EXPLICIT / SHEET-INVALID explicit companions and whole-batch refusal';
  const account = await journal(svc, fx.owner, 'Refused sheets');
  const batch = await upload(svc, fx.owner, account, tsv([withDate('31.02.2025'), withDate('2025-06-13'),
    withDate('13.06.2025 10:00'), withDate('13.06.2025', { 2: '1 000' }), withDate('14.06.2025')]));
  const input = sheetSettings(fx.btc);
  const before = await fingerprint(source);
  const preview = await svc.csv.preview(fx.owner, account, batch.batchId, input);
  assert.equal(preview.canConfirm, false); assert.equal(preview.previewHash, null);
  assert.equal(preview.candidateSummary, null);
  assert.deepEqual(preview.rowErrors, [{ ordinal: 1, field: 'occurredAt', code: 'invalid-time' },
    { ordinal: 2, field: 'occurredAt', code: 'invalid-time' },
    { ordinal: 3, field: 'occurredAt', code: 'invalid-time' },
    { ordinal: 4, field: 'quantity', code: 'invalid-quantity' }]);
  assert.equal(preview.rows.length, 5);
  await unchanged(source, () => svc.csv.confirm(fx.owner, account, batch.batchId, { ...input,
    requestId: randomUUID(), expectedJournalRevision: 0, parserVersion: 'usd-csv-v1',
    previewHash: 'a'.repeat(64) }), 409); // existing CSV-003 mapping of a refused confirm
  const { feeIncludedInGross: _fee, ...noFee } = input;
  for (const refused of [noFee, { ...input, mapping: { ...input.mapping, allRowsSide: 'sell' } },
    { ...input, mapping: { ...input.mapping, allRowsSide: undefined } },
    { ...input, mapping: { ...input.mapping, columns: { ...input.mapping.columns, side: 3 },
      sides: [{ source: 'USDT', side: 'buy' }] } },
    { ...input, format: { ...input.format, fixedOffset: '+03:00' } },
    // Every column except order, outside date mode: only the order rule refuses it.
    { format: { delimiter: '\t', decimalSeparator: ',', timestampMode: 'fixed-offset',
      fixedOffset: '+00:00' }, assertUsd: true, mapping: { instruments: input.mapping.instruments,
      columns: { ...input.mapping.columns, side: 3, feeUsd: 4 }, sides: [{ source: 'USDT', side: 'buy' }] } }])
    await unchanged(source, () => svc.csv.preview(fx.owner, account, batch.batchId, refused), 400);
  assert.equal(await fingerprint(source), before);
  console.log('PASS SHEET-INVALID / SHEET-EXPLICIT bad dates/amounts and missing companions refuse the whole batch without writes');
}

async function duplicates(source, svc, fx, imported) {
  stage = 'SHEET-DUPLICATE re-saved sheet cannot import twice until rollback';
  const { account, batch } = imported;
  const extra = withDate('20.06.2025', { 2: '0,005', 5: '500' });
  const copy = await upload(svc, fx.owner, account, tsv([sample, extra], '\n'), 'Покупки (2).tsv');
  assert.notEqual(copy.batchId, batch);
  const input = sheetSettings(fx.btc);
  const before = await fingerprint(source);
  const blocked = await svc.csv.preview(fx.owner, account, copy.batchId, input);
  assert.equal(blocked.canConfirm, false);
  assert.deepEqual(blocked.rowErrors, [{ ordinal: 1, field: 'occurredAt', code: 'matches-existing-trade' }]);
  assert.equal(blocked.rows[1].execution.grossUsd, '500');
  assert.equal(await fingerprint(source), before);
  const exact = await svc.csv.upload(fx.owner, account, { filename: 'другое имя.tsv', bytes: tsv([sample]) });
  assert.equal(exact.created, false); assert.equal(exact.value.batchId, batch);
  const review = (await svc.csv.detail(fx.owner, account, batch)).rollbackReview;
  assert.equal(review.eligible, true);
  await svc.csv.rollback(fx.owner, account, batch, { requestId: randomUUID(),
    expectedJournalRevision: review.journalRevision });
  const allowed = await svc.csv.preview(fx.owner, account, copy.batchId, input);
  assert.deepEqual(allowed.rowErrors, []);
  await confirm(svc, fx.owner, account, copy.batchId, input, allowed);
  console.log('PASS SHEET-DUPLICATE re-saved copy blocked by matches-existing-trade, exact bytes reuse the batch, rollback then allows the copy');
  return copy.batchId;
}

async function reconciliation(source, svc, fx, imported, copy) {
  stage = 'SHEET-RECON-SAMPLE app numbers match the sheet and manual price';
  const { account, batch } = imported;
  // A fresh account keeps the sample batch committed for the read.
  const recon = await journal(svc, fx.owner, 'Reconciled purchases');
  const stale = withDate('15.06.2025', { 8: '790,00', 10: '#DIV/0!' });
  const sheet = await upload(svc, fx.owner, recon, tsv([sample, stale]));
  const input = sheetSettings(fx.btc);
  await confirm(svc, fx.owner, recon, sheet.batchId, input,
    await svc.csv.preview(fx.owner, recon, sheet.batchId, input));
  const unpriced = await svc.csv.reconciliation(fx.owner, recon, sheet.batchId, reference);
  assert.equal(unpriced.rows[0].latestPrice, null); assert.equal(unpriced.rows[0].unrealizedPnlUsd, null);
  assert.equal(unpriced.totals.unrealizedPnlUsd, null);
  await svc.prices.set(fx.owner, fx.btc, { requestId: randomUUID(), expectedRevision: 0,
    observedAt: '2025-10-01T00:00:00Z', priceUsd: '84945', assertReviewed: true });
  const before = await fingerprint(source);
  const result = await svc.csv.reconciliation(fx.owner, recon, sheet.batchId, reference);
  assert.equal(await fingerprint(source), before, 'Reconciliation writes nothing');
  const [first, second] = result.rows;
  assert.equal(first.status, 'imported'); assert.equal(first.quantity, '0.00918359');
  assert.equal(first.costUsd, '1000');
  assert.deepEqual(first.checks.map((c) => [c.field, c.sheet, c.app, c.result]), [
    ['usdAmount', '1000', '1000', 'match'], ['rate', '108889,8786', '108889.8786', 'match'],
    ['currentValue', '780,1000526', '780.1000526', 'match'],
    ['difference', '-219,8999475', '-219.8999475', 'match'], ['returnPercent', '-21,99%', '-21.99', 'match']]);
  assert.deepEqual(first.latestPrice, { priceUsd: '84945', observedAt: '2025-10-01T00:00:00.000Z' });
  assert.equal(first.valueUsd, '780.10005255'); assert.equal(first.unrealizedPnlUsd, '-219.89994745');
  assert.equal(first.unrealizedReturnPercent, '-21.99');
  console.log('PASS SHEET-RECON-SAMPLE 5/5 sheet cells match; manual 84945 gives value 780.10005255, P&L -219.89994745, -21.99%');

  stage = 'SHEET-RECON-MISMATCH stale and unreadable cells are counted';
  assert.deepEqual(second.checks.map((c) => [c.field, c.result]), [['usdAmount', 'match'], ['rate', 'match'],
    ['currentValue', 'mismatch'], ['difference', 'match'], ['returnPercent', 'unreadable']]);
  assert.deepEqual({ ...result.totals, costUsd: result.totals.costUsd }, { matchCount: 8, mismatchCount: 1,
    unreadableCount: 1, unavailableCount: 0, costUsd: '2000', unrealizedPnlUsd: '-439.7998949' });
  console.log('PASS SHEET-RECON-MISMATCH stale value mismatch and #DIV/0! unreadable are counted in totals');

  stage = 'SHEET-RECON-STATE state, scope and query refusals; corrected and voided rows';
  const draft = await upload(svc, fx.owner, recon, tsv([withDate('01.09.2025')]));
  await unchanged(source, () => svc.csv.reconciliation(fx.owner, recon, draft.batchId, reference), 409);
  await unchanged(source, () => svc.csv.reconciliation(fx.owner, account, batch, reference), 409);
  await unchanged(source, () => svc.csv.reconciliation(fx.other, recon, sheet.batchId, reference), 404);
  for (const query of [{}, { rate: '32' }, { rate: '1', difference: '1' }, { unknown: '1' }, { rate: '01' }])
    await unchanged(source, () => svc.csv.reconciliation(fx.owner, recon, sheet.batchId, query), 400);
  await unchanged(source, () => svc.csv.reconciliation(fx.owner, recon, sheet.batchId, { rate: '11' }), 400);
  const links = await source.query('SELECT ordinal,"tradeId" FROM account_csv_import_rows WHERE "batchId"=$1 ORDER BY ordinal', [sheet.batchId]);
  const revision = async () => (await svc.trade.getJournal(fx.owner, recon)).journal.journalRevision;
  await svc.trade.correct(fx.owner, recon, links[0].tradeId, { requestId: randomUUID(),
    expectedJournalRevision: await revision(), ...purchase(fx.btc, '2025-06-13T00:00:00.000Z', 1, { grossUsd: '1001' }) });
  await svc.trade.void(fx.owner, recon, links[1].tradeId, { requestId: randomUUID(),
    expectedJournalRevision: await revision() });
  const changed = await svc.csv.reconciliation(fx.owner, recon, sheet.batchId, reference);
  assert.equal(changed.rows[0].status, 'modified'); assert.equal(changed.rows[0].costUsd, '1001');
  assert.equal(changed.rows[0].checks[0].result, 'mismatch');
  assert.equal(changed.rows[1].status, 'voided'); assert.equal(changed.rows[1].costUsd, null);
  assert.deepEqual(changed.rows[1].checks, []);
  assert.equal(changed.totals.costUsd, '1001');
  assert.ok(copy);
  console.log('PASS SHEET-RECON-STATE draft/rolled-back 409, foreign 404, bad query 400; corrected row modified, voided row without app values');
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
  assert.equal(migrated.status, 0, 'Explicit migration CLI must succeed');
  const source = productionSource(); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const names = (await source.query('SELECT name FROM migrations')).map((row) => row.name);
    assert.ok(names.includes('AddUsdCsvImports1790050000000') && names.includes('AddManualUsdPrices1790080000000'));
    const svc = services(source);
    const fx = await seed(source, svc);
    const imported = await sampleImport(source, svc, fx);
    await sameDay(source, svc, fx);
    await explicitAndInvalid(source, svc, fx);
    const copy = await duplicates(source, svc, fx, imported);
    await reconciliation(source, svc, fx, imported, copy);
    console.log('PASS isolated Excel purchase-sheet import and reconciliation against actual services and PostgreSQL');
  } finally { await source.destroy(); }
}

const watchdog = setTimeout(() => {
  console.error(`FAIL bounded Excel import fixture at stage: ${stage}`);
  process.exit(1);
}, 120000);
watchdog.unref();
main().catch((error) => {
  console.error(`FAIL isolated Excel import database acceptance at stage: ${stage}`);
  if (process.env.SHEET_PROBE_DEBUG === '1') console.error(error);
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
