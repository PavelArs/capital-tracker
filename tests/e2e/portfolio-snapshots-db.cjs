'use strict';
// Only fresh synthetic PostgreSQL; production compiled services and actual queries.
// record-portfolio-snapshots: SNAP-BACKFILL, SNAP-HOURLY, SNAP-REBUILD and the history read.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_portfolio_snapshots_e2e';
const modulePath = '/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js';
const DAY = 86_400_000;
const HOUR = 3_600_000;
// A fixed instant keeps every daily point deterministic: 642 days from 2025-01-01.
const now = new Date('2026-10-04T12:30:00.000Z');
const later = (ms) => new Date(now.getTime() + ms);
const firstClose = Date.parse('2025-01-02T00:00:00.000Z');
// Synthetic Kraken daily closes as the M3 backfill stores them: one per UTC midnight.
const btcClose = (ms) => 50000 + 10 * ((ms - firstClose) / DAY);
const currencies = ['EUR', 'RUB', 'USD'];
let stage = 'synthetic configuration';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 2 } });
}
function services(db, env = {}) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  const { PortfolioSnapshotsService } = require(modulePath);
  return { accounting: make('accounting.service', 'AccountingService'),
    trades: make('trade.service', 'TradeService'), prices: make('manual-price.service', 'ManualPriceService'),
    snapshots: new PortfolioSnapshotsService(db, new ConfigService(env)) };
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
// The isolated acceptance stack records every provider request.
async function providerRequests() {
  const response = await fetch('http://providers:8080/__control/requests');
  assert.equal(response.status, 200);
  return response.json();
}
const rejected = (action, status) => assert.rejects(async () => action(), (error) => error.getStatus?.() === status);
async function instrument(s, owner, body) {
  return (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value.id;
}
async function account(s, owner, name, start) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await s.trades.initialize(owner, id, { requestId: randomUUID(), coverageFrom: start, assertEmpty: true });
  return { id, revision: 0 };
}
async function trade(s, owner, target, instrumentId, side, occurredAt, quantity, grossUsd) {
  await s.trades.create(owner, target.id, { requestId: randomUUID(), expectedJournalRevision: target.revision,
    instrumentId, side, occurredAt, orderWithinTimestamp: 0, quantity, grossUsd, feeUsd: '0' });
  target.revision++;
}
async function snapshots(db, owner) {
  const rows = await db.query(`SELECT "takenAt", currency, value::text AS value, complete, "computedAt"
    FROM portfolio_snapshots WHERE "ownerId"=$1 ORDER BY "takenAt", currency`, [owner]);
  return rows.map((row) => ({ at: row.takenAt.toISOString(), currency: row.currency,
    value: row.value === null ? null : row.value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
    complete: row.complete, computedAt: row.computedAt.toISOString() }));
}
const byKey = (rows) => new Map(rows.map((row) => [`${row.at}:${row.currency}`, row]));
const usdAt = (rows, iso) => rows.find((row) => row.at === iso && row.currency === 'USD');

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

