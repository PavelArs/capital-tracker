'use strict';
// Only fresh synthetic PostgreSQL; production compiled services and actual queries.
// split-market-and-flows: FLOW-SPLIT-DEPOSIT/MIXED/TRANSFER on real operations, flow rules
// of section 2 (buy, sell, carry-in, own transfer, legacy declared flows), net invested and
// the three currencies at each flow's own Bank of Russia rate, and trades paid in RUB or EUR.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_capital_flows_e2e';
const modulePath = '/app/backend/dist/portfolio-snapshots/capital-flows.js';
const DAY = 86_400_000;
const now = new Date('2026-10-04T12:30:00.000Z');
const firstClose = Date.parse('2025-01-02T00:00:00.000Z');
// Synthetic Kraken daily closes, one per UTC midnight, as in portfolio-snapshots-db.
const btcClose = (iso) => 50000 + 10 * ((Date.parse(iso) - firstClose) / DAY);
let stage = 'synthetic configuration';

// Exact decimal arithmetic at scale 30 (no floating point).
const SCALE = 30;
function scaled(value) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const digits = BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -digits : digits;
}
function decimal(atoms) {
  const sign = atoms < 0n ? '-' : '';
  const digits = (atoms < 0n ? -atoms : atoms).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return `${sign}${digits.slice(0, -SCALE)}${fraction ? `.${fraction}` : ''}`;
}
const plus = (...values) => decimal(values.reduce((sum, value) => sum + scaled(value), 0n));
const minus = (left, right) => decimal(scaled(left) - scaled(right));
const times = (left, right) => decimal((scaled(left) * scaled(right)) / 10n ** BigInt(SCALE));
function percent(numerator, denominator) {
  const top = scaled(numerator);
  const bottom = scaled(denominator);
  const magnitude = ((top < 0n ? -top : top) * 10000n * 2n + bottom) / (bottom * 2n);
  return `${top < 0n && magnitude > 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 2 } });
}
function services(db) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  const { PortfolioSnapshotsService } = require('/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js');
  return { accounting: make('accounting.service', 'AccountingService'),
    trades: make('trade.service', 'TradeService'), carry: make('carry-in.service', 'CarryInService'),
    transfers: make('owned-transfer.service', 'OwnedTransferService'),
    flows: make('portfolio-flow.service', 'PortfolioFlowService'),
    snapshots: new PortfolioSnapshotsService(db, new ConfigService({})) };
}
async function fingerprint(db, skip = []) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    if (skip.includes(tablename)) continue;
    rows.push([tablename, await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function providerRequests() {
  const response = await fetch('http://providers:8080/__control/requests');
  assert.equal(response.status, 200);
  return response.json();
}
async function revision(db, owner, account) {
  const [row] = await db.query(`SELECT "currentRevision" FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2`,
    [owner, account]);
  return row.currentRevision;
}
async function account(s, owner, name, start) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (start) await s.trades.initialize(owner, id, { requestId: randomUUID(), coverageFrom: start, assertEmpty: true });
  return id;
}
async function trade(db, s, owner, target, instrumentId, side, occurredAt, quantity, grossUsd, feeUsd = '0') {
  await s.trades.create(owner, target, { requestId: randomUUID(),
    expectedJournalRevision: await revision(db, owner, target), instrumentId, side, occurredAt,
    orderWithinTimestamp: 0, quantity, grossUsd, feeUsd });
}
const point = (history, at) => history.points.find((entry) => entry.at === at);

async function storedHistory(db) {
  stage = 'synthetic stored daily prices and Bank of Russia rates';
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    SELECT 'BTC','USD','kraken',d, 50000 + 10 * (extract(epoch FROM d - timestamptz '2025-01-02 00:00+00') / 86400)::int,
      'daily-close'
    FROM generate_series(timestamptz '2025-01-02 00:00+00', timestamptz '2026-10-04 00:00+00', interval '1 day') d`);
  // Weekdays only: weekends reuse the latest earlier rate. 90 RUB per USD, 100 RUB per EUR.
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    SELECT c.currency,'cbr',d::date,c.rate FROM (VALUES ('USD',90),('EUR',100)) c(currency,rate)
    CROSS JOIN generate_series(date '2025-01-01', date '2026-10-04', interval '1 day') d
    WHERE extract(isodow FROM d) < 6`);
}

async function operations(db, s, f) {
  stage = 'synthetic operations: buys and a sell paid outside, a carry-in and an own transfer with fee';
  const { owner } = f;
  const btc = (await s.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Bitcoin',
    symbol: 'BTC', assetType: 'crypto' })).value.id;
  const trezor = await account(s, owner, 'Trezor', '2025-06-01T00:00:00.000Z');
  const bybit = await account(s, owner, 'Bybit', '2025-06-01T00:00:00.000Z');
  await trade(db, s, owner, trezor, btc, 'buy', '2025-06-13T10:00:00.000Z', '1', '50000');
  await trade(db, s, owner, trezor, btc, 'buy', '2026-09-21T10:00:00.000Z', '0.1', '5000', '10');
  await trade(db, s, owner, trezor, btc, 'sell', '2026-09-25T10:00:00.000Z', '0.05', '3000', '5');
  // Holdings bought on 2025-03-03 for 40000 are carried into a journal starting 2026-09-10.
  const ledger = await account(s, owner, 'Ledger');
  await s.accounting.saveOpening(owner, ledger, { requestId: randomUUID(), expectedRevision: 0,
    asOf: '2026-09-10T00:00:00.000Z', positions: [{ instrumentId: btc, quantity: '2', costStatus: 'known',
      totalCostUsd: '40000' }] });
  await s.carry.initialize(owner, ledger, { requestId: randomUUID(), expectedOpeningRevision: 1,
    lots: [{ instrumentId: btc, acquiredAt: '2025-03-03T00:00:00.000Z', orderWithinTimestamp: 0,
      originalQuantity: '2', originalCostUsd: '40000', remainingQuantity: '2' }], assertReviewed: true });
  await s.transfers.create(owner, { requestId: randomUUID(),
    expectedFromJournalRevision: await revision(db, owner, trezor),
    expectedToJournalRevision: await revision(db, owner, bybit), fromAccountId: trezor, toAccountId: bybit,
    assertInternal: true, instrumentId: btc, occurredAt: '2026-09-28T10:00:00.000Z', orderWithinTimestamp: 0,
    quantity: '0.2', feeInstrumentId: btc, feeQuantity: '0.001' });
}

async function month(db, s, f) {
  stage = 'FLOW-SPLIT-DEPOSIT/MIXED one month with deposits, a withdrawal and a carry-in';
  const providers = await providerRequests();
  const usd = await s.snapshots.history(f.owner, { period: '1M', currency: 'USD' }, now);
  const start = usd.points[0];
  assert.equal(start.at, '2026-09-05T00:00:00.000Z');
  // 0.849 BTC left in Trezor after the sale, the transfer and its fee, 0.2 in Bybit, 2 in Ledger.
  assert.equal(usd.value, times('3.049', String(btcClose('2026-10-04T00:00:00.000Z'))));
  // A buy deposits gross plus fee; a sale withdraws its proceeds net of fee; carried holdings
  // enter with their cost when their journal starts. The own transfer moves no money.
  assert.deepEqual([usd.deposits, usd.withdrawals, usd.netFlow], ['45010', '2995', '42015']);
  const market = minus(minus(usd.value, start.value), usd.netFlow);
  assert.equal(usd.marketEffect, market, 'marketEffect = V1 − V0 − netFlow');
  assert.equal(usd.marketReturnPercent, percent(market, plus(start.value, usd.deposits)),
    'marketReturn = marketEffect / (V0 + deposits)');
  assert.equal(plus(usd.marketEffect, usd.netFlow), usd.change, 'Market and flows add up to the change');
  // Net invested steps with each flow, at or after its instant.
  for (const [at, invested] of [['2026-09-05T00:00:00.000Z', '50000'], ['2026-09-10T00:00:00.000Z', '90000'],
    ['2026-09-21T00:00:00.000Z', '90000'], ['2026-09-22T00:00:00.000Z', '95010'],
    ['2026-09-26T00:00:00.000Z', '92015'], ['2026-09-29T00:00:00.000Z', '92015']])
    assert.equal(point(usd, at).invested, invested, at);
  assert.equal(usd.points.at(-1).invested, '92015');
  assert.equal(usd.invested, '92015');
  // Flows per currency: each at its own date's rate (90 RUB and 100 RUB per EUR every day here),
  // the carry-in at its 2025-03-03 purchase date like its cost basis.
  for (const [currency, factor] of [['RUB', '90'], ['EUR', '0.9']]) {
    const other = await s.snapshots.history(f.owner, { period: '1M', currency }, now);
    assert.deepEqual([other.deposits, other.withdrawals, other.netFlow, other.invested],
      ['45010', '2995', '42015', '92015'].map((usdAmount) => times(usdAmount, factor)), currency);
    assert.equal(other.marketEffect, minus(minus(other.value, other.points[0].value), other.netFlow), currency);
    assert.equal(other.marketReturnPercent, usd.marketReturnPercent, `${currency} return at constant rates`);
  }
  assert.deepEqual(await providerRequests(), providers, 'Flows never call a provider');
  console.log('PASS FLOW-SPLIT-DEPOSIT/MIXED deposits, withdrawal, carry-in, net invested and three currencies');
}

async function transfer(db, s, f) {
  stage = 'FLOW-SPLIT-TRANSFER a period with only an own transfer and its fee';
  const week = await s.snapshots.history(f.owner, { period: '7D', currency: 'USD' }, now);
  assert.equal(week.points[0].at, '2026-09-28T00:00:00.000Z');
  assert.deepEqual([week.deposits, week.withdrawals, week.netFlow], ['0', '0', '0']);
  assert.equal(week.marketEffect, week.change, 'Without flows the whole change is market');
  // The transfer day: the fee of 0.001 BTC is a market loss, not a withdrawal.
  const day = (at) => point(week, at);
  const before = day('2026-09-28T00:00:00.000Z');
  const after = day('2026-09-29T00:00:00.000Z');
  assert.equal(before.value, times('3.05', String(btcClose(before.at))));
  assert.equal(after.value, times('3.049', String(btcClose(after.at))));
  assert.equal(before.invested, after.invested);
  console.log('PASS FLOW-SPLIT-TRANSFER own transfer: net flow 0, its fee is market effect');
}

async function allTime(db, s, f) {
  stage = 'all time from zero equals value minus net invested';
  const all = await s.snapshots.history(f.owner, { period: 'ALL', currency: 'USD' }, now);
  assert.deepEqual([all.points[0].at, all.points[0].value, all.points[0].invested],
    ['2025-01-01T00:00:00.000Z', '0', '0']);
  assert.equal(point(all, '2025-06-14T00:00:00.000Z').invested, '50000');
  assert.deepEqual([all.deposits, all.withdrawals, all.netFlow], ['95010', '2995', '92015']);
  assert.equal(all.marketEffect, minus(all.value, all.invested), 'From zero: market = value − net invested');
  assert.equal(all.marketReturnPercent, percent(all.marketEffect, all.deposits));
  // PROFIT-ALL-TIME: profit or loss to date is value − all-time net invested in every period.
  assert.deepEqual([all.profit, all.profitPercent], [minus(all.value, all.invested),
    percent(minus(all.value, all.invested), all.invested)]);
  for (const period of ['24H', '7D', '1M', '1Y']) {
    const other = await s.snapshots.history(f.owner, { period, currency: 'USD' }, now);
    assert.deepEqual([other.invested, other.profit, other.profitPercent], [all.invested, all.profit,
      all.profitPercent], period);
  }
  console.log('PASS FLOW-SPLIT/PROFIT-ALL-TIME market from zero and profit to date are value minus net invested');
}

async function legacy(db, s, f) {
  stage = 'legacy owner-declared USD flows change neither holdings nor flows';
  const before = await s.snapshots.history(f.owner, { period: '1M', currency: 'USD' }, now);
  await s.flows.initialize(f.owner, { requestId: randomUUID(), coverageFrom: '2025-01-01T00:00:00.000Z',
    assertReviewed: true });
  await s.flows.create(f.owner, { requestId: randomUUID(), expectedJournalRevision: 0, direction: 'contribution',
    occurredAt: '2026-09-15T00:00:00.000Z', amountUsd: '7777', assertExternal: true });
  const after = await s.snapshots.history(f.owner, { period: '1M', currency: 'USD' }, now);
  assert.deepEqual(after, before, 'A declared flow without holdings would only invent market effect');
  console.log('PASS legacy declared USD flows are not counted twice');
}

async function rates(db, s, f) {
  stage = 'a flow without a Bank of Russia rate leaves net invested unknown, never zero';
  const { early, other } = f;
  const btc = (await s.accounting.createInstrument(early, { requestId: randomUUID(), name: 'Bitcoin',
    symbol: 'BTC', assetType: 'crypto' })).value.id;
  const wallet = await account(s, early, 'Early wallet', '2024-12-01T00:00:00.000Z');
  // Bank of Russia rates are stored from 2025-01-01 only.
  await trade(db, s, early, wallet, btc, 'buy', '2024-12-20T10:00:00.000Z', '1', '40000');
  const usd = await s.snapshots.history(early, { period: 'ALL', currency: 'USD' }, now);
  assert.ok(usd.points.every((entry) => entry.invested === '40000'));
  assert.deepEqual([usd.netFlow, usd.marketEffect], ['0', minus(usd.value, usd.points[0].value)]);
  const rub = await s.snapshots.history(early, { period: 'ALL', currency: 'RUB' }, now);
  assert.ok(rub.points.every((entry) => entry.invested === null), 'No rate: net invested is unknown');
  assert.equal(rub.invested, null);
  assert.deepEqual([rub.profit, rub.profitPercent], [null, null], 'No rate: profit is unknown, never zero');
  assert.equal(rub.netFlow, '0', 'The flow before the period does not enter its split');
  const recent = await s.snapshots.history(early, { period: '1M', currency: 'RUB' }, now);
  assert.equal(recent.netFlow, '0');
  // Another owner sees no flows of this one.
  const foreign = await s.snapshots.history(other, { period: 'ALL', currency: 'USD' }, now);
  assert.ok(foreign.points.every((entry) => entry.invested === '0'));
  // What the Dashboard reads as an empty portfolio (DASH-EMPTY): nothing held or put in.
  assert.deepEqual([foreign.value, foreign.invested, foreign.complete], ['0', '0', true]);
  assert.ok(foreign.points.every((entry) => entry.value === '0' || entry.value === null));
  assert.deepEqual([foreign.deposits, foreign.withdrawals, foreign.netFlow, foreign.marketEffect,
    foreign.marketReturnPercent, foreign.profit, foreign.profitPercent], ['0', '0', '0', '0', null, '0', null]);
  const fingerprintBefore = await fingerprint(db, ['portfolio_snapshots', 'portfolio_snapshot_state']);
  await s.snapshots.history(f.owner, { period: '3M', currency: 'EUR' }, now);
  assert.equal(await fingerprint(db, ['portfolio_snapshots', 'portfolio_snapshot_state']), fingerprintBefore,
    'Reading the split writes no operation, price or rate');
  console.log('PASS FLOW-RATE missing rate keeps net invested unknown; owners stay private; reads write nothing');
}

async function paidTrades(db, s, f) {
  stage = 'CUR-PAID-RUB a trade paid in RUB or EUR states its flow from the amount paid';
  const { paid } = f;
  const btc = (await s.accounting.createInstrument(paid, { requestId: randomUUID(), name: 'Bitcoin',
    symbol: 'BTC', assetType: 'crypto' })).value.id;
  const wallet = await account(s, paid, 'Paid wallet', '2026-09-01T00:00:00.000Z');
  const create = async (side, occurredAt, quantity, payment) => (await s.trades.create(paid, wallet, {
    requestId: randomUUID(), expectedJournalRevision: await revision(db, paid, wallet), instrumentId: btc, side,
    occurredAt, orderWithinTimestamp: 0, quantity, paid: payment })).value.trade;
  // 7000 RUB at the owner's own 70 RUB per USD (the Bank of Russia rate is 90 here): 100 USD.
  const buy = await create('buy', '2026-09-15T10:00:00.000Z', '0.01', { currency: 'RUB', gross: '7000', fee: '0',
    perUsd: '70' });
  assert.deepEqual([buy.grossUsd, buy.feeUsd], ['100', '0']);
  // 400 EUR minus a 4 EUR fee at the Bank of Russia cross rate of the sale date.
  const sale = await create('sell', '2026-09-22T10:00:00.000Z', '0.004', { currency: 'EUR', gross: '400', fee: '4' });
  const proceedsUsd = minus(sale.grossUsd, sale.feeUsd);
  const expected = { USD: ['100', proceedsUsd], RUB: ['7000', '39600'], EUR: ['70', '396'] };
  for (const [currency, [deposits, withdrawals]] of Object.entries(expected)) {
    const history = await s.snapshots.history(paid, { period: '1M', currency }, now);
    assert.deepEqual([history.deposits, history.withdrawals, history.netFlow, history.invested],
      [deposits, withdrawals, minus(deposits, withdrawals), minus(deposits, withdrawals)], currency);
    assert.equal(history.marketEffect, minus(minus(history.value, history.points[0].value), history.netFlow), currency);
  }
  console.log('PASS CUR-PAID-RUB flows of trades paid in RUB or EUR are exact in that currency');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact isolated settings required');
  assert.ok(existsSync(modulePath), 'Missing implementation is prerequisite failure, not RED');
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0, 'Never reuse or drop an existing database');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...settings, ...process.env, DB_NAME: database }, encoding: 'utf8', timeout: 60000 });
  assert.equal(migrated.status, 0, 'Actual schema migration');
  assert.match(migrated.stdout, /Migrations applied: 48/);
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 48);
    const [owner, early, other, paid] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('flows-owner@example.invalid','synthetic-not-a-hash',true),
      ('flows-early@example.invalid','synthetic-not-a-hash',true),
      ('flows-other@example.invalid','synthetic-not-a-hash',true),
      ('flows-paid@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, early: early.id, other: other.id, paid: paid.id };
    await storedHistory(db);
    await operations(db, s, f);
    for (const check of [month, transfer, allTime, legacy, rates, paidTrades]) await check(db, s, f);
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 240000);
watchdog.unref();
main().catch((error) => { console.error(`FAIL ${stage}: ${error.message}`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
