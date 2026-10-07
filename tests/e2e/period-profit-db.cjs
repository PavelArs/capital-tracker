'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { PortfolioFlowService } = require('/app/backend/dist/accounting/portfolio-flow.service.js');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_profit_e2e';
const jan1 = '2025-01-01T00:00:00.000Z';
const jan2 = '2025-01-02T00:00:00.000Z';
const jan3 = '2025-01-03T00:00:00.000Z';
const jan4 = '2025-01-04T00:00:00.000Z';
const input = { from: jan2, to: jan4, openingValueUsd: '1000', closingValueUsd: '2000', assertReviewed: true };
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
  return new DataSource(options);
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
  if (typeof PortfolioFlowService.prototype.previewProfit !== 'function') {
    console.error('PREREQUISITE profit implementation absent; not behavioral RED');
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
    assert.equal((await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 37);
    const owners = {};
    for (const label of ['period', 'empty', 'reader', 'foreign', 'wide']) {
      const [row] = await source.query('INSERT INTO users(email,password,"emailVerified") VALUES($1,$2,true) RETURNING id', [`profit-${label}@example.invalid`, 'synthetic-not-a-login-hash']);
      owners[label] = row.id;
    }
    const old = await fingerprint(source, true);
    const flows = new PortfolioFlowService(source);
    const beforeOrigin = await fingerprint(source);
    await refusal(() => flows.previewProfit(owners.empty, input), 409);
    assert.equal(await fingerprint(source), beforeOrigin);
    for (const owner of Object.values(owners)) await flows.initialize(owner, origin());
    await refusal(() => flows.previewProfit(owners.empty, { ...input, from: '2024-12-31T23:59:59.999Z' }), 409);
    const empty = await checkedRead(source, statements, () => flows.previewProfit(owners.empty, input));
    assert.equal(empty.profitUsd, '1000');
    assert.equal(empty.flows.flowCount, 0);
    console.log('PASS PROFIT-COVERAGE covered empty periods and absent/before coverage refusal');

    let rev = 0;
    const add = (amount, at = jan3, direction = 'contribution') => flows.create(owners.period, command(rev++, amount, at, direction));
    await add('1000', jan2);
    const pages = [];
    for (let i = 0; i < 60; i++) pages.push((await add('1')).value.flow);
    await add('200', jan3, 'withdrawal');
    await add('7', jan1);
    await add('99', jan4);
    await flows.correct(owners.period, pages[0].flowId, command(rev++, '3'));
    await flows.void(owners.period, pages[1].flowId, { requestId: randomUUID(), expectedJournalRevision: rev++ });
    await flows.create(owners.foreign, command(0, '777777'));
    const period = await checkedRead(source, statements, () => flows.previewProfit(owners.period, input));
    assert.deepEqual(period, {
      from: jan2, to: jan4, coverageFrom: jan1, journalRevision: 66,
      basis: 'manual-usd-valuations', flowBasis: 'owner-declared-usd-flows', completeness: 'unreconciled',
      openingValueUsd: '1000', closingValueUsd: '2000', profitUsd: '139',
      flows: { contributionsUsd: '1061', withdrawalsUsd: '200', netContributionsUsd: '861', flowCount: 61 },
    });
    assert.equal((await flows.list(owners.period, { from: jan2, to: jan4 })).items.length, 50, 'Fixture exceeds default page');
    await flows.correct(owners.period, pages[0].flowId, command(rev++, '4'));
    assert.equal((await flows.previewProfit(owners.period, input)).profitUsd, '138');
    console.log('PASS PROFIT-PERIOD exact complete heads, boundary, correction, void, foreign isolation and row preservation');

    // Real PostgreSQL queries on two actual pools; pause only delivery after first SELECT.
    const first = (await flows.create(owners.reader, command(0, '1000', jan2))).value.flow;
    let reached;
    let resume;
    const barrier = new Promise(resolve => { reached = resolve; });
    const release = new Promise(resolve => { resume = resolve; });
    const originalRunner = reader.createQueryRunner.bind(reader);
    reader.createQueryRunner = (...args) => {
      const runner = originalRunner(...args);
      const query = runner.query.bind(runner);
      runner.query = async (...queryArgs) => {
        const result = await query(...queryArgs);
        if (/^SELECT \* FROM portfolio_flow_journals/.test(queryArgs[0])) { reached(); await release; }
        return result;
      };
      return runner;
    };
    const pending = new PortfolioFlowService(reader).previewProfit(owners.reader, input);
    pending.catch(() => {});
    try {
      await barrier;
      await flows.correct(owners.reader, first.flowId, command(1, '1200', jan2));
      resume();
      const snapshot = await pending;
      assert.equal(snapshot.journalRevision, 1);
      assert.equal(snapshot.flows.contributionsUsd, '1000');
      assert.equal(snapshot.profitUsd, '0');
      const next = await flows.previewProfit(owners.reader, input);
      assert.equal(next.journalRevision, 2);
      assert.equal(next.profitUsd, '-200');
    } finally { resume(); await pending; reader.createQueryRunner = originalRunner; }
    console.log('PASS PROFIT-SNAPSHOT actual two-connection repeatable read across committed correction');

    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    // Valid bounded fixture, bulk inserted to exercise all 1000 current heads without slow HTTP duplication.
    await source.transaction(async manager => {
      await manager.query(`INSERT INTO portfolio_flow_versions ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,"occurredAt","amountUsd","previousVersion")
        SELECT $1,gen_random_uuid(),1,i,gen_random_uuid(),'synthetic-wide','create','contribution',$2,$3,NULL FROM generate_series(1,1000) i`, [owners.wide, jan3, maximum]);
      await manager.query('UPDATE portfolio_flow_journals SET "currentRevision"=1000 WHERE "ownerId"=$1', [owners.wide]);
    });
    const wide = await checkedRead(source, statements, () => flows.previewProfit(owners.wide, { ...input, openingValueUsd: '0', closingValueUsd: '0' }));
    assert.equal(wide.flows.flowCount, 1000);
    assert.equal(wide.profitUsd, '-999999999999999999999999999999999999999999999999999.999999999999999999999999999');
    assert.equal(await fingerprint(source, true), old, 'No prior accounting or authentication rows changed');
    console.log('PASS PROFIT-EXACT thousand maximum amounts remain exact, signed and read-only');
  } finally {
    if (reader.isInitialized) await reader.destroy();
    if (source.isInitialized) await source.destroy();
  }
}
const watchdog = setTimeout(() => { console.error('FAIL profit PG watchdog'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