async function backfill(db, s, f) {
  stage = 'SNAP-BACKFILL one daily snapshot per day since 01.01.2025 from stored prices and rates';
  const { owner } = f;
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const deposit = await instrument(s, owner, { name: 'Deposit', assetType: 'manual', valuationCurrency: 'USD' });
  f.btc = btc;
  f.trezor = await account(s, owner, 'Trezor', '2025-06-13T00:00:00.000Z');
  await trade(s, owner, f.trezor, btc, 'buy', '2025-06-13T10:00:00.000Z', '1', '50000');
  await trade(s, owner, f.trezor, deposit, 'buy', '2025-08-01T10:00:00.000Z', '1', '1000');
  await s.prices.set(owner, deposit, { requestId: randomUUID(), expectedRevision: 0,
    observedAt: '2025-09-01T00:00:00.000Z', priceUsd: '1200', assertReviewed: true });
  assert.deepEqual(await snapshots(db, owner), [], 'Nothing is stored before the first run');
  const providers = await providerRequests();
  const result = await s.snapshots.refresh(owner, now);
  assert.equal(result.outcome, 'rebuilt');
  const rows = await snapshots(db, owner);
  const instants = [...new Set(rows.map((row) => row.at))];
  const daily = instants.filter((iso) => iso.endsWith('T00:00:00.000Z'));
  assert.equal(daily.length, 642, 'One daily snapshot per UTC day from 2025-01-01 to 2026-10-04');
  assert.equal(daily[0], '2025-01-01T00:00:00.000Z');
  for (let index = 1; index < daily.length; index++) assert.equal(Date.parse(daily[index]) - Date.parse(daily[index - 1]), DAY);
  assert.deepEqual(instants.filter((iso) => !daily.includes(iso)), ['2026-10-04T12:00:00.000Z'],
    'Hourly snapshots start with the first run');
  assert.equal(rows.length, instants.length * 3, 'Every snapshot is stored in USD, EUR and RUB');
  for (const iso of instants) assert.deepEqual(rows.filter((row) => row.at === iso).map((row) => row.currency), currencies);
  // Days before the first holding are a known zero in every currency.
  for (const row of rows.filter((entry) => entry.at <= '2025-06-13T00:00:00.000Z'))
    assert.deepEqual([row.value, row.complete], ['0', true], `${row.at} ${row.currency}`);
  const midnight = (iso) => Date.parse(iso);
  const check = (iso, usd, complete) => {
    const point = rows.filter((row) => row.at === iso);
    assert.deepEqual(point.map((row) => [row.currency, row.value, row.complete]), [
      ['EUR', String(usd * 0.9), complete], ['RUB', String(usd * 90), complete], ['USD', String(usd), complete]], iso);
  };
  check('2025-06-14T00:00:00.000Z', btcClose(midnight('2025-06-14T00:00:00.000Z')), true);
  // The deposit is held from 1 August but has a price only from 1 September: incomplete, never 0.
  check('2025-08-15T00:00:00.000Z', btcClose(midnight('2025-08-15T00:00:00.000Z')), false);
  check('2025-09-01T00:00:00.000Z', btcClose(midnight('2025-09-01T00:00:00.000Z')) + 1200, true);
  // A Sunday uses Friday's Bank of Russia rate.
  check('2026-10-04T00:00:00.000Z', btcClose(midnight('2026-10-04T00:00:00.000Z')) + 1200, true);
  check('2026-10-04T12:00:00.000Z', btcClose(midnight('2026-10-04T00:00:00.000Z')) + 1200, true);
  const all = await s.snapshots.history(owner, { period: 'ALL', currency: 'USD' }, now);
  assert.deepEqual(Object.keys(all).sort(), ['at', 'change', 'changePercent', 'complete', 'currency', 'deposits',
    'from', 'invested', 'mainCurrency', 'marketEffect', 'marketReturnPercent', 'netFlow', 'period', 'points', 'profit',
    'profitPercent', 'value', 'withdrawals'].sort());
  assert.deepEqual([all.period, all.currency, all.mainCurrency, all.at, all.from],
    ['ALL', 'USD', 'USD', now.toISOString(), '2025-01-01T00:00:00.000Z']);
  assert.equal(all.points[0].at, '2025-01-01T00:00:00.000Z', "The chart's ALL period starts on 01.01.2025 (Q4)");
  assert.equal(all.points.length, 643, 'Every daily point and the current value');
  assert.deepEqual(all.points.at(-1), { at: now.toISOString(), value: all.value, complete: true, invested: '51000' });
  assert.equal(all.value, String(btcClose(midnight('2026-10-04T00:00:00.000Z')) + 1200));
  assert.deepEqual([all.change, all.changePercent], [all.value, null], 'From zero: an amount, no percentage');
  assert.equal(all.complete, false, 'A period with an incomplete point is marked incomplete');
  assert.deepEqual(await providerRequests(), providers, 'Snapshots never call a provider');
  console.log('PASS SNAP-BACKFILL daily since 2025-01-01, zero before the first holding, three currencies');
}

