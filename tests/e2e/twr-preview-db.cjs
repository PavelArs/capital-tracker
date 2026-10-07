'use strict';
// Actual compiled services, isolated fresh PostgreSQL and real concurrent queries.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { PortfolioFlowService } = require('/app/backend/dist/accounting/portfolio-flow.service.js');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_twr_e2e';
const from = '2025-01-01T00:00:00.000Z';
const middle = '2025-07-01T00:00:00.000Z';
const to = '2026-01-01T00:00:00.000Z';
const input = { from, to, openingValueUsd: '0', closingValueUsd: '1100', assertReviewed: true };
const origin = () => ({ requestId: randomUUID(), coverageFrom: from, assertReviewed: true });
const command = (revision, amountUsd, occurredAt = from, direction = 'contribution') => ({ requestId: randomUUID(), expectedJournalRevision: revision, direction, occurredAt, amountUsd, assertExternal: true });
function sourceFor(statements) {
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  if (statements) {
    options.logging = ['query'];
    options.logger = { logQuery: query => statements.push(query), logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} };
  }
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
async function fingerprint(source) {
  const rows = [];
  for (const { tablename } of await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")) {
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([tablename, await source.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function providers() {
  const response = await fetch('http://providers:8080/__control/requests');
  assert.equal(response.status, 200);
  return response.json();
}
const refusal = (action, code) => assert.rejects(action, error => error?.getStatus?.() === code);
async function checkedRead(source, statements, action) {
  const before = await fingerprint(source);
  const outbound = await providers();
  const start = statements.length;
  const result = await action();
  const queries = statements.slice(start);
  assert.equal(queries.filter(sql => /START TRANSACTION/.test(sql)).length, 1);
  assert.ok(queries.some(sql => /REPEATABLE READ/.test(sql)));
  assert.ok(queries.some(sql => /SET TRANSACTION READ ONLY/.test(sql)));
  assert.ok(queries.some(sql => sql === 'COMMIT'));
  assert.ok(!queries.some(sql => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE)\b/i.test(sql)));
  assert.equal(await fingerprint(source), before, 'Every database row remains unchanged');
  assert.deepEqual(await providers(), outbound);
  return result;
}
function available(result, rate, percent) {
  assert.equal(result.twr.status, 'available');
  assert.equal(result.twr.reason, null);
  assert.equal(result.twr.periodRate, rate);
  assert.equal(result.twr.periodPercent, percent);
  assert.equal(result.twr.method, 'endpoint-ratio-UTC-ms');
  assert.equal(result.twr.rateRoundingBound, '0.0000000000005');
  assert.equal(result.twr.interiorNetFlowDateCount, 0);
}
async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic settings required');
  assert.equal(typeof PortfolioFlowService.prototype.previewTwr, 'function', 'PREREQUISITE implementation missing; not behavioral RED');
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    const identity = (await admin.query('SELECT current_database() AS name, current_user AS role')).rows[0];
    assert.equal(identity.name, settings.DB_NAME);
    assert.equal(identity.role, settings.DB_USERNAME);
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0, 'Never reuse/drop an existing database');
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
    assert.equal((await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 36);
    const owners = {};
    for (const label of ['period', 'empty', 'foreign', 'wide']) {
      owners[label] = (await source.query('INSERT INTO users(email,password,"emailVerified") VALUES($1,$2,true) RETURNING id', [`twr-${label}@example.invalid`, 'synthetic-not-a-login-hash']))[0].id;
    }
    const flows = new PortfolioFlowService(source);
    let before = await fingerprint(source);
    await refusal(() => flows.previewTwr(owners.empty, input), 409);
    assert.equal(await fingerprint(source), before);
    for (const owner of Object.values(owners)) await flows.initialize(owner, origin());
    before = await fingerprint(source);
    await refusal(() => flows.previewTwr(owners.empty, { ...input, from: '2024-12-31T23:59:59.999Z' }), 409);
    await refusal(() => flows.previewTwr(owners.empty, { ...input, openingValueUsd: 1000 }), 400);
    assert.equal(await fingerprint(source), before);
    const empty = await checkedRead(source, statements, () => flows.previewTwr(owners.empty, input));
    assert.equal(empty.twr.reason, 'nonpositive-opening-capital');
    assert.equal(empty.twr.periodRate, null);
    assert.equal(empty.twr.periodPercent, null);
    console.log('PASS TWR-COVERAGE/PRIVATE missing coverage, invalid input and unchanged complete database');

    const first = (await flows.create(owners.period, command(0, '1000'))).value.flow;
    let revision = 1;
    // More than a default page, same-ms cancellation with one corrected/voided head.
    for (let i = 0; i < 30; i++) {
      await flows.create(owners.period, command(revision++, '1', middle));
      await flows.create(owners.period, command(revision++, '1', middle, 'withdrawal'));
    }
    const corrected = (await flows.create(owners.period, command(revision++, '7', middle))).value.flow;
    await flows.correct(owners.period, corrected.flowId, command(revision++, '8', middle));
    await flows.void(owners.period, corrected.flowId, { requestId: randomUUID(), expectedJournalRevision: revision++ });
    await flows.create(owners.period, command(revision++, '777', to));
    await flows.create(owners.foreign, command(0, '999', middle));
    const baseline = await checkedRead(source, statements, () => flows.previewTwr(owners.period, input));
    available(baseline, '0.1', '10');
    assert.equal(baseline.journalRevision, revision);
    assert.equal(baseline.twr.startingCapitalUsd, '1000');
    assert.equal(baseline.flows.flowCount, 61);
    assert.equal(baseline.flows.contributionsUsd, '1030');
    assert.equal(baseline.flows.withdrawalsUsd, '30');
    assert.equal(baseline.profitUsd, '100');
    assert.equal((await flows.list(owners.period, { from, to })).items.length, 50);
    const { twr, ...profit } = baseline;
    assert.deepEqual(profit, await flows.previewProfit(owners.period, input));
    console.log('PASS TWR-ENDPOINT/EXACT complete heads, same-ms cancellation, upper boundary and foreign isolation');

    // Delay only delivery of a real query after its RR snapshot was established.
    const writerPid = (await source.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    const readerPid = (await reader.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    assert.notEqual(readerPid, writerPid);
    const originalRunner = reader.createQueryRunner.bind(reader);
    let reached, release, paused = false, committed = false;
    const barrier = new Promise(resolve => { reached = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    reader.createQueryRunner = (...args) => {
      const runner = originalRunner(...args);
      const query = runner.query.bind(runner);
      runner.query = async (...params) => {
        const result = await query(...params);
        if (!paused && /^SELECT \* FROM portfolio_flow_journals/.test(params[0])) { paused = true; reached(); await resume; }
        if (params[0] === 'COMMIT') committed = true;
        return result;
      };
      return runner;
    };
    const concurrent = new PortfolioFlowService(reader).previewTwr(owners.period, input);
    concurrent.catch(() => {});
    try {
      await barrier;
      // Changing an opening contribution to an interior one must change availability.
      await flows.correct(owners.period, first.flowId, command(revision++, '1000', middle));
      const afterWriter = await fingerprint(source);
      const providerBefore = await providers();
      release();
      assert.deepEqual(await concurrent, baseline, 'Original coherent TWR and profit snapshot');
      assert.equal(committed, true);
      assert.equal(await fingerprint(source), afterWriter, 'Paused reader performs no writes');
      assert.deepEqual(await providers(), providerBefore);
    } finally { release(); await concurrent; reader.createQueryRunner = originalRunner; }
    const next = await checkedRead(source, statements, () => flows.previewTwr(owners.period, input));
    assert.equal(next.journalRevision, revision);
    assert.equal(next.profitUsd, '100');
    assert.equal(next.twr.startingCapitalUsd, '0');
    assert.equal(next.twr.interiorNetFlowDateCount, 1);
    assert.equal(next.twr.reason, 'missing-flow-boundary-valuations');
    assert.equal(next.twr.periodRate, null);
    assert.equal(next.twr.periodPercent, null);
    await flows.void(owners.period, first.flowId, { requestId: randomUUID(), expectedJournalRevision: revision++ });
    const voided = await checkedRead(source, statements, () => flows.previewTwr(owners.period, { ...input, openingValueUsd: '1000' }));
    available(voided, '0.1', '10');
    console.log('PASS TWR-SNAPSHOT real separate PostgreSQL PIDs, committed correction, old/new availability and void');

    // Valid maximum-size journal fixture: no HTTP repetition and no false pagination limit.
    await source.transaction(async manager => {
      await manager.query(`INSERT INTO portfolio_flow_versions ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,"occurredAt","amountUsd","previousVersion")
        SELECT $1,gen_random_uuid(),1,i,gen_random_uuid(),'synthetic-wide','create','contribution',$2,1,NULL FROM generate_series(1,1000) i`, [owners.wide, from]);
      await manager.query('UPDATE portfolio_flow_journals SET "currentRevision"=1000 WHERE "ownerId"=$1', [owners.wide]);
    });
    const wide = await checkedRead(source, statements, () => flows.previewTwr(owners.wide, input));
    available(wide, '0.1', '10');
    assert.equal(wide.flows.flowCount, 1000);
    console.log('PASS TWR-BOUND all1000 heads and all-row/provider preservation');
  } finally {
    if (reader.isInitialized) await reader.destroy();
    if (source.isInitialized) await source.destroy();
  }
}
const watchdog = setTimeout(() => { console.error('FAIL TWR PG watchdog'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
