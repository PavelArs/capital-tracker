'use strict';

const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { DataSource } = require('typeorm');
const { Client } = require('pg');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
const { ManualPriceService } = require('/app/backend/dist/accounting/manual-price.service.js');
const { AddManualUsdPrices1790080000000 } = require('/app/backend/dist/migrations/1790080000000-AddManualUsdPrices.js');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_prices_e2e';
const at = '2025-01-01T00:00:00.000Z';
const later = '2025-01-02T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const set = (expectedRevision, priceUsd = '100', observedAt = at, requestId = randomUUID()) => ({ requestId, expectedRevision, priceUsd, observedAt, assertReviewed: true });
const voidCommand = (expectedRevision, observedAt = at) => ({ requestId: randomUUID(), expectedRevision, observedAt, assertReviewed: true });

function sourceFor(name, statements) {
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: name })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  if (statements) {
    options.logging = ['query'];
    options.logger = { logQuery: sql => statements.push(sql), logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} };
  }
  return new DataSource(options);
}
async function createDatabase(name) {
  const client = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    assert.equal((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0, 'Never overwrite/reuse an existing database');
    assert.match(name, /^capital_tracker_prices(_fresh)?_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
// AST-2 adds three classification columns to accounting_instruments; upgrade comparisons
// strip only those keys and check their defaults separately.
async function fingerprint(source, excluded = [], withoutClassification = false) {
  const rows = [];
  for (const { tablename } of await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")) {
    assert.match(tablename, /^[a-z_]+$/);
    const row = withoutClassification && tablename === 'accounting_instruments'
      ? "to_jsonb(t) - 'assetType' - 'valuationCurrency' - 'priceSource'" : 'to_jsonb(t)';
    if (!excluded.includes(tablename)) rows.push([tablename, await source.query(`SELECT (${row})::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function refusal(action, status) { await assert.rejects(async () => action(), error => error?.getStatus?.() === status); }
async function checkedRead(source, statements, action) {
  const before = await fingerprint(source);
  const index = statements.length;
  const result = await action();
  const queries = statements.slice(index);
  assert.ok(queries.some(q => /REPEATABLE READ/.test(q)));
  assert.ok(queries.some(q => /READ ONLY/.test(q)));
  assert.ok(!queries.some(q => /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE)\b/.test(q)));
  assert.equal(await fingerprint(source), before);
  return result;
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await createDatabase('capital_tracker_prices_fresh_e2e');
  assert.match(migrate('capital_tracker_prices_fresh_e2e'), /Migrations applied: 42/);
  assert.match(migrate('capital_tracker_prices_fresh_e2e'), /Migrations applied: 0/);
  await createDatabase(database);
  const statements = [];
  const source = sourceFor(database, statements);
  const other = sourceFor(database);
  try {
    // Build a true populated predecessor17, then run the actual production CLI22.
    source.setOptions({ migrations: readdirSync('/app/backend/dist/migrations').filter(file => file.endsWith('.js') && file < '1790080000000').map(file => `/app/backend/dist/migrations/${file}`) });
    await source.initialize();
    await source.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await source.runMigrations({ transaction: 'all' });
    assert.equal((await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 17);
    const owners = [];
    for (const name of ['owner', 'foreign']) owners.push((await source.query('INSERT INTO users(email,password,"emailVerified") VALUES($1,$2,true) RETURNING id', [`prices-${name}@example.invalid`, 'synthetic-not-a-login-hash']))[0].id);
    const accounts = new AccountingService(source);
    const instruments = [];
    // The predecessor schema has no classification columns; write its original column list.
    const previousInstrument = async (owner, name) => (await source.query(`INSERT INTO accounting_instruments
      (id,"ownerId","requestId","canonicalPayload",name,symbol) VALUES($1,$2,$3,$4,$5,'SAME') RETURNING id,name,symbol`,
    [randomUUID(), owner, randomUUID(), JSON.stringify({ name, symbol: 'SAME' }), name]))[0];
    for (const name of ['Exact', 'Same symbol', 'Race', 'Cap']) instruments.push(await previousInstrument(owners[0], name));
    const foreign = await previousInstrument(owners[1], 'Foreign');
    const account = (await accounts.createAccount(owners[0], { requestId: randomUUID(), name: 'Preserved' })).value;
    const opening = await accounts.saveOpening(owners[0], account.id, { requestId: randomUUID(), expectedRevision: 0, asOf: at, positions: [{ instrumentId: instruments[0].id, quantity: atom, costStatus: 'known', totalCostUsd: maximum }] });
    const beforeUpgrade = await fingerprint(source, ['migrations'], true);
    assert.match(migrate(database), /Migrations applied: 25/);
    assert.equal(await fingerprint(source, ['migrations', 'manual_usd_price_versions', 'display_fx_collection', 'display_fx_observations', 'owner_transfer_journals', 'owned_transfers', 'owned_transfer_versions', 'account_rewards', 'account_reward_versions', 'account_swaps', 'account_swap_versions', 'wallet_addresses', 'wallet_address_transactions', 'price_observations', 'sync_sources', 'fx_rates', 'owner_settings', 'portfolio_snapshots', 'portfolio_snapshot_state', 'account_trade_version_payments', 'account_trade_version_comments', 'account_trade_version_settlements', 'account_trade_version_purposes', 'chain_transaction_classifications', 'chain_transaction_classification_versions', 'password_reset_tokens', 'wallet_stake_accounts', 'wallet_stake_moves', 'wallet_stake_rewards', 'wallet_stake_scans', 'wallet_ether_stake_positions', 'wallet_ether_stake_moves', 'wallet_ether_stake_rewards'], true), beforeUpgrade);
    assert.deepEqual(await source.query('SELECT DISTINCT "assetType","valuationCurrency","priceSource" FROM accounting_instruments'),
      [{ assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' }]);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 42);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM manual_usd_price_versions'))[0].n, 0);
    for (const table of ['account_swaps', 'account_swap_versions']) assert.equal((await source.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
    assert.match(migrate(database), /Migrations applied: 0/);
    await assert.rejects(() => new AddManualUsdPrices1790080000000().down(), /recovery plan/);
    assert.deepEqual((await accounts.getAccount(owners[0], account.id)).currentOpening, opening.value);
    console.log('PASS PRICE-MIGRATION fresh22, populated17 upgrade/rerun, all previous rows and opening receipt preserved, downgrade refused');

    await other.initialize();
    const prices = new ManualPriceService(source);
    const competing = new ManualPriceService(other);
    const owner = owners[0];
    const id = instruments[0].id;
    const old = await fingerprint(source, ['manual_usd_price_versions']);
    const empty = await checkedRead(source, statements, () => prices.list(owner, id, {}));
    assert.equal(empty.currentRevision, 0); assert.deepEqual(empty.items, []); assert.equal(empty.nextOffset, null);
    const command = set(0, atom, '2025-01-01T03:00:00+03:00');
    const original = await prices.set(owner, id, command);
    assert.equal(original.created, true); assert.equal(original.value.priceUsd, atom); assert.equal(original.value.observedAt, at);
    assert.equal(original.value.source, 'manual'); assert.equal(original.value.quoteCurrency, 'USD');
    await prices.set(owner, id, set(1, '0', later));
    assert.deepEqual((await prices.list(owner, instruments[1].id, {})).items, []);
    await prices.set(owner, id, set(2, maximum));
    const firstPage = await checkedRead(source, statements, () => prices.list(owner, id, { limit: '1' }));
    assert.equal(firstPage.currentRevision, 3); assert.equal(firstPage.items[0].priceUsd, '0'); assert.equal(firstPage.nextOffset, 1);
    const second = await prices.list(owner, id, { limit: '1', offset: '1', revision: '3' });
    assert.equal(second.items[0].priceUsd, maximum); assert.equal(second.nextOffset, null);
    const deleted = await prices.void(owner, id, voidCommand(3));
    assert.equal(deleted.value.kind, 'void'); assert.equal(deleted.value.priceUsd, null);
    const voided = await prices.list(owner, id, {});
    assert.equal(voided.currentRevision, 4); assert.equal(voided.items.length, 1);
    await refusal(() => prices.void(owner, id, voidCommand(4)), 409);
    await prices.set(owner, id, set(4, '120'));
    const history = await checkedRead(source, statements, () => prices.history(owner, id, { observedAt: at, limit: '2' }));
    assert.deepEqual(history.items.map(r => [r.revision, r.kind, r.priceUsd]), [[5, 'set', '120'], [4, 'void', null]]);
    assert.equal(history.nextBeforeRevision, 4);
    const oldHistory = await prices.history(owner, id, { observedAt: at, beforeRevision: '4', limit: '2' });
    assert.deepEqual(oldHistory.items.map(r => r.revision), [3, 1]); assert.equal(oldHistory.nextBeforeRevision, null);
    assert.deepEqual(oldHistory.items[1], original.value);
    assert.deepEqual(await prices.set(owner, id, { ...command, observedAt: at }), { created: false, value: original.value });
    await refusal(() => prices.set(owner, id, { ...command, priceUsd: '99' }), 409);
    await refusal(() => prices.list(owner, id, { offset: '1', revision: '3' }), 409);
    await refusal(() => prices.list(owner, id, { offset: '1' }), 400);
    const denied = await fingerprint(source);
    await refusal(() => prices.list(owner, foreign.id, {}), 404);
    await refusal(() => prices.history(owner, foreign.id, { observedAt: at }), 404);
    await refusal(() => prices.set(owner, foreign.id, set(0)), 404);
    await refusal(() => prices.void(owner, foreign.id, voidCommand(0)), 404);
    await refusal(() => prices.set(owner, id, { ...set(5), assertReviewed: false }), 400);
    assert.equal(await fingerprint(source), denied);
    console.log('PASS PRICE-EXACT/REPAIR/PAGES/PRIVATE exact tiny/max/zero, UUID isolation, immutable set/void/restore/history/replay and private refusals');

    const raceId = instruments[2].id;
    const results = await Promise.allSettled([prices.set(owner, raceId, set(0, '1')), competing.set(owner, raceId, set(0, '2'))]);
    assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.created).length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 409).length, 1);
    const winner = results.find(r => r.status === 'fulfilled').value.value;
    const raceBook = await prices.list(owner, raceId, {});
    assert.equal(raceBook.currentRevision, 1); assert.deepEqual(raceBook.items, [winner]);
    const replay = set(1, '3');
    const parallel = await Promise.all([prices.set(owner, raceId, replay), competing.set(owner, raceId, replay)]);
    assert.deepEqual(parallel.map(r => r.created).sort(), [false, true]); assert.deepEqual(parallel[0].value, parallel[1].value);
    const replayBook = await prices.list(owner, raceId, {});
    assert.equal(replayBook.currentRevision, 2); assert.deepEqual(replayBook.items, [parallel[0].value]);
    console.log('PASS PRICE-RACE actual separate-pool CAS and same-command concurrency');

    let reached, resume, paused = false;
    const barrier = new Promise(resolve => { reached = resolve; });
    const release = new Promise(resolve => { resume = resolve; });
    const originalRunner = source.createQueryRunner.bind(source);
    source.createQueryRunner = (...args) => {
      const runner = originalRunner(...args), query = runner.query.bind(runner);
      runner.query = async (...args) => {
        const result = await query(...args);
        if (!paused && /MAX\(revision\)/i.test(args[0])) { paused = true; reached(); await release; }
        return result;
      };
      return runner;
    };
    const pending = prices.list(owner, id, {}); pending.catch(() => {});
    try {
      await barrier;
      await competing.set(owner, id, set(5, '130'));
      resume();
      const captured = await pending;
      assert.equal(captured.currentRevision, 5); assert.equal(captured.items.find(p => p.observedAt === at).priceUsd, '120');
      const current = await competing.list(owner, id, {});
      assert.equal(current.currentRevision, 6); assert.equal(current.items.find(p => p.observedAt === at).priceUsd, '130');
    } finally { resume(); await pending; source.createQueryRunner = originalRunner; }
    console.log('PASS PRICE-SNAPSHOT real RR read remains coherent across committed correction');

    const capId = instruments[3].id, capCommand = set(0, '1');
    const capReceipt = await prices.set(owner, capId, capCommand);
    await source.query(`INSERT INTO manual_usd_price_versions ("ownerId","instrumentId",revision,"requestId","canonicalPayload",kind,"observedAt","priceUsd")
      SELECT $1,$2,n,uuid_generate_v4(),'synthetic cap fixture','set',$3,1 FROM generate_series(2,10000) n`, [owner, capId, at]);
    await refusal(() => prices.set(owner, capId, set(10000, '2')), 409);
    await refusal(() => prices.void(owner, capId, voidCommand(10000)), 409);
    assert.deepEqual(await prices.set(owner, capId, capCommand), { created: false, value: capReceipt.value });
    const cap = await prices.list(owner, capId, { offset: '10000', revision: '10000' });
    assert.equal(cap.currentRevision, 10000); assert.deepEqual(cap.items, []);
    const invalidRow = (kind, amount, observedAt = at, instrumentId = instruments[1].id) => source.query(`INSERT INTO manual_usd_price_versions ("ownerId","instrumentId",revision,"requestId","canonicalPayload",kind,"observedAt","priceUsd") VALUES($1,$2,1,$3,'synthetic invalid',$4,$5,$6)`, [owner, instrumentId, randomUUID(), kind, observedAt, amount]);
    for (const value of ['-1', 'NaN', 'Infinity', '-Infinity', null]) await assert.rejects(() => invalidRow('set', value));
    await assert.rejects(() => invalidRow('void', '1'));
    await assert.rejects(() => invalidRow('other', '1'));
    await assert.rejects(() => invalidRow('set', '1', '1969-01-01T00:00:00Z'));
    await assert.rejects(() => invalidRow('set', '1', at, foreign.id), e => e.code === '23503');
    assert.equal(await fingerprint(source, ['manual_usd_price_versions']), old);
    console.log('PASS PRICE-BOUND 10000-version cap/replay and actual numeric/date/kind/composite ownership constraints; old data unchanged');
  } finally {
    if (source.isInitialized) await source.destroy();
    if (other.isInitialized) await other.destroy();
  }
}
const watchdog = setTimeout(() => { console.error('FAIL manual price fixture watchdog'); process.exit(1); }, 120000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