async function hourly(db, s, f) {
  stage = 'SNAP-HOURLY one snapshot per hour; a second run in the same hour adds none';
  const { owner } = f;
  const before = await snapshots(db, owner);
  assert.equal((await s.snapshots.refresh(owner, later(5 * 60_000))).outcome, 'fresh');
  assert.equal((await s.snapshots.refresh(owner, later(29 * 60_000))).outcome, 'fresh');
  assert.deepEqual(await snapshots(db, owner), before, 'A second run in the same hour adds or rewrites nothing');
  assert.equal((await s.snapshots.refresh(owner, later(31 * 60_000))).outcome, 'rebuilt');
  const after = await snapshots(db, owner);
  assert.equal(after.length, before.length + 3);
  assert.deepEqual(after.filter((row) => row.at === '2026-10-04T13:00:00.000Z').map((row) => row.currency), currencies);
  const unchanged = byKey(after);
  for (const row of before) assert.deepEqual(unchanged.get(`${row.at}:${row.currency}`), row);
  // A new hourly close stored for 13:00 rewrites that hour only.
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('BTC','USD','coingecko','2026-10-04T13:00:00Z',70000,'hourly-close')`);
  assert.equal((await s.snapshots.refresh(owner, later(40 * 60_000))).outcome, 'rebuilt');
  const priced = await snapshots(db, owner);
  assert.equal(usdAt(priced, '2026-10-04T13:00:00.000Z').value, '71200');
  const changed = priced.filter((row) => unchanged.get(`${row.at}:${row.currency}`).computedAt !== row.computedAt);
  assert.deepEqual(changed.map((row) => row.at), Array(3).fill('2026-10-04T13:00:00.000Z'));
  console.log('PASS SNAP-HOURLY one snapshot per passed hour, idempotent within the hour');
}

async function rebuild(db, s, f) {
  stage = 'SNAP-REBUILD a buy dated 3 days ago rebuilds snapshots from that instant on';
  const { owner } = f;
  const before = await snapshots(db, owner);
  const providers = await providerRequests();
  const at = '2026-10-01T09:00:00.000Z';
  await trade(s, owner, f.trezor, f.btc, 'buy', at, '0.5', '30000');
  const result = await s.snapshots.refresh(owner, later(45 * 60_000));
  assert.equal(result.outcome, 'rebuilt');
  const after = await snapshots(db, owner);
  assert.equal(after.length, before.length);
  const previous = byKey(before);
  for (const row of after) {
    const old = previous.get(`${row.at}:${row.currency}`);
    if (row.at < at) assert.deepEqual(row, old, `${row.at} before the buy is untouched`);
    else {
      assert.notEqual(row.computedAt, old.computedAt, `${row.at} is rebuilt`);
      assert.ok(Number(row.value) > Number(old.value));
    }
  }
  const close = btcClose(Date.parse('2026-10-02T00:00:00.000Z'));
  assert.equal(usdAt(after, '2026-10-02T00:00:00.000Z').value, String(close * 1.5 + 1200));
  assert.deepEqual(await providerRequests(), providers, 'Rebuilding uses stored prices only');
  // A late price for a past day rebuilds from that day: only that day's value changes.
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('BTC','USD','kraken','2025-07-01T00:00:00Z',12345,'spot')`);
  const priced = await s.snapshots.refresh(owner, later(46 * 60_000));
  assert.equal(priced.outcome, 'rebuilt');
  const repriced = await snapshots(db, owner);
  const kept = byKey(after);
  const moved = repriced.filter((row) => kept.get(`${row.at}:${row.currency}`).computedAt !== row.computedAt);
  assert.deepEqual(moved.map((row) => [row.at, row.currency, row.value]), [
    ['2025-07-01T00:00:00.000Z', 'EUR', '11110.5'], ['2025-07-01T00:00:00.000Z', 'RUB', '1111050'],
    ['2025-07-01T00:00:00.000Z', 'USD', '12345']]);
  // A backdated manual price is seen by the next read without waiting for the job.
  const deposit = (await db.query(`SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND name='Deposit'`, [owner]))[0].id;
  await s.prices.set(owner, deposit, { requestId: randomUUID(), expectedRevision: 1,
    observedAt: '2026-09-30T00:00:00.000Z', priceUsd: '1300', assertReviewed: true });
  const month = await s.snapshots.history(owner, {}, later(47 * 60_000));
  assert.equal(month.period, '1M', 'Default period is one month');
  assert.equal(month.points.length, 31, 'Thirty daily points and the current value');
  assert.equal(month.points[0].at, '2026-09-05T00:00:00.000Z');
  const sept30 = month.points.find((point) => point.at === '2026-09-30T00:00:00.000Z');
  assert.equal(sept30.value, String(btcClose(Date.parse('2026-09-30T00:00:00.000Z')) + 1300));
  const start = Number(month.points[0].value);
  assert.equal(Number(month.change), Number(month.value) - start);
  assert.equal(month.changePercent, ((Number(month.value) - start) / start * 100).toFixed(2));
  assert.equal(month.complete, true);
  console.log('PASS SNAP-REBUILD backdated buy, late price and manual price rebuild from their instant, no provider call');
}

