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
const database = 'capital_tracker_linked_twr_e2e';
const from = '2025-01-01T00:00:00.000Z';
const middle = '2025-07-01T00:00:00.000Z';
const later = '2025-08-01T00:00:00.000Z';
const to = '2026-01-01T00:00:00.000Z';
const input = { from, to, openingValueUsd: '1000', closingValueUsd: '2310', assertReviewed: true, expectedJournalRevision: 1, boundaryValuations: [{ at: middle, valueBeforeUsd: '1100' }] };
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
  assert.equal(result.linkedTwr.status, 'available');
  assert.equal(result.linkedTwr.reason, null);
  assert.equal(result.linkedTwr.periodRate, rate);
  assert.equal(result.linkedTwr.periodPercent, percent);
  assert.equal(result.linkedTwr.method, 'geometrically-linked-UTC-ms');
  assert.equal(result.linkedTwr.rateRoundingBound, '0.0000000000005');
}
async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic settings required');
  assert.equal(typeof PortfolioFlowService.prototype.previewLinkedTwr, 'function', 'PREREQUISITE implementation missing; not behavioral RED');
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
    assert.equal((await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 25);
    const owners = {};
    for (const label of ['period', 'empty', 'foreign', 'wide', 'capacity']) {
      owners[label] = (await source.query('INSERT INTO users(email,password,"emailVerified") VALUES($1,$2,true) RETURNING id', [`linked-twr-${label}@example.invalid`, 'synthetic-not-a-login-hash']))[0].id;
    }
    const flows = new PortfolioFlowService(source);
    let before = await fingerprint(source);
    await refusal(() => flows.twrBoundaries(owners.empty, { from, to }), 409);
    await refusal(() => flows.previewLinkedTwr(owners.empty, input), 409);
    assert.equal(await fingerprint(source), before);
    for (const owner of Object.values(owners)) await flows.initialize(owner, origin());
    before = await fingerprint(source);
    await refusal(() => flows.twrBoundaries(owners.empty, { from: '2024-12-31T23:59:59.999Z', to }), 409);
    await refusal(() => flows.previewLinkedTwr(owners.empty, { ...input, openingValueUsd: 1000 }), 400);
    assert.equal(await fingerprint(source), before);
    const empty = await checkedRead(source, statements, () => flows.twrBoundaries(owners.empty, { from, to }));
    assert.equal(empty.journalRevision, 0);
    assert.deepEqual(empty.boundaries, []);
    console.log('PASS LTWR-COVERAGE covered empty plan, invalid input and all-row/provider preservation');

    const first = (await flows.create(owners.period, command(0, '1000', middle))).value.flow;
    let revision = 1;
    for (let i = 0; i < 30; i++) {
      await flows.create(owners.period, command(revision++, '1', later));
      await flows.create(owners.period, command(revision++, '1', later, 'withdrawal'));
    }
    const corrected = (await flows.create(owners.period, command(revision++, '7', later))).value.flow;
    await flows.correct(owners.period, corrected.flowId, command(revision++, '8', later));
    await flows.void(owners.period, corrected.flowId, { requestId: randomUUID(), expectedJournalRevision: revision++ });
    await flows.create(owners.period, command(revision++, '777', to));
    await flows.create(owners.foreign, command(0, '999', later));
    const plan = await checkedRead(source, statements, () => flows.twrBoundaries(owners.period, { from, to }));
    assert.deepEqual(plan, { from, to, coverageFrom: from, journalRevision: revision, basis: 'owner-declared-usd-flows', completeness: 'unreconciled', boundaryLimit: 32, netFlowAtStartUsd: '0', interiorNetFlowDateCount: 1, status: 'ready', reason: null, boundaries: [{ at: middle, netFlowUsd: '1000' }] });
    const reviewed = { ...input, expectedJournalRevision: plan.journalRevision };
    const baseline = await checkedRead(source, statements, () => flows.previewLinkedTwr(owners.period, reviewed));
    available(baseline, '0.21', '21');
    assert.equal(baseline.journalRevision, revision);
    assert.equal(baseline.flows.flowCount, 61);
    assert.equal(baseline.flows.contributionsUsd, '1030');
    assert.equal(baseline.flows.withdrawalsUsd, '30');
    assert.equal(baseline.profitUsd, '310');
    assert.deepEqual(baseline.linkedTwr.boundaries, [{ at: middle, netFlowUsd: '1000', valueBeforeUsd: '1100', valueAfterUsd: '2100' }]);
    assert.equal((await flows.list(owners.period, { from, to })).items.length, 50);
    const { linkedTwr, ...profit } = baseline;
    const { expectedJournalRevision, boundaryValuations, ...profitInput } = reviewed;
    assert.deepEqual(profit, await flows.previewProfit(owners.period, profitInput));
    const missing = await checkedRead(source, statements, () => flows.previewLinkedTwr(owners.period, { ...reviewed, boundaryValuations: [] }));
    assert.equal(missing.linkedTwr.reason, 'missing-flow-boundary-valuations');
    assert.equal(missing.linkedTwr.periodRate, null);
    assert.equal(missing.linkedTwr.periodPercent, null);
    assert.deepEqual(missing.linkedTwr.boundaries, [{ at: middle, netFlowUsd: '1000', valueBeforeUsd: null, valueAfterUsd: null }]);
    before = await fingerprint(source);
    await refusal(() => flows.previewLinkedTwr(owners.period, { ...reviewed, boundaryValuations: [{ at: later, valueBeforeUsd: '1100' }] }), 400);
    assert.equal(await fingerprint(source), before);
    console.log('PASS LTWR-LINK complete effective heads,21percent/profit310, missing/extraneous valuations, owner isolation');

    // Pause delivery after a real SELECT establishes the reader snapshot; write on another PID.
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
    const concurrent = new PortfolioFlowService(reader).previewLinkedTwr(owners.period, reviewed);
    concurrent.catch(() => {});
    try {
      await barrier;
      await flows.correct(owners.period, first.flowId, command(revision++, '1000', later));
      const afterWriter = await fingerprint(source);
      const providerBefore = await providers();
      release();
      assert.deepEqual(await concurrent, baseline, 'Original coherent linked return/profit/revision');
      assert.equal(committed, true);
      assert.equal(await fingerprint(source), afterWriter);
      assert.deepEqual(await providers(), providerBefore);
    } finally { release(); await concurrent; reader.createQueryRunner = originalRunner; }
    before = await fingerprint(source);
    await refusal(() => flows.previewLinkedTwr(owners.period, reviewed), 409); // stale before old boundary becomes extraneous
    assert.equal(await fingerprint(source), before);
    const nextPlan = await checkedRead(source, statements, () => flows.twrBoundaries(owners.period, { from, to }));
    assert.equal(nextPlan.journalRevision, revision);
    assert.deepEqual(nextPlan.boundaries, [{ at: later, netFlowUsd: '1000' }]);
    const next = await checkedRead(source, statements, () => flows.previewLinkedTwr(owners.period, { ...reviewed, expectedJournalRevision: revision, boundaryValuations: [{ at: later, valueBeforeUsd: '1100' }] }));
    available(next, '0.21', '21');
    console.log('PASS LTWR-SNAPSHOT separate PostgreSQL PIDs, committed correction, old coherent snapshot,409 and new plan');

    // Real bounded journal: full1000 heads at one instant. No API repetition or paging assumption.
    await source.transaction(async manager => {
      await manager.query(`INSERT INTO portfolio_flow_versions ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,"occurredAt","amountUsd","previousVersion")
        SELECT $1,gen_random_uuid(),1,i,gen_random_uuid(),'synthetic-wide','create','contribution',$2,1,NULL FROM generate_series(1,1000) i`, [owners.wide, middle]);
      await manager.query('UPDATE portfolio_flow_journals SET "currentRevision"=1000 WHERE "ownerId"=$1', [owners.wide]);
    });
    const widePlan = await checkedRead(source, statements, () => flows.twrBoundaries(owners.wide, { from, to }));
    assert.equal(widePlan.journalRevision, 1000);
    assert.deepEqual(widePlan.boundaries, [{ at: middle, netFlowUsd: '1000' }]);
    const wide = await checkedRead(source, statements, () => flows.previewLinkedTwr(owners.wide, { ...input, expectedJournalRevision: 1000 }));
    available(wide, '0.21', '21');
    assert.equal(wide.flows.flowCount, 1000);
    for (let i = 0; i < 32; i++) await flows.create(owners.capacity, command(i, '100', new Date(Date.parse(middle) + i).toISOString(), 'withdrawal'));
    const capPlan = await checkedRead(source, statements, () => flows.twrBoundaries(owners.capacity, { from, to }));
    assert.equal(capPlan.status, 'ready');
    assert.equal(capPlan.boundaries.length, 32);
    const capInput = { ...input, openingValueUsd: '100', closingValueUsd: '200', expectedJournalRevision: 32, boundaryValuations: capPlan.boundaries.map(({ at }) => ({ at, valueBeforeUsd: '200' })) };
    available(await checkedRead(source, statements, () => flows.previewLinkedTwr(owners.capacity, capInput)), '8589934591', '858993459100');
    await flows.create(owners.capacity, command(32, '100', new Date(Date.parse(middle) + 32).toISOString(), 'withdrawal'));
    for (const result of [
      await checkedRead(source, statements, () => flows.twrBoundaries(owners.capacity, { from, to })),
      (await checkedRead(source, statements, () => flows.previewLinkedTwr(owners.capacity, { ...capInput, expectedJournalRevision: 33 }))).linkedTwr,
    ]) {
      assert.equal(result.status, 'unavailable');
      assert.equal(result.reason, 'too-many-boundaries');
      assert.equal(result.interiorNetFlowDateCount, 33);
      assert.deepEqual(result.boundaries, []);
    }
    console.log('PASS LTWR-BOUND all1000 heads,32 linked boundaries,33 unavailable without truncation');
  } finally {
    if (reader.isInitialized) await reader.destroy();
    if (source.isInitialized) await source.destroy();
  }
}
const watchdog = setTimeout(() => { console.error('FAIL LTWR PG watchdog'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
