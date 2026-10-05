'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const numerical = require('/app/backend/dist/accounting/xirr.js');
const realProjectXirr = numerical.projectXirr;
const observedRunners = [];
let solveEntries = 0;
// Observe entry, then execute the unchanged real numerical implementation.
// No query, calculation result or authentication response is replaced.
numerical.projectXirr = (...args) => {
  solveEntries++;
  assert.ok(observedRunners.every(runner => !runner.isTransactionActive && runner.isReleased), 'Every actual read transaction is released before numerical entry');
  return realProjectXirr(...args);
};
const { PortfolioFlowService } = require('/app/backend/dist/accounting/portfolio-flow.service.js');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_xirr_e2e';
const jan1 = '2025-01-01T00:00:00.000Z';
const jan2 = '2025-01-02T00:00:00.000Z';
const jan3 = '2025-01-03T00:00:00.000Z';
const jan4 = '2026-01-01T00:00:00.000Z';
const input = { from: jan1, to: jan4, openingValueUsd: '400', closingValueUsd: '1100', assertReviewed: true };
const origin = () => ({ requestId: randomUUID(), coverageFrom: jan1, assertReviewed: true });
const command = (revision, amountUsd, occurredAt = jan3, direction = 'contribution') => ({ requestId: randomUUID(), expectedJournalRevision: revision, direction, occurredAt, amountUsd, assertExternal: true });