async function assetHistory(db, s, f) {
  stage = 'ASSET-CHART one asset value and cost basis over a period, from stored prices only';
  const { owner, other } = f;
  const at = later(48 * 60_000);
  const deposit = (await db.query(`SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND name='Deposit'`, [owner]))[0].id;
  const before = await fingerprint(db);
  const providers = await providerRequests();
  const month = await s.snapshots.assetHistory(owner, f.btc, { period: '1M', currency: 'USD' }, at);
  assert.deepEqual(Object.keys(month).sort(), ['at', 'currency', 'from', 'instrumentId', 'mainCurrency', 'period', 'points']);
  assert.deepEqual([month.instrumentId, month.period, month.currency, month.at], [f.btc, '1M', 'USD', at.toISOString()]);
  assert.equal(month.points.length, 31, 'Thirty daily points and the current value');
  assert.equal(month.points[0].at, '2026-09-05T00:00:00.000Z');
  const point = (iso) => month.points.find((entry) => entry.at === iso);
  assert.deepEqual(point('2026-09-30T00:00:00.000Z'), { at: '2026-09-30T00:00:00.000Z', quantity: '1',
    value: String(btcClose(Date.parse('2026-09-30T00:00:00.000Z'))), complete: true, cost: '50000', costComplete: true });
  assert.deepEqual(point('2026-10-02T00:00:00.000Z'), { at: '2026-10-02T00:00:00.000Z', quantity: '1.5',
    value: String(btcClose(Date.parse('2026-10-02T00:00:00.000Z')) * 1.5), complete: true, cost: '80000', costComplete: true });
  assert.deepEqual(month.points.at(-1), { at: at.toISOString(), quantity: '1.5', value: '105000', complete: true,
    cost: '80000', costComplete: true }, 'The current value uses the latest stored price');
  const week = await s.snapshots.assetHistory(owner, f.btc, { period: '7D', currency: 'USD' }, at);
  assert.equal(week.points.length, 7 * 24 + 1, 'Hourly points and the current value');
  assert.equal(week.points.find((entry) => entry.at === '2026-10-04T13:00:00.000Z').value, '105000');
  // A manual asset in rubles: value at that day's rate, cost at the purchase date's rate.
  const rub = await s.snapshots.assetHistory(owner, deposit, { period: '1M', currency: 'RUB' }, at);
  assert.deepEqual([rub.points[0].value, rub.points[0].cost], ['108000', '90000']);
  assert.equal(rub.points.find((entry) => entry.at === '2026-09-30T00:00:00.000Z').value, '117000');
  const all = await s.snapshots.assetHistory(owner, deposit, { period: 'ALL' }, at);
  assert.equal(all.points[0].at, '2025-01-01T00:00:00.000Z');
  assert.deepEqual([all.points[0].quantity, all.points[0].value, all.points[0].cost], ['0', '0', '0'],
    'Nothing held before the first buy is a known zero');
  assert.deepEqual(all.points.find((entry) => entry.at === '2025-08-15T00:00:00.000Z'),
    { at: '2025-08-15T00:00:00.000Z', quantity: '1', value: null, complete: false, cost: '1000', costComplete: true },
    'Held without a price is unknown, never zero');
  // Another owner's instrument is not found; invalid input is refused; nothing is written.
  const foreign = (await db.query(`SELECT id FROM accounting_instruments WHERE "ownerId"=$1`, [other]))[0].id;
  await rejected(() => s.snapshots.assetHistory(owner, foreign, {}, at), 404);
  await rejected(() => s.snapshots.assetHistory(owner, randomUUID(), {}, at), 404);
  await rejected(() => s.snapshots.assetHistory(owner, 'not-a-uuid', {}, at), 400);
  for (const query of [{ period: '2W' }, { currency: 'GBP' }, { at: now.toISOString() }, []])
    await rejected(() => s.snapshots.assetHistory(owner, f.btc, query, at), 400);
  assert.equal(await fingerprint(db), before, 'Asset history reads and refusals write nothing');
  assert.deepEqual(await providerRequests(), providers, 'Asset history never calls a provider');
  console.log('PASS ASSET-CHART asset value and known cost per period and currency, privacy and refusals');
}

