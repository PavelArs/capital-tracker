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
const database = 'capital_tracker_portfolio_valuation_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/portfolio-valuation.service.js';
const now = new Date();
const ago = (minutes) => new Date(now.getTime() - minutes * 60_000);
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
    transfers: make('owned-transfer.service', 'OwnedTransferService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService') };
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
async function instrument(s, owner, body) {
  return (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value.id;
}
async function account(s, owner, name, start = coverageFrom) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (start) await s.trades.initialize(owner, id, { requestId: randomUUID(), coverageFrom: start, assertEmpty: true });
  return { id, revision: 0 };
}
async function trade(s, owner, target, instrumentId, side, occurredAt, quantity, grossUsd) {
  await s.trades.create(owner, target.id, { requestId: randomUUID(), expectedJournalRevision: target.revision,
    instrumentId, side, occurredAt, orderWithinTimestamp: 0, quantity, grossUsd, feeUsd: '0' });
  target.revision++;
}
async function observe(db, asset, price, observedAt, source = 'kraken') {
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ($1,'USD',$2,$3,$4,'hourly-close')`, [asset, source, observedAt, price]);
}
const read = (s, owner, query = {}) => s.portfolio.read(owner, query, now);
const asset = (report, id) => report.assets.find((entry) => entry.instrumentId === id);
const shares = (slices) => slices.map((slice) => [slice.label, slice.percent]);

async function wholePortfolio(db, s, f) {
  stage = 'PV-TOTAL/MARKET/STALE/MANUAL/FIXED/REALIZED/ALLOC every account, stored prices, FIFO';
  const { owner, other } = f;
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const eth = await instrument(s, owner, { name: 'Ethereum', symbol: 'eth', assetType: 'crypto' });
  const usd = await instrument(s, owner, { name: 'US dollar', symbol: 'USD', assetType: 'fiat' });
  const deposit = await instrument(s, owner, { name: 'Deposit', assetType: 'manual', valuationCurrency: 'USD' });
  const ton = await instrument(s, owner, { name: 'Toncoin', symbol: 'TON', assetType: 'crypto' });
  const trust = await account(s, owner, 'Trust Wallet');
  const bybit = await account(s, owner, 'Bybit');
  await account(s, owner, 'No journal yet', null);
  await trade(s, owner, bybit, btc, 'buy', '2025-01-02T00:00:00.000Z', '0.05', '3500');
  await trade(s, owner, bybit, btc, 'buy', '2025-01-02T01:00:00.000Z', '0.01', '600');
  await trade(s, owner, bybit, eth, 'buy', '2025-01-02T02:00:00.000Z', '1', '1000');
  await trade(s, owner, bybit, eth, 'buy', '2025-01-02T03:00:00.000Z', '1', '1500');
  await trade(s, owner, bybit, eth, 'sell', '2025-01-04T00:00:00.000Z', '1', '1800');
  await trade(s, owner, bybit, usd, 'buy', '2025-01-04T01:00:00.000Z', '1500', '1500');
  await trade(s, owner, bybit, deposit, 'buy', '2025-01-04T02:00:00.000Z', '1', '2000');
  await s.transfers.create(owner, { requestId: randomUUID(), fromAccountId: bybit.id, toAccountId: trust.id,
    expectedFromJournalRevision: bybit.revision, expectedToJournalRevision: trust.revision, assertInternal: true,
    instrumentId: btc, occurredAt: '2025-01-03T00:00:00.000Z', orderWithinTimestamp: 0, quantity: '0.03',
    feeInstrumentId: null, feeQuantity: '0' });
  // Market: latest at or before now wins; a future observation is ignored; ETH only has a stale one.
  await observe(db, 'BTC', '60000', ago(180));
  await observe(db, 'BTC', '70000', ago(30), 'coingecko');
  await observe(db, 'BTC', '99999', new Date(now.getTime() + 3_600_000));
  await observe(db, 'ETH', '2000', ago(180));
  // The price a day earlier gives the 24-hour change; ETH has none from then.
  await observe(db, 'BTC', '56000', ago(24 * 60 + 30));
  // Manual: the later point is voided and the future one is not yet effective.
  const point = (revision, observedAt, priceUsd) => ({ requestId: randomUUID(), expectedRevision: revision,
    observedAt, priceUsd, assertReviewed: true });
  await s.prices.set(owner, deposit, point(0, '2025-01-05T00:00:00.000Z', '2300'));
  await s.prices.set(owner, deposit, point(1, '2025-01-06T00:00:00.000Z', '9999'));
  await s.prices.void(owner, deposit, { requestId: randomUUID(), expectedRevision: 2,
    observedAt: '2025-01-06T00:00:00.000Z', assertReviewed: true });
  await s.prices.set(owner, deposit, point(3, '2099-01-01T00:00:00.000Z', '1'));
  // Another owner's holdings and prices never mix in.
  const foreignBtc = await instrument(s, other, { name: 'Foreign bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const foreign = await account(s, other, 'Foreign');
  await trade(s, other, foreign, foreignBtc, 'buy', '2025-01-02T00:00:00.000Z', '5', '1');

  const before = await fingerprint(db);
  const providers = await providerRequests();
  const report = await read(s, owner);
  assert.deepEqual(Object.keys(report).sort(), ['at', 'currency', 'mainCurrency', 'rates', 'completeness', 'totalValue',
    'pricedSubtotal', 'missingPriceCount', 'stalePriceCount', 'unavailableAccountCount', 'costBasis',
    'knownCostSubtotal', 'unknownCostCount', 'missingRateCount', 'unrealizedPnl', 'unrealizedReturnPercent', 'realizedPnl',
    'knownRealizedSubtotal', 'unknownRealizedCount', 'assets', 'allocation', 'accounts'].sort());
  // No Bank of Russia rate is stored here: USD is the default main currency and needs none.
  assert.deepEqual([report.currency, report.mainCurrency, report.rates, report.missingRateCount], ['USD', 'USD', [], 0]);
  assert.equal(report.at, now.toISOString());
  assert.equal(report.completeness, 'complete');
  assert.equal(report.totalValue, '10000');
  assert.equal(report.stalePriceCount, 1);
  assert.equal(report.costBasis, '9100');
  assert.equal(report.unrealizedPnl, '900');
  assert.equal(report.unrealizedReturnPercent, '9.89');
  assert.equal(report.realizedPnl, '800');
  assert.deepEqual(report.assets.map((entry) => entry.name), ['Bitcoin', 'Deposit', 'Ethereum', 'US dollar', 'Toncoin']);
  const bitcoin = asset(report, btc);
  assert.deepEqual(bitcoin.price, { value: '70000', observedAt: ago(30).toISOString(), source: 'coingecko', status: 'fresh' });
  assert.equal(bitcoin.quantity, '0.06');
  assert.equal(bitcoin.value, '4200');
  assert.equal(bitcoin.costBasis, '4100');
  assert.equal(bitcoin.averageBuyPrice, '68333.333333333333333333333333333333');
  assert.equal(bitcoin.unrealizedPnl, '100');
  assert.deepEqual(bitcoin.holdings.map((h) => [h.accountName, h.quantity, h.value]),
    [['Bybit', '0.03', '2100'], ['Trust Wallet', '0.03', '2100']], 'A transferred lot counts once');
  const ether = asset(report, eth);
  assert.deepEqual(ether.price, { value: '2000', observedAt: ago(180).toISOString(), source: 'kraken', status: 'stale' });
  assert.equal(ether.quantity, '1');
  assert.equal(ether.costBasis, '1500');
  assert.equal(ether.averageBuyPrice, '1500');
  assert.equal(ether.realizedPnl, '800');
  assert.equal(ether.unrealizedPnl, '500');
  assert.deepEqual(asset(report, deposit).price, { value: '2300', observedAt: '2025-01-05T00:00:00.000Z',
    source: 'manual', status: 'manual' });
  assert.deepEqual(asset(report, usd).price, { value: '1', observedAt: null, source: 'fixed', status: 'fixed' });
  assert.equal(asset(report, usd).value, '1500');
  assert.deepEqual(report.assets.map((entry) => [entry.name, entry.priceChange24hPercent]), [['Bitcoin', '25.00'],
    ['Deposit', '0.00'], ['Ethereum', null], ['US dollar', '0.00'], ['Toncoin', null]], 'PV-24H daily price change');
  assert.equal(asset(report, ton).quantity, '0');
  assert.equal(asset(report, ton).value, '0');
  assert.equal(asset(report, ton).missingPrice, 'no-price');
  assert.deepEqual(shares(report.allocation.byAsset),
    [['Bitcoin', '42.00'], ['Deposit', '23.00'], ['Ethereum', '20.00'], ['US dollar', '15.00']]);
  assert.deepEqual(shares(report.allocation.byType), [['Crypto', '62.00'], ['Manual', '23.00'], ['Cash', '15.00']]);
  assert.deepEqual(shares(report.allocation.byAccount), [['Bybit', '79.00'], ['Trust Wallet', '21.00']]);
  assert.deepEqual(report.accounts.map((entry) => [entry.name, entry.coverage]).sort(),
    [['Bybit', 'covered'], ['No journal yet', 'not-started'], ['Trust Wallet', 'covered']]);
  assert.ok(!report.assets.some((entry) => entry.instrumentId === foreignBtc), 'Foreign instruments are absent');
  assert.ok(report.accounts.every((entry) => entry.accountId !== foreign.id), 'Foreign accounts are absent');

  const foreignReport = await read(s, other);
  assert.equal(foreignReport.totalValue, '350000');
  assert.deepEqual(foreignReport.assets.map((entry) => entry.instrumentId), [foreignBtc]);
  await rejected(() => read(s, owner, { at: now.toISOString() }), 400);
  await rejected(() => read(s, owner, []), 400);
  await rejected(() => s.portfolio.read('not-a-uuid', {}, now), 400);
  assert.equal(await fingerprint(db), before, 'Every read and refusal preserves all rows');
  assert.deepEqual(await providerRequests(), providers, 'Reads never call any provider');
  console.log('PASS PV-TOTAL/MARKET/STALE/MANUAL/FIXED/REALIZED/ALLOC/PRIVATE/24H');
}

async function gapsAndInvalidHistory(db, s, f) {
  stage = 'PV-NONE/PV-FIXED no price, no rate, later coverage and invalid saved FIFO';
  const { third } = f;
  const sol = await instrument(s, third, { name: 'Solana', symbol: 'SOL', assetType: 'crypto' });
  const rub = await instrument(s, third, { name: 'Rubles', symbol: 'RUB', assetType: 'fiat' });
  const usd = await instrument(s, third, { name: 'Cash', symbol: 'USD', assetType: 'fiat' });
  const cash = await account(s, third, 'Cash');
  await trade(s, third, cash, sol, 'buy', '2025-01-02T00:00:00.000Z', '3', '300');
  await trade(s, third, cash, rub, 'buy', '2025-01-02T01:00:00.000Z', '100000', '1200');
  await trade(s, third, cash, usd, 'buy', '2025-01-02T02:00:00.000Z', '10', '10');
  const report = await read(s, third);
  assert.equal(report.completeness, 'incomplete');
  assert.equal(report.totalValue, null);
  assert.equal(report.pricedSubtotal, '10');
  assert.equal(report.missingPriceCount, 2);
  assert.equal(report.unrealizedPnl, null);
  assert.equal(asset(report, sol).missingPrice, 'no-price');
  assert.equal(asset(report, sol).value, null);
  assert.equal(asset(report, rub).missingPrice, 'no-rate');
  assert.equal(asset(report, rub).allocationPercent, null);
  assert.equal(report.allocation.complete, false);
  assert.deepEqual(shares(report.allocation.byAsset), [['Cash', '100.00']]);
  await account(s, third, 'Starts later', new Date(now.getTime() + 86_400_000).toISOString());
  const later = await read(s, third);
  assert.equal(later.unavailableAccountCount, 1);
  assert.equal(later.costBasis, null);
  assert.equal(later.accounts.find((entry) => entry.name === 'Starts later').coverage, 'before-coverage');

  const before = await fingerprint(db);
  await db.query(`UPDATE account_trade_versions SET side='sell' WHERE "ownerId"=$1 AND "accountId"=$2`, [third, cash.id]);
  try {
    const invalid = await fingerprint(db);
    await rejected(() => read(s, third), 409);
    assert.equal(await fingerprint(db), invalid, 'Invalid history is not hidden or repaired');
  } finally {
    await db.query(`UPDATE account_trade_versions SET side='buy' WHERE "ownerId"=$1 AND "accountId"=$2`, [third, cash.id]);
  }
  assert.equal(await fingerprint(db), before, 'Synthetic corruption restored exactly');
  console.log('PASS PV-NONE/PV-FIXED gaps and invalid history');
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
  assert.equal(migrated.status, 0, 'Actual schema migration');
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 44);
    const [owner, other, third] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('portfolio-owner@example.invalid','synthetic-not-a-hash',true),
      ('portfolio-other@example.invalid','synthetic-not-a-hash',true),
      ('portfolio-third@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id, third: third.id };
    for (const check of [wholePortfolio, gapsAndInvalidHistory]) await check(db, s, f);
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 180000);
watchdog.unref();
main().catch((error) => { console.error(`FAIL ${stage}: ${error.message}`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