function sourceFor(statements) {
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  if (statements) {
    options.logging = ['query'];
    options.logger = { logQuery: query => statements.push(query), logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} };
  }
  const source = new DataSource(options);
  const create = source.createQueryRunner.bind(source);
  source.createQueryRunner = (...args) => {
    const runner = create(...args);
    observedRunners.push(runner);
    return runner;
  };
  return source;
}
async function fingerprint(source, oldOnly = false) {
  const rows = [];
  for (const { tablename } of await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")) {
    assert.match(tablename, /^[a-z_]+$/);
    if (oldOnly && tablename.startsWith('portfolio_flow_')) continue;
    rows.push([tablename, await source.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function refusal(action, code) {
  await assert.rejects(action, error => error?.getStatus?.() === code);
}
async function checkedRead(source, statements, action) {
  const before = await fingerprint(source);
  const start = statements.length;
  const result = await action();
  const queries = statements.slice(start);
  assert.ok(queries.some(sql => /REPEATABLE READ/.test(sql)));
  assert.ok(queries.some(sql => /SET TRANSACTION READ ONLY/.test(sql)));
  assert.ok(!queries.some(sql => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE)\b/i.test(sql)));
  assert.equal(await fingerprint(source), before, 'Preview preserves every database row');
  return result;
}
async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic settings required');
  if (typeof PortfolioFlowService.prototype.previewXirr !== 'function') {
    console.error('PREREQUISITE XIRR implementation absent; not behavioral RED');
    process.exitCode = 2;
    return;
  }
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0, 'Never reuse or drop an existing database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(migrated.error, undefined);
  assert.equal(migrated.status, 0, migrated.stderr);
  const statements = [];
  const source = sourceFor(statements);
  const reader = sourceFor();
  try {
    await source.initialize();
    await reader.initialize();
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 27);
    const owners = {};
    for (const label of ['period', 'empty', 'foreign']) {
      const [row] = await source.query('INSERT INTO users(email,password,"emailVerified") VALUES($1,$2,true) RETURNING id', [`xirr-${label}@example.invalid`, 'synthetic-not-a-login-hash']);
      owners[label] = row.id;
    }
    const old = await fingerprint(source, true);
    const flows = new PortfolioFlowService(source);
    const beforeOrigin = await fingerprint(source);
    await refusal(() => flows.previewXirr(owners.empty, input), 409);
    assert.equal(await fingerprint(source), beforeOrigin);
    for (const owner of Object.values(owners)) await flows.initialize(owner, origin());
    await refusal(() => flows.previewXirr(owners.empty, { ...input, from: '2024-12-31T23:59:59.999Z' }), 409);
    await refusal(() => flows.previewXirr(owners.empty, { ...input, assertReviewed: false }), 400);
    const empty = await checkedRead(source, statements, () => flows.previewXirr(owners.empty, { ...input, openingValueUsd: '1000' }));
    assert.equal(empty.xirr.annualRate, '0.1', 'Busy slot releases after input/coverage failure');
    assert.equal(empty.profitUsd, '100');
    console.log('PASS XIRR-PRIVATE coverage/input refusal and release, real read-only snapshot');

    let first;
    for (let i = 0; i < 60; i++) {
      const receipt = await flows.create(owners.period, command(i, '10', jan1));
      if (!first) first = receipt.value.flow;
    }
    await flows.create(owners.period, command(60, '999', jan4));
    await flows.create(owners.foreign, command(0, '777777', jan1));
    const baseline = await checkedRead(source, statements, () => flows.previewXirr(owners.period, input));
    assert.equal(baseline.xirr.annualRate, '0.1');
    assert.equal(baseline.xirr.annualPercent, '10');
    assert.equal(baseline.xirr.cashFlowDateCount, 2);
    assert.equal(baseline.profitUsd, '100');
    assert.equal(baseline.flows.contributionsUsd, '600');
    assert.equal(baseline.flows.flowCount, 60);
    assert.equal(baseline.journalRevision, 61);
    const { xirr, ...profit } = baseline;
    assert.deepEqual(profit, await flows.previewProfit(owners.period, input), 'Unchanged profit contract and same snapshot base');
    assert.equal((await flows.list(owners.period, { from: jan1, to: jan4 })).items.length, 50);
    console.log('PASS XIRR-FLOWS complete >50 records, same-instant aggregation, upper boundary, foreign isolation and exact profit');

    // Instrument delivery only after the actual SELECT on a separate PostgreSQL pool.
    let reached;
    let resume;
    let paused = false;
    const barrier = new Promise(resolve => { reached = resolve; });
    const release = new Promise(resolve => { resume = resolve; });
    const originalRunner = reader.createQueryRunner.bind(reader);
    let committed = false;
    reader.createQueryRunner = (...args) => {
      const runner = originalRunner(...args);
      const query = runner.query.bind(runner);
      runner.query = async (...queryArgs) => {
        const result = await query(...queryArgs);
        if (!paused && /^SELECT \* FROM portfolio_flow_journals/.test(queryArgs[0])) { paused = true; reached(); await release; }
        if (queryArgs[0] === 'COMMIT') committed = true;
        return result;
      };
      return runner;
    };
    const busy = new PortfolioFlowService(reader);
    const pending = busy.previewXirr(owners.period, input);
    pending.catch(() => {});
    try {
      await barrier;
      await refusal(() => busy.previewXirr(owners.period, input), 429);
      await flows.correct(owners.period, first.flowId, command(61, '20', jan1));
      resume();
      const snapshot = await pending;
      assert.equal(committed, true, 'Actual RR transaction commits');
      assert.deepEqual(snapshot, baseline, 'Both rate and profit keep the old coherent snapshot');
      const next = await busy.previewXirr(owners.period, input);
      assert.equal(next.journalRevision, 62);
      assert.equal(next.profitUsd, '90');
      assert.ok(Math.abs(Number(next.xirr.annualRate) - 9 / 101) <= 1e-10, 'Rate-only oracle 1100/1010 - 1');
    } finally { resume(); await pending; reader.createQueryRunner = originalRunner; }
    await flows.void(owners.period, first.flowId, { requestId: randomUUID(), expectedJournalRevision: 62 });
    const voided = await checkedRead(source, statements, () => flows.previewXirr(owners.period, input));
    assert.equal(voided.flows.contributionsUsd, '590');
    assert.equal(voided.profitUsd, '110');
    assert.ok(Math.abs(Number(voided.xirr.annualRate) - 1 / 9) <= 1e-10);
    assert.equal(await fingerprint(source, true), old, 'No prior accounting/authentication rows changed');
    assert.equal(solveEntries, 5, 'Only empty, baseline, pending snapshot, corrected and voided previews enter the real solver');
    console.log('PASS XIRR-SNAPSHOT actual concurrent correction, per-instance429, coherent old snapshot, release and current correction/void');
  } finally {
    if (reader.isInitialized) await reader.destroy();
    if (source.isInitialized) await source.destroy();
  }
}
const watchdog = setTimeout(() => { console.error('FAIL XIRR PG watchdog'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
