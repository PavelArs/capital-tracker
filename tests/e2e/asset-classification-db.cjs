'use strict';

// Real PostgreSQL acceptance for asset-classification (AST-*). Guarded fresh synthetic
// database; compiled production services and the real migration CLI, no mocks.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readdirSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_asset_classification_e2e';
const migration = 'ClassifyAssets1790700000000';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const at = '2025-06-14T00:00:00.000Z';
const newColumns = ['assetType', 'valuationCurrency', 'priceSource'];
const isNewColumn = (row) => row.table_name === 'accounting_instruments' && newColumns.includes(row.column_name);
let stage = 'synthetic configuration';

function sourceFor() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  return { accounting: make('accounting.service', 'AccountingService'),
    trades: make('trade.service', 'TradeService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    valuation: make('historical-valuation.service', 'HistoricalValuationService') };
}
async function createDatabase() {
  const client = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    assert.equal((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Never overwrite/reuse an existing database');
    await client.query(`CREATE DATABASE "${database}"`);
  } finally { await client.end(); }
}
// Every migration except this change (later ones such as AddHourlyPrices1790800000000 and
// AccountInThreeCurrencies1790900000000, RecordPortfolioSnapshots1791000000000, PaidCurrencyTrades1791100000000, TradeComments1791200000000, TradeSettlements1791300000000, TradePurposes1791400000000, BindWalletsToAccounts1791600000000, ClassifyChainTransactions1791700000000,
// LinkOwnTransfers1791800000000, TrackEthereumWallets1792000000000, TrackSolanaWallets1792100000000,
// CapMfaFailureStreak1792200000000, AddPasswordResetTokens1792500000000, TrackSolanaStake1792600000000,
// ChainDustThreshold1792700000000, AddSessionDevice1792800000000, ScanBitcoinXpub1792900000000,
// LinkChainSwaps1793100000000 and SyncBybitAccount1793300000000 do not
// touch instruments), run as a release without the classification did.
async function createPreviousSchema() {
  const classes = readdirSync('/app/backend/dist/migrations')
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => Object.values(require(`/app/backend/dist/migrations/${file}`)))
    .filter((entry) => typeof entry === 'function' && /^[A-Za-z]+\d{13}$/.test(entry.name) && entry.name !== migration);
  assert.equal(classes.length, 43, 'Every migration but the classification: exactly forty-three');
  const prior = new DataSource({ type: 'postgres', host: settings.DB_HOST, port: Number(settings.DB_PORT),
    username: settings.DB_USERNAME, password: settings.DB_PASSWORD, database,
    synchronize: false, migrationsRun: false, installExtensions: false, migrations: classes });
  await prior.initialize();
  try {
    await prior.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await prior.runMigrations({ transaction: 'all' });
  } finally { await prior.destroy(); }
}
function migrate() {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function tableRows(db) {
  const rows = {};
  for (const { tablename } of await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")) {
    assert.match(tablename, /^[a-z_]+$/);
    rows[tablename] = (await db.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t`)).map(({ row }) => row)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return rows;
}
const schemaColumns = (db) => db.query(`SELECT table_name, column_name, ordinal_position, data_type,
  is_nullable, column_default FROM information_schema.columns WHERE table_schema='public'
  ORDER BY table_name, ordinal_position`);
const schemaConstraints = (db) => db.query(`SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS definition
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' ORDER BY c.relname, k.conname`);
const rejected = (action, status) => assert.rejects(async () => action(), (error) => error.getStatus?.() === status);
const classOf = async (db, id) => (await db.query(
  'SELECT "assetType","valuationCurrency","priceSource" FROM accounting_instruments WHERE id=$1', [id]))[0];
const legacyInstrument = async (db, owner, name, symbol, requestId = randomUUID()) => (await db.query(
  `INSERT INTO accounting_instruments(id,"ownerId","requestId","canonicalPayload",name,symbol)
  VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
  [randomUUID(), owner, requestId, JSON.stringify({ name, symbol }), name, symbol]))[0].id;

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await createDatabase();
  stage = 'AST-TYPES previous schema and populated fixture';
  await createPreviousSchema();
  const db = sourceFor();
  await db.initialize();
  try {
    const s = services(db);
    const [owner, other] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('asset-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('asset-other@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const legacyRequest = randomUUID();
    const btc = await legacyInstrument(db, owner, 'Bitcoin', 'BTC', legacyRequest);
    const eth = await legacyInstrument(db, owner, 'Ether', 'eth');
    const cash = await legacyInstrument(db, owner, 'Cash USD', 'USD');
    const untitled = await legacyInstrument(db, other, 'No ticker', null);
    const trading = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Synthetic trading account' })).value.id;
    await s.trades.initialize(owner, trading, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
    const trade = (instrumentId, revision, side, quantity, grossUsd) => s.trades.create(owner, trading, {
      requestId: randomUUID(), expectedJournalRevision: revision, instrumentId, side,
      occurredAt: '2025-06-13T00:00:00Z', orderWithinTimestamp: revision, quantity, grossUsd, feeUsd: '0' });
    await trade(btc, 0, 'buy', '0.00918359', '1000');
    await trade(eth, 1, 'buy', '0.195430476249505', '500');
    await trade(btc, 2, 'sell', '0.001', '120');
    const cashAccount = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Cash' })).value.id;
    await s.accounting.saveOpening(owner, cashAccount, { requestId: randomUUID(), expectedRevision: 0, asOf: coverageFrom,
      positions: [{ instrumentId: cash, quantity: '150000', costStatus: 'known', totalCostUsd: '150000' }] });
    for (const [instrumentId, priceUsd] of [[btc, '84945'], [eth, '2500']]) {
      await s.prices.set(owner, instrumentId, { requestId: randomUUID(), expectedRevision: 0, observedAt: at, priceUsd, assertReviewed: true });
    }
    const valuationBefore = await s.valuation.getSnapshot(owner, trading, { at });
    assert.equal(valuationBefore.totalValueUsd, '1183.7312431737625');
    const rowsBefore = await tableRows(db);
    const columnsBefore = await schemaColumns(db);
    const constraintsBefore = await schemaConstraints(db);
    assert.equal(columnsBefore.some(isNewColumn), false);

    stage = 'AST-TYPES migration classifies existing instruments';
    assert.match(migrate(), /Migrations applied: 1\b/);
    assert.deepEqual(await classOf(db, btc), { assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market' });
    assert.deepEqual(await classOf(db, eth), { assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market' });
    assert.deepEqual(await classOf(db, cash), { assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' });
    assert.deepEqual(await classOf(db, untitled), { assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' });
    const rowsAfter = await tableRows(db);
    for (const [table, rows] of Object.entries(rowsBefore)) {
      if (table === 'migrations') continue;
      const after = table === 'accounting_instruments'
        ? rowsAfter[table].map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !newColumns.includes(key))))
        : rowsAfter[table];
      assert.deepEqual(after, rows, `Every previous ${table} row and value is unchanged`);
    }
    assert.deepEqual(Object.keys(rowsAfter).sort(), Object.keys(rowsBefore).sort(), 'No table is added or removed');
    const columnsAfter = await schemaColumns(db);
    assert.deepEqual(columnsAfter.filter((row) => !isNewColumn(row)), columnsBefore);
    assert.deepEqual(columnsAfter.filter(isNewColumn).map((row) =>
      [row.table_name, row.column_name, row.data_type, row.is_nullable, row.column_default]), [
      ['accounting_instruments', 'assetType', 'text', 'NO', "'manual'::text"],
      ['accounting_instruments', 'valuationCurrency', 'text', 'NO', "'USD'::text"],
      ['accounting_instruments', 'priceSource', 'text', 'NO', "'manual'::text"],
    ]);
    const constraintsAfter = await schemaConstraints(db);
    const added = ['accounting_instruments_asset_classification', 'accounting_instruments_asset_values'];
    // PostgreSQL 18 also lists each new NOT NULL column as a named constraint.
    const notNull = (row) => row.relname === 'accounting_instruments' && newColumns.some((column) =>
      row.conname === `accounting_instruments_${column}_not_null` && row.definition === `NOT NULL "${column}"`);
    assert.deepEqual(constraintsAfter.filter((row) => !added.includes(row.conname) && !notNull(row)), constraintsBefore);
    assert.deepEqual(constraintsAfter.filter((row) => added.includes(row.conname)).map((row) => row.conname), added);
    assert.deepEqual(await s.valuation.getSnapshot(owner, trading, { at }), valuationBefore, 'Valuation is identical');
    assert.match(migrate(), /Migrations applied: 0\b/);
    const { ClassifyAssets1790700000000 } = require('/app/backend/dist/migrations/1790700000000-ClassifyAssets.js');
    await assert.rejects(() => new ClassifyAssets1790700000000().down(), /recovery plan/);
    console.log('PASS AST-TYPES crypto tickers classified, cash stays manual, every other row/column and valuation unchanged; replay 0; down refuses');

    stage = 'AST-LEGACY previous create body';
    const replay = await s.accounting.createInstrument(owner, { requestId: legacyRequest.toUpperCase(), name: 'Bitcoin', symbol: 'BTC' });
    assert.equal(replay.created, false);
    assert.equal(replay.value.id, btc);
    assert.deepEqual([replay.value.assetType, replay.value.valuationCurrency, replay.value.priceSource], ['crypto', 'USD', 'market']);
    await rejected(() => s.accounting.createInstrument(owner, { requestId: legacyRequest, name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' }), 409);
    const ether = await s.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Ethereum', symbol: 'ETH' });
    assert.deepEqual([ether.created, ether.value.assetType, ether.value.valuationCurrency, ether.value.priceSource], [true, 'crypto', 'USD', 'market']);
    const plain = await s.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Something' });
    assert.deepEqual([plain.value.symbol, plain.value.assetType, plain.value.valuationCurrency, plain.value.priceSource], [null, 'manual', 'USD', 'manual']);
    console.log('PASS AST-LEGACY pre-migration replay 200 with classification; legacy bodies classified by ticker');

    stage = 'AST-NEW manual deposit in rubles';
    const depositBody = { requestId: randomUUID(), name: 'Deposit', assetType: 'manual', valuationCurrency: 'RUB' };
    const deposit = await s.accounting.createInstrument(owner, depositBody);
    assert.equal(deposit.created, true);
    assert.deepEqual({ ...deposit.value, id: undefined, createdAt: undefined }, { id: undefined, createdAt: undefined,
      name: 'Deposit', symbol: null, namespace: 'manual', assetType: 'manual', valuationCurrency: 'RUB', priceSource: 'manual' });
    const again = await s.accounting.createInstrument(owner, { ...depositBody });
    assert.deepEqual(again, { created: false, value: deposit.value });
    const listed = [];
    for (let cursor; ;) {
      const page = await s.accounting.listInstruments(owner, { limit: 2, ...(cursor ? { cursor } : {}) });
      listed.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(listed.find((item) => item.id === deposit.value.id), deposit.value);
    assert.equal(listed.filter((item) => item.name === 'Deposit').length, 1);
    assert.equal(listed.some((item) => item.id === untitled), false, 'Owner scoped');
    console.log('PASS AST-NEW manual RUB deposit stored, listed once, replayed 200');

    stage = 'AST-RULES derived sources and refusals';
    const made = {};
    for (const [key, body] of Object.entries({
      bitcoin: { name: 'Bitcoin again', symbol: 'btc', assetType: 'crypto' },
      toncoin: { name: 'Toncoin', symbol: 'TON', assetType: 'crypto' },
      rubles: { name: 'Rubles', symbol: 'RUB', assetType: 'fiat' },
    })) made[key] = (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value;
    assert.deepEqual(Object.values(made).map((v) => [v.assetType, v.valuationCurrency, v.priceSource]),
      [['crypto', 'USD', 'market'], ['crypto', 'USD', 'manual'], ['fiat', 'RUB', 'fixed']]);
    const beforeRefusals = await tableRows(db);
    for (const body of [
      { name: 'Pounds', symbol: 'GBP', assetType: 'fiat' },
      { name: 'Coin', assetType: 'crypto' },
      { name: 'Coin', symbol: 'BTC', assetType: 'crypto', valuationCurrency: 'EUR' },
      { name: 'Dollars', symbol: 'USD', assetType: 'fiat', valuationCurrency: 'RUB' },
      { name: 'Deposit', valuationCurrency: 'RUB' },
      { name: 'Shares', assetType: 'stock' },
      { name: 'Number', assetType: 1 },
      { name: 'Source', assetType: 'manual', priceSource: 'market' },
    ]) await rejected(() => s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body }), 400);
    assert.deepEqual(await tableRows(db), beforeRefusals, 'Refusals write nothing');
    for (const [assetType, symbol, valuationCurrency, priceSource] of [
      ['fiat', 'USD', 'USD', 'market'], ['crypto', 'BTC', 'RUB', 'market'], ['crypto', null, 'USD', 'manual'],
      ['manual', null, 'USD', 'fixed'], ['stock', 'X', 'USD', 'manual'], ['manual', null, 'GBP', 'manual'],
      ['fiat', null, 'USD', 'fixed'], ['crypto', 'BTC', 'USD', 'fixed'],
    ]) {
      await assert.rejects(() => db.query(`INSERT INTO accounting_instruments
        (id,"ownerId","requestId","canonicalPayload",name,symbol,"assetType","valuationCurrency","priceSource")
        VALUES ($1,$2,$3,'{}','Direct',$4,$5,$6,$7)`, [randomUUID(), owner, randomUUID(), symbol, assetType, valuationCurrency, priceSource]),
      /check constraint/);
    }
    const direct = await legacyInstrument(db, owner, 'Direct writer', 'BTC');
    assert.deepEqual(await classOf(db, direct), { assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' });
    console.log('PASS AST-RULES derived sources, 400 refusals without writes, PostgreSQL rejects invalid direct writes, old writers get manual defaults');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(`FAIL asset classification acceptance at stage: ${stage}`);
  console.error(error);
  process.exitCode = 1;
});