async function reads(db, s, f) {
  stage = 'history periods, currencies, privacy and refusals';
  const { owner, other } = f;
  const at = later(50 * 60_000);
  const day = await s.snapshots.history(owner, { period: '24H' }, at);
  assert.deepEqual(day.points.slice(0, -1).map((point) => point.at), ['2026-10-04T00:00:00.000Z',
    '2026-10-04T12:00:00.000Z', '2026-10-04T13:00:00.000Z'], 'Midnight, then hourly points since the first run');
  const year = await s.snapshots.history(owner, { period: '1Y', currency: 'RUB' }, at);
  assert.equal(year.currency, 'RUB');
  assert.equal(year.points.length, 366);
  assert.equal(year.value, String(Number((await s.snapshots.history(owner, { period: '1Y', currency: 'USD' }, at)).value) * 90));
  await db.query(`INSERT INTO owner_settings("ownerId","mainCurrency") VALUES ($1,'EUR')`, [owner]);
  const main = await s.snapshots.history(owner, { period: '7D' }, at);
  assert.deepEqual([main.currency, main.mainCurrency], ['EUR', 'EUR'], 'Default currency is the main currency');
  const foreign = await s.snapshots.history(other, { period: 'ALL' }, at);
  assert.ok(foreign.points.every((point) => point.value === '0'), 'Another owner sees only their own empty history');
  const before = await fingerprint(db);
  for (const query of [{ period: '2W' }, { currency: 'GBP' }, { at: now.toISOString() }, { period: ['1M'] }, []])
    await rejected(() => s.snapshots.history(owner, query, at), 400);
  await rejected(() => s.snapshots.history('not-a-uuid', {}, at), 400);
  assert.equal(await fingerprint(db), before, 'Refusals write nothing');
  // Invalid saved FIFO history is reported, never hidden or snapshotted.
  await db.query(`UPDATE account_trade_versions SET side='sell' WHERE "ownerId"=$1 AND "accountId"=$2`, [owner, f.trezor.id]);
  try {
    const invalid = await fingerprint(db);
    await rejected(() => s.snapshots.history(owner, {}, at), 409);
    assert.equal(await fingerprint(db), invalid, 'Invalid history writes no snapshot');
  } finally {
    await db.query(`UPDATE account_trade_versions SET side='buy' WHERE "ownerId"=$1 AND "accountId"=$2`, [owner, f.trezor.id]);
  }
  console.log('PASS CHART-PERIODS data: periods, currencies, main currency, privacy, refusals and invalid history');
}

async function schedule(db, f) {
  stage = 'background job gated by PRICE_COLLECTION_ENABLED';
  const off = services(db).snapshots;
  assert.deepEqual(await off.tick(later(2 * HOUR)), { outcome: 'disabled' });
  const on = services(db, { PRICE_COLLECTION_ENABLED: 'true' }).snapshots;
  const result = await on.tick(later(2 * HOUR));
  assert.equal(result.outcome, 'refreshed');
  assert.deepEqual(result.owners, 2);
  assert.equal((await snapshots(db, f.owner)).filter((row) => row.at === '2026-10-04T14:00:00.000Z').length, 3);
  await assert.rejects(() => db.query(`INSERT INTO portfolio_snapshots("ownerId","takenAt",currency,value,complete)
    VALUES ($1,'2026-10-04T14:30:00Z','USD',1,true)`, [f.owner]), /check/i);
  await assert.rejects(() => db.query(`INSERT INTO portfolio_snapshots("ownerId","takenAt",currency,value,complete)
    VALUES ($1,'2024-12-31T00:00:00Z','USD',1,true)`, [f.owner]), /check/i);
  await assert.rejects(() => db.query(`INSERT INTO portfolio_snapshots("ownerId","takenAt",currency,value,complete)
    VALUES ($1,'2026-10-04T15:00:00Z','USD',-1,true)`, [f.owner]), /check/i);
  await assert.rejects(() => db.query(`INSERT INTO portfolio_snapshots("ownerId","takenAt",currency,value,complete)
    VALUES ($1,'2026-10-04T15:00:00Z','USD',1,true)`, [randomUUID()]), /foreign key/i);
  console.log('PASS SNAP-JOB scheduled refresh for every owner only when collection is enabled; schema checks');
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
  assert.match(migrated.stdout, /Migrations applied: 42/);
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 42);
    assert.deepEqual((await db.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 2')).map(({ name }) => name),
      ['ScanBitcoinXpub1792900000000', 'AddSessionDevice1792800000000']);
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('snapshot-owner@example.invalid','synthetic-not-a-hash',true),
      ('snapshot-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id };
    await storedHistory(db);
    await instrument(s, other.id, { name: 'Foreign bitcoin', symbol: 'BTC', assetType: 'crypto' });
    for (const check of [backfill, hourly, rebuild, assetHistory, reads]) await check(db, s, f);
    await schedule(db, f);
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 240000);
watchdog.unref();
main().catch((error) => { console.error(`FAIL ${stage}: ${error.message}`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
