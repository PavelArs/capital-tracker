'use strict';

// Actual production services and PostgreSQL. No repository/auth/backend mocks.
// Missing future module/schema is a prerequisite failure, never behavioral RED.
const assert = require('node:assert/strict');
const { fork, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, readdirSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_owned_transfers_e2e';
const previousDatabase = 'capital_tracker_owned_transfers_previous_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const at = '2025-01-06T00:00:00.000Z';
const transferTables = ['owner_transfer_journals', 'owned_transfers', 'owned_transfer_versions'];
let stage = 'isolated configuration';
const children = new Set();

function source(name = database) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: name })).createTypeOrmOptions();
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
// AST-2 adds three classification columns to accounting_instruments; upgrade comparisons
// strip only those keys and check their defaults separately.
async function fingerprint(db, excluded = [], withoutClassification = false) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const rows = [];
  for (const { tablename } of tables) {
    if (excluded.includes(tablename)) continue;
    assert.match(tablename, /^[a-z_]+$/);
    const row = withoutClassification && tablename === 'accounting_instruments'
      ? "to_jsonb(t) - 'assetType' - 'valuationCurrency' - 'priceSource'" : 'to_jsonb(t)';
    rows.push([tablename, await db.query(`SELECT (${row})::text AS row FROM "${tablename}" t ORDER BY row`)]);
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

async function createDatabase(name) {
  assert.ok([database, previousDatabase].includes(name), 'Only this script\'s exact synthetic databases');
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0,
      'Never reuse or drop a pre-existing database');
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally { await admin.end(); }
}
function migrate(name) {
  assert.ok([database, previousDatabase].includes(name));
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, 'Actual guarded production migration CLI');
  return result.stdout;
}
async function populatedUpgrade() {
  stage = 'TRANSFER-006-A populated19 preservation and downgrade refusal';
  await createDatabase(previousDatabase);
  const prior = source(previousDatabase);
  // Only building an empty, newly created synthetic predecessor schema. No unsafe
  // legacy upgrade bypass: the populated upgrade itself uses the guarded CLI.
  prior.setOptions({ migrations: readdirSync('/app/backend/dist/migrations')
    .filter(file => file.endsWith('.js') && file < '1790100000000')
    .map(file => `/app/backend/dist/migrations/${file}`) });
  try {
    await prior.initialize();
    await prior.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await prior.runMigrations({ transaction: 'all' });
    assert.equal((await prior.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 19);
    const [{ id: owner }] = await prior.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES('transfer-upgrade@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(prior);
    const a = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Preserved previous journal' })).value.id;
    // The predecessor schema has no classification columns; write its original column list.
    const [{ id: instrument }] = await prior.query(`INSERT INTO accounting_instruments
      (id,"ownerId","requestId","canonicalPayload",name,symbol) VALUES($1,$2,$3,$4,'Preserved previous instrument','SAME') RETURNING id`,
    [randomUUID(), owner, randomUUID(), JSON.stringify({ name: 'Preserved previous instrument', symbol: 'SAME' })]);
    const request = randomUUID(), buy = randomUUID(), initialization = randomUUID();
    const execution = trade(instrument, 0);
    await prior.transaction(async manager => {
      await manager.query(`INSERT INTO account_trade_journals
        ("ownerId","accountId","requestId","canonicalPayload","originKind","coverageFrom","currentRevision")
        VALUES($1,$2,$3,$4,'declared-empty',$5,1)`,
        [owner, a, initialization, JSON.stringify({ coverageFrom, assertEmpty: true }), coverageFrom]);
      await manager.query('INSERT INTO account_trades(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)', [buy, owner, a]);
      await manager.query(`INSERT INTO account_trade_versions
        ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind,
         "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd")
        VALUES($1,$2,$3,1,1,$4,$5,'create',$6,'buy',$7,0,1,100,0)`,
        [owner, a, buy, request, JSON.stringify({ kind: 'create', expectedJournalRevision: 0,
          instrumentId: instrument, side: 'buy', occurredAt: execution.occurredAt,
          orderWithinTimestamp: 0, quantity: '1', grossUsd: '100', feeUsd: '0' }), instrument, execution.occurredAt]);
    });
    await prior.query(`INSERT INTO assets("userId",name,category,amount,"currencyId",date)
      SELECT $1,'Preserved unrelated fixture','savings',123.45,id,'2025-01-01' FROM currencies WHERE code='USD'`, [owner]);
    const old = await fingerprint(prior, ['migrations'], true);
    assert.match(migrate(previousDatabase), /Migrations applied: 34/);
    assert.equal((await prior.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 53);
    assert.equal(await fingerprint(prior, ['migrations', ...transferTables, 'account_rewards', 'account_reward_versions', 'account_swaps', 'account_swap_versions', 'wallet_addresses', 'wallet_address_transactions', 'price_observations', 'sync_sources', 'fx_rates', 'owner_settings', 'portfolio_snapshots', 'portfolio_snapshot_state', 'account_trade_version_payments', 'account_trade_version_comments', 'account_trade_version_settlements', 'account_trade_version_purposes', 'chain_transaction_classifications', 'chain_transaction_classification_versions', 'password_reset_tokens', 'wallet_stake_accounts', 'wallet_stake_moves', 'wallet_stake_rewards', 'wallet_stake_scans', 'wallet_xpub_addresses', 'wallet_ether_stake_positions', 'wallet_ether_stake_moves', 'wallet_ether_stake_rewards', 'bybit_accounts', 'wallet_tron_accounts', 'wallet_tron_stake_moves', 'chain_tokens', 'wallet_stellar_accounts', 'wallet_zcash_accounts'], true), old);
    assert.deepEqual(await prior.query('SELECT "assetType","valuationCurrency","priceSource" FROM accounting_instruments'),
      [{ assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' }]);
    for (const table of [...transferTables, 'account_rewards', 'account_reward_versions', 'account_swaps', 'account_swap_versions']) assert.equal((await prior.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
    const after = await fingerprint(prior);
    assert.match(migrate(previousDatabase), /Migrations applied: 0/);
    assert.equal(await fingerprint(prior), after);
    assert.equal((await journal(s, owner, a)).summary.remainingCostUsd, '100');
    const replay = await s.trade.create(owner, a, { ...execution, requestId: request });
    assert.equal(replay.created, false, 'Prior normalized request remains replayable');
    assert.equal(replay.value.trade.tradeId, buy);
    assert.equal(replay.value.trade.version, 1);
    assert.equal(replay.value.trade.requestId, request);
    assert.equal(replay.value.journalRevision, 1);
    assert.equal(replay.value.trade.grossUsd, '100');
    const { AddOwnedTransfers1790100000000 } = require('/app/backend/dist/migrations/1790100000000-AddOwnedTransfers.js');
    await assert.rejects(() => new AddOwnedTransfers1790100000000().down(), /recovery|downgrade/i);
    assert.equal(await fingerprint(prior), after, 'No-op/replay/refused downgrade preserve every row');
  } finally { if (prior.isInitialized) await prior.destroy(); }
  console.log('PASS TRANSFER-006-A populated19/fresh22/no-op/replay/preservation/downgrade');
}

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
  // Expecting revision 0 starts an empty journal (PR-OPS-2); any other revision is stale.
  const uninitialized = await account(s, f.owner, 'Uninitialized', null);
  const foreign = await account(s, f.other, 'Foreign account');
  for (const [patch, code] of [[{ toAccountId: later }, 409], [{ toAccountId: a }, 409],
    [{ toAccountId: uninitialized, expectedToJournalRevision: 1 }, 409], [{ toAccountId: foreign }, 404],
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

async function connectedCsv(db, s, f) {
  stage = 'TRANSFER-003-B connected CSV preview/confirmation/rollback';
  const a = await account(s, f.owner, 'CSV source'), b = await account(s, f.owner, 'CSV recipient');
  const settings = side => ({ format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: { columns: { instrument: 0, side: 1, occurredAt: 2, order: 3, quantity: 4, grossUsd: 5, feeUsd: 6 },
      instruments: [{ source: 'TOKEN', instrumentId: f.token }], sides: [{ source: side, side }] }, assertUsd: true });
  const upload = async (id, side, date, gross) => {
    const bytes = Buffer.from(`instrument,side,time,order,quantity,gross,fee\nTOKEN,${side},${date},0,1,${gross},0\n`);
    return { bytes, batch: (await s.csv.upload(f.owner, id, { filename: 'owned-transfer.csv', bytes })).value,
      settings: settings(side) };
  };
  const command = (preview, value) => ({ requestId: randomUUID(), expectedJournalRevision: preview.journalRevision,
    parserVersion: 'usd-csv-v1', ...value.settings, previewHash: preview.previewHash });
  const imported = await upload(a, 'buy', '2025-01-02T00:00:00.000Z', '100');
  const sourcePreview = await s.csv.preview(f.owner, a, imported.batch.batchId, imported.settings);
  assert.equal(sourcePreview.canConfirm, true);
  const sourceCommand = command(sourcePreview, imported);
  const sourceReceipt = await s.csv.confirm(f.owner, a, imported.batch.batchId, sourceCommand);
  const [buy] = (await s.trade.listTrades(f.owner, a, {})).items;
  await s.transfer.create(f.owner, movement(f, a, b, 1, 0,
    { quantity: '1', feeInstrumentId: null, feeQuantity: '0' }));
  await unchanged(db, () => s.csv.rollback(f.owner, a, imported.batch.batchId,
    { requestId: randomUUID(), expectedJournalRevision: 2 }), 409);
  const sale = await upload(b, 'sell', '2025-01-04T00:00:00.000Z', '300');
  const preview = await s.csv.preview(f.owner, b, sale.batch.batchId, sale.settings);
  assert.equal(preview.canConfirm, true, 'Real CSV sale sees received holdings');
  assert.equal(preview.candidateSummary.realizedUsd, '200');
  const stale = command(preview, sale);
  await s.trade.correct(f.owner, a, buy.tradeId, trade(f.token, 2,
    { grossUsd: '120', orderWithinTimestamp: 0 }));
  await unchanged(db, () => s.csv.confirm(f.owner, b, sale.batch.batchId, stale), 409);
  const refreshed = await s.csv.preview(f.owner, b, sale.batch.batchId, sale.settings);
  assert.notEqual(refreshed.previewHash, preview.previewHash);
  assert.equal(refreshed.journalRevision, 2);
  assert.equal(refreshed.candidateSummary.realizedUsd, '180');
  const saleCommand = command(refreshed, sale);
  const saleReceipt = await s.csv.confirm(f.owner, b, sale.batch.batchId, saleCommand);
  assert.equal((await journal(s, f.owner, a)).journalRevision, 4);
  assert.equal((await journal(s, f.owner, b)).journalRevision, 3);
  assert.equal((await journal(s, f.owner, b)).versionCount, 1);
  const rollbackInput = { requestId: randomUUID(), expectedJournalRevision: 3 };
  const rollback = await s.csv.rollback(f.owner, b, sale.batch.batchId, rollbackInput);
  assert.equal((await journal(s, f.owner, a)).journalRevision, 5);
  assert.equal((await journal(s, f.owner, b)).journalRevision, 4);
  assert.equal((await journal(s, f.owner, b)).versionCount, 2);
  assert.equal((await journal(s, f.owner, b)).summary.remainingCostUsd, '120');
  assert.equal((await journal(s, f.owner, b)).summary.realizedUsd, '0');
  const beforeReplay = await fingerprint(db);
  assert.deepEqual(await s.csv.confirm(f.owner, a, imported.batch.batchId, sourceCommand),
    { created: false, value: sourceReceipt.value });
  assert.deepEqual(await s.csv.confirm(f.owner, b, sale.batch.batchId, saleCommand),
    { created: false, value: saleReceipt.value });
  assert.deepEqual(await s.csv.rollback(f.owner, b, sale.batch.batchId, rollbackInput),
    { created: false, value: rollback.value });
  const savedSources = await db.query('SELECT id,"originalBytes" FROM account_csv_imports WHERE id=ANY($1::uuid[])',
    [[imported.batch.batchId, sale.batch.batchId]]);
  assert.equal(savedSources.length, 2);
  assert.deepEqual(savedSources.find(row => row.id === imported.batch.batchId).originalBytes, imported.bytes);
  assert.deepEqual(savedSources.find(row => row.id === sale.batch.batchId).originalBytes, sale.bytes);
  assert.equal(await fingerprint(db), beforeReplay);
  console.log('PASS TRANSFER-003-B connected CSV exact preview/rollback/replay');
}

async function commitAndConstraints(db, s, f) {
  stage = 'TRANSFER-003-C/006-A deferred COMMIT rollback and actual constraints';
  const { a, b, input } = await setup(s, f, 'Commit witness');
  const marker = `transfer_commit_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SEQUENCE ${marker}`);
  await db.query(`CREATE FUNCTION ${marker}() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW."requestId"='${input.requestId}'::uuid THEN
      IF NOT EXISTS(SELECT 1 FROM owned_transfers WHERE id=NEW."transferId" AND "currentVersion"=NEW.version)
        OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "accountId"='${a}'::uuid AND "currentRevision"=NEW."fromJournalRevision")
        OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "accountId"='${b}'::uuid AND "currentRevision"=NEW."toJournalRevision")
        OR NOT EXISTS(SELECT 1 FROM owner_transfer_journals WHERE "ownerId"=NEW."ownerId" AND "currentRevision"=NEW."journalRevision")
      THEN RAISE EXCEPTION 'Synthetic transfer writes incomplete'; END IF;
      PERFORM nextval('${marker}'); RAISE EXCEPTION 'Synthetic complete transfer commit failure';
    END IF; RETURN NULL; END $body$`);
  await db.query(`CREATE CONSTRAINT TRIGGER ${marker} AFTER INSERT ON owned_transfer_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${marker}()`);
  const before = await fingerprint(db);
  try {
    await assert.rejects(() => s.transfer.create(f.owner, input), error =>
      (error.driverError?.code ?? error.code) === 'P0001');
    const [witness] = await db.query(`SELECT last_value::text AS value,is_called AS called FROM ${marker}`);
    assert.deepEqual(witness, { value: '1', called: true }, 'All legs/heads/revisions existed before deferred failure');
    assert.equal(await fingerprint(db), before, 'COMMIT failure rolls back all account and command rows');
  } finally {
    await db.query(`DROP TRIGGER ${marker} ON owned_transfer_versions`);
    await db.query(`DROP FUNCTION ${marker}()`);
    await db.query(`DROP SEQUENCE ${marker}`);
  }
  const saved = await s.transfer.create(f.owner, input);
  assert.equal(saved.created, true, 'Failure did not reserve the request key');
  assert.deepEqual(await s.transfer.create(f.owner, input), { created: false, value: saved.value });
  const id = saved.value.transfer.transferId;
  const preserved = await fingerprint(db);
  const invalid = async (sql, values, code) => {
    const runner = db.createQueryRunner();
    let error;
    try {
      await runner.connect(); await runner.startTransaction();
      try { await runner.query(sql, values); await runner.commitTransaction(); } catch (caught) { error = caught; }
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    assert.equal(error?.driverError?.code ?? error?.code, code, 'Intended immediate or deferred PostgreSQL constraint');
    assert.equal(await fingerprint(db), preserved);
  };
  for (const [set, value, code] of [['quantity=$2', '-1', '23514'], ['quantity=$2', 'NaN', '23514'],
    ['quantity=$2', '9'.repeat(49), '22003'], ['"feeQuantity"=$2', '-1', '23514'],
    ['"feeInstrumentId"=$2', null, '23514'], ['"instrumentId"=$2', f.foreignToken, '23503'],
    ['"occurredAt"=$2', 'infinity', '23514'], ['"orderWithinTimestamp"=$2', -1, '23514']]) {
    await invalid(`UPDATE owned_transfer_versions SET ${set} WHERE "transferId"=$1 AND version=1`, [id, value], code);
  }
  await invalid('UPDATE owned_transfers SET "toAccountId"="fromAccountId" WHERE id=$1', [id], '23514');
  await invalid('UPDATE owned_transfers SET "currentVersion"=2 WHERE id=$1', [id], '23503');
  await invalid('UPDATE owner_transfer_journals SET "currentRevision"=10001 WHERE "ownerId"=$1', [f.owner], '23514');
  console.log('PASS TRANSFER-003-C/006-A deferred COMMIT witness/rollback/constraints/retry');
}

async function workerMain() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value);
  const db = source();
  try {
    await db.initialize();
    const [{ pid }] = await db.query('SELECT pg_backend_pid() AS pid');
    const command = new Promise(resolve => process.once('message', resolve));
    process.send({ type: 'ready', pid, processId: process.pid });
    const { owner, input } = await command;
    try { process.send({ type: 'result', value: await services(db).transfer.create(owner, input) }); }
    catch (error) { process.send({ type: 'result', status: error.getStatus?.() ?? null }); }
  } finally { if (db.isInitialized) await db.destroy(); }
}
async function worker() {
  const child = fork(__filename, ['--worker'], { env: process.env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  children.add(child);
  let ready, result, failReady, failResult;
  const started = new Promise((resolve, reject) => { ready = resolve; failReady = reject; });
  const finished = new Promise((resolve, reject) => { result = resolve; failResult = reject; });
  const closed = new Promise(resolve => child.once('exit', resolve));
  void finished.catch(() => {});
  let received = false;
  child.on('message', message => {
    if (message.type === 'ready') ready(message);
    if (message.type === 'result') { received = true; result(message); }
  });
  child.on('error', error => { failReady(error); failResult(error); });
  child.on('exit', code => {
    children.delete(child);
    if (!received) { const error = new Error(`Synthetic worker exited without result (${code})`); failReady(error); failResult(error); }
  });
  const identity = await started;
  return { ...identity, async run(owner, input) {
    child.send({ owner, input });
    const [value, exitCode] = await Promise.all([finished, closed]);
    assert.equal(exitCode, 0, 'Synthetic service worker exits cleanly');
    return value;
  } };
}
async function waitForLock(db, pid, pattern) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.query(`SELECT query FROM pg_stat_activity WHERE pid=$1
      AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`, [pid]);
    if (rows.some(row => pattern.test(row.query))) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Expected actual PostgreSQL lock waiter was not observed');
}
async function processRaces(db, s, f) {
  stage = 'TRANSFER-003-C separate process owner/row lock race and saved replay';
  for (const identical of [false, true]) {
    const { a, b, input } = await setup(s, f, `Race ${identical}`);
    const lock = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
      password: settings.DB_PASSWORD, database });
    await lock.connect();
    let firstResult, secondResult;
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM manual_accounts WHERE id=$1 FOR UPDATE', [a]);
      const first = await worker(), second = await worker();
      assert.notEqual(first.pid, second.pid);
      assert.notEqual(first.processId, second.processId);
      firstResult = first.run(f.owner, input);
      await waitForLock(db, first.pid, /manual_accounts/);
      secondResult = second.run(f.owner, identical ? input : { ...input, requestId: randomUUID() });
      await waitForLock(db, second.pid, /pg_advisory_xact_lock/);
      const blocked = await db.query(`SELECT pid FROM pg_stat_activity WHERE pid=ANY($1::int[])
        AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`, [[first.pid, second.pid]]);
      assert.equal(blocked.length, 2, 'Both real processes are waiting at the prescribed distinct lock stages');
      await lock.query('COMMIT');
      const [one, two] = await Promise.all([firstResult, secondResult]);
      assert.equal(one.value.created, true);
      if (identical) assert.deepEqual(two.value, { created: false, value: one.value.value });
      else assert.equal(two.status, 409);
      assert.equal((await journal(s, f.owner, a)).journalRevision, 3);
      assert.equal((await journal(s, f.owner, b)).journalRevision, 1);
      assert.equal((await journal(s, f.owner, a)).summary.remainingCostUsd, '80');
      assert.equal((await journal(s, f.owner, b)).summary.remainingCostUsd, '200');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM owned_transfers WHERE "fromAccountId"=$1', [a]))[0].n, 1);
    } finally {
      await lock.query('ROLLBACK'); await lock.end();
      await Promise.allSettled([firstResult, secondResult].filter(Boolean));
    }
  }
  const { a, b, first, input } = await setup(s, f, 'Passive cap');
  const saved = (await s.transfer.create(f.owner, input)).value;
  // Synthetic valid journal budget state: passive ticks need no local versions.
  await db.query('UPDATE account_trade_journals SET "currentRevision"=10000 WHERE "accountId"=$1', [b]);
  const exhausted = await journal(s, f.owner, b);
  assert.equal(exhausted.versionCount, 0);
  assert.deepEqual(exhausted.revisionBudget, { used: 10000, limit: 10000 });
  const command = trade(f.token, 3, { grossUsd: '120', orderWithinTimestamp: 0 });
  await unchanged(db, () => s.trade.correct(f.owner, a, first.trade.tradeId, command), 409);
  assert.deepEqual(await s.transfer.create(f.owner, input), { created: false, value: saved });
  await db.query('UPDATE account_trade_journals SET "currentRevision"=1 WHERE "accountId"=$1', [b]);
  assert.equal((await s.trade.correct(f.owner, a, first.trade.tradeId, command)).created, true,
    'The identical command succeeds when only the dependent budget is restored');
  console.log('PASS TRANSFER-003-C process race/advisory and row wait/replay/passive budget');
}

async function ownerLimits(db, s, fixture) {
  stage = 'TRANSFER-003-D valid owner1000-active and10000-version bounds';
  for (const [index, owner] of fixture.capOwners.entries()) {
    const token = (await s.accounting.createInstrument(owner, {
      requestId: randomUUID(), name: `Capacity ${index}`, symbol: 'CAP',
    })).value.id;
    const f = { owner, token };
    const { a, b, input } = await setup(s, f, `Capacity ${index}`);
    const firstInput = { ...input, quantity: '0.001', feeInstrumentId: null, feeQuantity: '0' };
    const first = (await s.transfer.create(owner, firstInput)).value;
    if (index === 0) {
      // Fully valid effective1000-event history. Only fixture construction uses
      // bulk SQL; all boundary decisions/replay/corrections use production services.
      const identities = Array.from({ length: 999 }, (_, i) => ({ id: randomUUID(), ordinal: i + 2 }));
      await db.transaction(async manager => {
        await manager.query(`INSERT INTO owned_transfers(id,"ownerId","fromAccountId","toAccountId","currentVersion")
          SELECT x.id,$1,$2,$3,1 FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,ordinal int)`,
          [owner, a, b, JSON.stringify(identities)]);
        await manager.query(`INSERT INTO owned_transfer_versions
          ("ownerId","transferId",version,"journalRevision","fromJournalRevision","toJournalRevision",
           "requestId","canonicalPayload",kind,"instrumentId","occurredAt","orderWithinTimestamp",quantity,"feeInstrumentId","feeQuantity")
          SELECT $1,x.id,1,x.ordinal,x.ordinal+2,x.ordinal,gen_random_uuid(),'synthetic-active-cap','create',
            $2,$3,x.ordinal,0.001,NULL,0 FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,ordinal int)`,
          [owner, token, firstInput.occurredAt, JSON.stringify(identities)]);
        await manager.query('UPDATE owner_transfer_journals SET "currentRevision"=1000 WHERE "ownerId"=$1', [owner]);
        await manager.query('UPDATE account_trade_journals SET "currentRevision"=CASE WHEN "accountId"=$2 THEN 1002 ELSE 1000 END WHERE "ownerId"=$1', [owner, a]);
      });
      const full = await s.transfer.list(owner, {});
      assert.equal(full.activeCount, 1000); assert.equal(full.versionCount, 1000);
      assert.equal((await journal(s, owner, b)).summary.remainingCostUsd, '100');
      const overflow = movement(f, a, b, 1002, 1000, {
        occurredAt: '2025-01-04T00:00:00.000Z', quantity: '0.001', feeInstrumentId: null, feeQuantity: '0',
      });
      await unchanged(db, () => s.transfer.create(owner, overflow), 409);
      assert.deepEqual(await s.transfer.create(owner, firstInput), { created: false, value: first });
      const correction = corrections(first.transfer, 1002, 1000, { quantity: '0.002' });
      assert.equal((await s.transfer.correct(owner, first.transfer.transferId, correction)).created, true);
      assert.equal((await s.transfer.list(owner, {})).activeCount, 1000, 'Correction does not consume active identity capacity');
      assert.equal((await journal(s, owner, b)).summary.remainingCostUsd, '100.2');
    } else {
      // First component stops at9998 transfer versions so its two local buys
      // still fit the journal budget. A disjoint component fills the final two
      // OWNER-wide slots; its account pins retain capacity at the rejection.
      await db.transaction(async manager => {
        await manager.query(`INSERT INTO owned_transfer_versions
          ("ownerId","transferId",version,"journalRevision","fromJournalRevision","toJournalRevision",
           "requestId","canonicalPayload",kind,"instrumentId","occurredAt","orderWithinTimestamp",quantity,"feeInstrumentId","feeQuantity")
          SELECT "ownerId","transferId",n,n,n+2,n,gen_random_uuid(),'synthetic-version-cap','correct',
            "instrumentId","occurredAt","orderWithinTimestamp",quantity,"feeInstrumentId","feeQuantity"
          FROM owned_transfer_versions CROSS JOIN generate_series(2,9998) n
          WHERE "ownerId"=$1 AND "transferId"=$2 AND version=1`, [owner, first.transfer.transferId]);
        await manager.query('UPDATE owned_transfers SET "currentVersion"=9998 WHERE "ownerId"=$1', [owner]);
        await manager.query('UPDATE owner_transfer_journals SET "currentRevision"=9998 WHERE "ownerId"=$1', [owner]);
        await manager.query('UPDATE account_trade_journals SET "currentRevision"=CASE WHEN "accountId"=$2 THEN 10000 ELSE 9998 END WHERE "ownerId"=$1', [owner, a]);
      });
      const next = await setup(s, f, 'Final owner slots');
      const penultimate = (await s.transfer.create(owner, next.input)).value;
      assert.equal(penultimate.journalRevision, 9999);
      const command = corrections(penultimate.transfer, 3, 1, { quantity: '1.4' });
      const last = (await s.transfer.correct(owner, penultimate.transfer.transferId, command)).value;
      assert.equal(last.journalRevision, 10000);
      assert.equal((await s.transfer.list(owner, {})).versionCount, 10000);
      assert.equal((await journal(s, owner, next.a)).journalRevision, 4);
      assert.equal((await journal(s, owner, next.b)).journalRevision, 2);
      await unchanged(db, () => s.transfer.correct(owner, last.transfer.transferId,
        corrections(last.transfer, 4, 2, { quantity: '1.3' })), 409);
      await unchanged(db, () => s.transfer.create(owner, movement(f, next.a, next.b, 4, 2, {
        occurredAt: '2025-01-04T00:00:00.000Z', quantity: '0.1', feeInstrumentId: null, feeQuantity: '0',
      })), 409);
      assert.deepEqual(await s.transfer.create(owner, firstInput), { created: false, value: first });
      assert.deepEqual(await s.transfer.correct(owner, last.transfer.transferId, command), { created: false, value: last });
    }
  }
  console.log('PASS TRANSFER-003-D actual owner1000-active/10000-version legal boundaries, atomic refusal and replay');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value,
    'Exact isolated synthetic settings required');
  assert.ok(existsSync('/app/backend/dist/accounting/owned-transfer.service.js'),
    'Missing module is prerequisite failure, not behavioral RED');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 53/);
  assert.match(migrate(database), /Migrations applied: 0/);
  if (!process.argv.includes('--limits-only')) await populatedUpgrade();
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 53);
    for (const table of [...transferTables, 'account_rewards', 'account_reward_versions', 'account_swaps', 'account_swap_versions']) assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
    const [owner, other, activeCap, versionCap] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('owned-transfer-owner@example.invalid','synthetic-not-a-hash',true),
      ('owned-transfer-other@example.invalid','synthetic-not-a-hash',true),
      ('owned-transfer-active-cap@example.invalid','synthetic-not-a-hash',true),
      ('owned-transfer-version-cap@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const token = (await s.accounting.createInstrument(owner.id, { requestId: randomUUID(), name: 'Token', symbol: 'SAME' })).value.id;
    const foreignToken = (await s.accounting.createInstrument(other.id, { requestId: randomUUID(), name: 'Foreign', symbol: 'SAME' })).value.id;
    const f = { owner: owner.id, other: other.id, token, foreignToken, capOwners: [activeCap.id, versionCap.id] };
    const mutable = [...transferTables, 'manual_accounts', 'accounting_instruments', 'account_trade_journals',
      'account_trades', 'account_trade_versions', 'manual_usd_price_versions',
      'account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
    const preserved = await fingerprint(db, mutable);
    const checks = process.argv.includes('--limits-only') ? [ownerLimits]
      : [exactAndRestatement, correctionVoidAndPrivacy, coherentSnapshot, connectedCsv, commitAndConstraints, processRaces, ownerLimits];
    for (const check of checks) await check(db, s, f);
    assert.equal(await fingerprint(db, mutable), preserved, 'External flows/auth/legacy/provider tables unchanged');
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 180000);
watchdog.unref();
(process.argv.includes('--worker') ? workerMain() : main())
  .catch(error => { console.error(`FAIL ${stage}: ${error.message}`); process.exitCode = 1; })
  .finally(() => { clearTimeout(watchdog); for (const child of children) child.kill(); });
