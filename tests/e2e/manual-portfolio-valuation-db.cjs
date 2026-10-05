'use strict';
// Only fresh synthetic PostgreSQL; production compiled services and actual queries.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_manual_portfolio_e2e';
const at = '2025-01-04T00:00:00.000Z';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/manual-portfolio-valuation.service.js';
let stage = 'synthetic configuration';

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
    trades: make('trade.service', 'TradeService'), prices: make('manual-price.service', 'ManualPriceService'),
    portfolio: make('manual-portfolio-valuation.service', 'ManualPortfolioValuationService') };
}
async function fingerprint(db) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([tablename, await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function providerRequests() {
  const response = await fetch('http://providers:8080/__control/requests');
  assert.equal(response.status, 200);
  return response.json();
}
const rejected = (action, status) => assert.rejects(async () => action(), (error) => error.getStatus?.() === status);
async function account(s, owner, name, start = coverageFrom) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (start) await s.trades.initialize(owner, id, { requestId: randomUUID(), coverageFrom: start, assertEmpty: true });
  return id;
}
const execution = (instrumentId, revision, quantity = '1') => ({ requestId: randomUUID(),
  expectedJournalRevision: revision, instrumentId, side: 'buy', occurredAt: at,
  orderWithinTimestamp: revision, quantity, grossUsd: '100', feeUsd: '0' });
const quote = (revision, priceUsd, observedAt = at) => ({ requestId: randomUUID(),
  expectedRevision: revision, observedAt, priceUsd, assertReviewed: true });
const read = (s, owner, accountIds, instant = at) => s.portfolio.preview(owner, { at: instant, accountIds }, {});
const row = (report, id) => report.accounts.find((entry) => entry.accountId === id);

async function exactGapsAndPrivacy(db, s, f) {
  stage = 'MPV-EXACT/GAPS/PRIVATE shared identity, coverage, owner isolation and no mutation';
  const { owner, other, first, second } = f;
  const a = await account(s, owner, '<script>literal first</script>');
  const b = await account(s, owner, 'Second');
  const unknown = await account(s, owner, 'No journal', null);
  const future = await account(s, owner, 'Later coverage', '2026-01-01T00:00:00.000Z');
  const empty = await account(s, owner, 'Known empty');
  const foreign = await account(s, other, 'Foreign');
  await s.trades.create(owner, a, execution(first, 0, '0.5'));
  await s.trades.create(owner, b, execution(first, 0, '2'));
  await s.prices.set(owner, first, quote(0, '123.456'));
  const before = await fingerprint(db);
  const providers = await providerRequests();
  const value = await read(s, owner, [b, a]);
  assert.deepEqual(Object.keys(value).sort(), ['at','accountIds','scope','basis','priceSource','quoteCurrency',
    'pricePolicy','completeness','unavailableAccountCount','missingPriceCount','pricedSubtotalUsd','totalValueUsd',
    'unknownCostCount','unrealizedPnlUsd','unrealizedReturnPercent','accounts'].sort());
  assert.deepEqual(value.accountIds, [a, b].sort());
  assert.deepEqual(value.accounts.map((entry) => entry.accountId), [a, b].sort());
  assert.equal(value.scope, 'selected-manual-accounts');
  assert.equal(value.basis, 'current-effective-history');
  assert.equal(value.priceSource, 'manual');
  assert.equal(value.pricePolicy, 'exact-instant');
  assert.equal(value.quoteCurrency, 'USD');
  assert.equal(value.at, at);
  assert.equal(value.totalValueUsd, '308.64');
  assert.equal(value.pricedSubtotalUsd, '308.64');
  assert.equal(value.completeness, 'complete');
  assert.equal(value.unavailableAccountCount, 0);
  assert.equal(value.missingPriceCount, 0);
  assert.equal(row(value, a).totalValueUsd, '61.728');
  assert.equal(row(value, b).totalValueUsd, '246.912');
  assert.equal(value.unrealizedPnlUsd, '108.64');
  assert.equal(value.unrealizedReturnPercent, '54.32');
  assert.equal(row(value, a).unrealizedPnlUsd, '-38.272');
  assert.equal(row(value, a).unrealizedReturnPercent, '-38.27');
  assert.equal(row(value, b).items[0].unrealizedPnlUsd, '146.912');
  assert.equal(row(value, b).items[0].unrealizedReturnPercent, '146.91');
  assert.equal(row(value, a).journalRevision, 1);
  assert.equal(row(value, a).coverageFrom, coverageFrom);
  assert.equal(row(value, a).name, '<script>literal first</script>');
  assert.deepEqual(row(value, a).items[0].price, { priceUsd: '123.456', observedAt: at, revision: 1 });
  assert.deepEqual(await read(s, owner, [a, b]), value, 'Selection ordering does not change output');
  const gaps = await read(s, owner, [a, b, unknown, future, empty]);
  assert.equal(gaps.totalValueUsd, null);
  assert.equal(gaps.unrealizedPnlUsd, null);
  assert.equal(row(gaps, a).unrealizedPnlUsd, '-38.272');
  assert.equal(gaps.pricedSubtotalUsd, '308.64');
  assert.equal(gaps.unavailableAccountCount, 2);
  assert.equal(gaps.missingPriceCount, 0);
  for (const id of [unknown, future]) {
    assert.equal(row(gaps, id).completeness, 'incomplete');
    assert.equal(row(gaps, id).totalValueUsd, null);
    assert.equal(row(gaps, id).pricedSubtotalUsd, null);
    assert.equal(row(gaps, id).missingPriceCount, null);
    assert.equal(row(gaps, id).unrealizedPnlUsd, null);
    assert.deepEqual(row(gaps, id).items, []);
  }
  assert.equal(row(gaps, unknown).coverage, 'missing-journal');
  assert.equal(row(gaps, unknown).coverageFrom, null);
  assert.equal(row(gaps, unknown).journalRevision, null);
  assert.equal(row(gaps, future).coverage, 'before-coverage');
  assert.equal(row(gaps, future).coverageFrom, '2026-01-01T00:00:00.000Z');
  assert.equal(row(gaps, future).journalRevision, 0);
  assert.equal(row(gaps, empty).totalValueUsd, '0');
  assert.equal((await read(s, owner, [empty])).totalValueUsd, '0');
  await rejected(() => read(s, owner, [a, foreign]), 404);
  await rejected(() => read(s, owner, [a, randomUUID()]), 404);
  await rejected(() => read(s, other, [a, b]), 404);
  await rejected(() => read(s, owner, [a, a.toUpperCase()]), 400);
  await rejected(() => s.portfolio.preview(owner, { at, accountIds: [a], extra: true }, {}), 400);
  await rejected(() => s.portfolio.preview(owner, { at, accountIds: [a] }, { url: 'https://example.invalid' }), 400);
  assert.equal(await fingerprint(db), before, 'Every successful/refused read preserves all rows');
  assert.deepEqual(await providerRequests(), providers, 'Reads never call any provider');

  await s.trades.create(owner, b, execution(second, 1, '1'));
  await s.prices.set(owner, second, quote(0, '999', '2025-01-03T23:59:59.999Z'));
  const missing = await read(s, owner, [a, b]);
  assert.equal(missing.totalValueUsd, null);
  assert.equal(missing.pricedSubtotalUsd, '308.64');
  assert.equal(missing.missingPriceCount, 1);
  assert.equal(row(missing, b).items.find((position) => position.instrumentId === second).price, null,
    'Same symbol or adjacent timestamp never substitutes for the exact UUID point');
  await s.prices.set(owner, second, quote(1, '0'));
  assert.equal((await read(s, owner, [a, b])).totalValueUsd, '308.64');
  await s.prices.void(owner, first, { requestId: randomUUID(), expectedRevision: 1, observedAt: at, assertReviewed: true });
  const voided = await read(s, owner, [a, b]);
  assert.equal(voided.totalValueUsd, null);
  assert.equal(voided.pricedSubtotalUsd, '0');
  assert.equal(voided.missingPriceCount, 2, 'Count covered account-position gaps, not unique symbols');
  console.log('PASS MPV-EXACT/GAPS/PRIVATE');
}

async function coherent(db, s, f) {
  stage = 'MPV-SNAPSHOT one RR across two account corrections and a shared price';
  const { owner, first } = f;
  const a = await account(s, owner, 'Snapshot A');
  const b = await account(s, owner, 'Snapshot B');
  const buyA = await s.trades.create(owner, a, execution(first, 0, '1'));
  const buyB = await s.trades.create(owner, b, execution(first, 0, '2'));
  await s.prices.set(owner, first, quote(2, '10'));
  const old = await read(s, owner, [a, b]);
  assert.equal(old.totalValueUsd, '30');
  const reader = source();
  await reader.initialize();
  let release, arrived, pending;
  const gate = new Promise((resolve) => { release = resolve; });
  const barrier = new Promise((resolve) => { arrived = resolve; });
  const statements = [];
  const createRunner = reader.createQueryRunner.bind(reader);
  let paused = false;
  reader.createQueryRunner = (...args) => {
    const runner = createRunner(...args);
    const query = runner.query.bind(runner);
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
  try {
    pending = read(services(reader), owner, [a, b]);
    const timeout = setTimeout(() => release(), 10000);
    try {
      const readerPid = await Promise.race([barrier, pending.then(() => { throw new Error('Missing actual read barrier'); })]);
      const [{ pid: writerPid }] = await db.query('SELECT pg_backend_pid() AS pid');
      assert.notEqual(readerPid, writerPid);
      assert.ok(statements.some((sql) => /REPEATABLE READ/.test(sql)));
      assert.ok(statements.some((sql) => /READ ONLY/.test(sql)));
      await s.trades.correct(owner, a, buyA.value.trade.tradeId, execution(first, 1, '3'));
      await s.trades.correct(owner, b, buyB.value.trade.tradeId, execution(first, 1, '4'));
      await s.prices.set(owner, first, quote(3, '20'));
      const saved = await fingerprint(db);
      release();
      assert.deepEqual(await pending, old, 'No cross-account or quantity/price mixing');
      const current = await read(s, owner, [a, b]);
      assert.equal(current.totalValueUsd, '140');
      assert.deepEqual(current.accounts.map((entry) => entry.journalRevision), [2, 2]);
      assert.equal(statements.filter((sql) => /FROM manual_usd_price_versions/.test(sql)).length, 1,
        'One union price read inside the shared snapshot');
      assert.equal(await fingerprint(db), saved);
    } finally { clearTimeout(timeout); }
  } finally { release(); await pending?.catch(() => {}); await reader.destroy(); }
  console.log('PASS MPV-SNAPSHOT');
}

async function precisionBoundAndInvalidHistory(db, s, f) {
  stage = 'MPV-PRECISION/BOUND scale60, ten selected accounts and invalid saved FIFO';
  const { owner } = f;
  const tiny = (await s.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Tiny' })).value.id;
  const atom = '0.000000000000000000000000000001';
  const ids = [];
  for (let i = 0; i < 11; i++) ids.push(await account(s, owner, `Bound ${i}`));
  for (const id of ids.slice(0, 2)) await s.trades.create(owner, id, execution(tiny, 0, atom));
  await s.prices.set(owner, tiny, quote(0, atom));
  const before = await fingerprint(db);
  const start = Date.now();
  const result = await read(s, owner, ids.slice(0, 10));
  const elapsed = Date.now() - start;
  assert.equal(result.accounts.length, 10);
  assert.equal(result.totalValueUsd, `0.${'0'.repeat(59)}2`);
  await rejected(() => read(s, owner, ids), 400);
  assert.equal(await fingerprint(db), before);
  await db.query(`UPDATE account_trade_versions SET side='sell' WHERE "ownerId"=$1 AND "accountId"=$2`, [owner, ids[0]]);
  try {
    const invalid = await fingerprint(db);
    await rejected(() => read(s, owner, [ids[0], ids[1]]), 409);
    assert.equal(await fingerprint(db), invalid, 'Invalid history is not hidden or repaired by preview');
  } finally {
    await db.query(`UPDATE account_trade_versions SET side='buy' WHERE "ownerId"=$1 AND "accountId"=$2`, [owner, ids[0]]);
  }
  assert.equal(await fingerprint(db), before, 'Synthetic corruption restored exactly');
  console.log(`PASS MPV-PRECISION/BOUND ten accounts/two positions ${elapsed}ms (observation, no SLA)`);
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact isolated settings required');
  assert.ok(require('node:fs').existsSync(modulePath), 'Missing implementation is prerequisite failure, not RED');
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0, 'Never reuse or drop an existing database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...settings, ...process.env, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(migrated.status, 0, 'Actual schema19 migration');
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 33);
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('manual-portfolio-owner@example.invalid','synthetic-not-a-hash',true),
      ('manual-portfolio-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const first = (await s.accounting.createInstrument(owner.id, { requestId: randomUUID(), name: 'First', symbol: 'SAME' })).value.id;
    const second = (await s.accounting.createInstrument(owner.id, { requestId: randomUUID(), name: 'Second', symbol: 'SAME' })).value.id;
    const f = { owner: owner.id, other: other.id, first, second };
    for (const check of [exactGapsAndPrivacy, coherent, precisionBoundAndInvalidHistory]) await check(db, s, f);
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 180000);
watchdog.unref();
main().catch((error) => { console.error(`FAIL ${stage}: ${error.message}`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
