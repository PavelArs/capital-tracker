'use strict';

// Real PostgreSQL acceptance for account-in-three-currencies (FX-*, CUR-*). Only the external
// Bank of Russia is synthetic: requests leave through HTTPS_PROXY to providers.cjs.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const { FxRatesService } = require('/app/backend/dist/fx-rates/fx-rates.service.js');
const { CbrClient } = require('/app/backend/dist/fx-rates/cbr-client.js');
const { OwnerSettingsService } = require('/app/backend/dist/owner-settings/owner-settings.service.js');
const { AccountInThreeCurrencies1790900000000 } = require('/app/backend/dist/migrations/1790900000000-AccountInThreeCurrencies.js');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const databases = { rates: 'capital_tracker_fx_rates_e2e', accounting: 'capital_tracker_three_currency_e2e' };
const control = 'http://providers:8080/__control';
const HOUR = 3600000;
const DAY = 86400000;
const backfillStart = Date.parse('2025-01-01T00:00:00Z');
const codes = { USD: 'R01235', EUR: 'R01239' };
const base = { R01235: 80, R01239: 90 };
let stage = 'synthetic configuration';

const moscowDay = (ms) => Math.floor((ms + 3 * HOUR) / DAY) * DAY;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const cbrDate = (ms) => isoDate(ms).split('-').reverse().join('/');
// The fixture's formula restated: Tuesday..Saturday from 2025-01-01 to tomorrow (Moscow),
// base + 0.01 per day since 2025-01-01.
function expectedRates(currency, from, to) {
  const rows = [];
  for (let day = from; day <= to; day += DAY) {
    if ([0, 1].includes(new Date(day).getUTCDay())) continue;
    const cents = base[codes[currency]] * 100 + (day - backfillStart) / DAY;
    const tail = String(cents % 100).padStart(2, '0').replace(/0+$/, '');
    rows.push({ currency, rateDate: isoDate(day), rubPerUnit: `${Math.floor(cents / 100)}${tail ? `.${tail}` : ''}` });
  }
  return rows;
}
// A recent instant five minutes into a UTC hour.
const at = (hoursBack = 0) => new Date(Math.floor(Date.now() / HOUR) * HOUR - hoursBack * HOUR + 5 * 60000);

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
}
async function cbrUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => new URL(url)).filter(({ hostname }) => hostname === 'www.cbr.ru');
}
async function newRequests(action) {
  const before = (await cbrUrls()).length;
  const result = await action();
  return { result, urls: (await cbrUrls()).slice(before) };
}
function sourceFor(name) {
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: name })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource(options);
}
async function createDatabase(name) {
  const client = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    assert.equal((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0, 'Never overwrite/reuse an existing database');
    assert.match(name, /^capital_tracker_(fx_rates|three_currency)_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const collector = (db, enabled = true) => new FxRatesService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }), new CbrClient());
async function stored(db) {
  return db.query(`SELECT currency, to_char("rateDate", 'YYYY-MM-DD') AS "rateDate",
    regexp_replace(regexp_replace("rubPerUnit"::text, '0+$', ''), '\\.$', '') AS "rubPerUnit", source
    FROM fx_rates ORDER BY currency DESC, "rateDate"`);
}
async function state(db) {
  return (await db.query(`SELECT * FROM sync_sources WHERE key='fx:cbr'`))[0] ?? null;
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
const rejected = (action, status) => assert.rejects(async () => action(), (error) => error.getStatus?.() === status);

async function migration(db) {
  stage = 'FX-MIGRATION additive tables';
  assert.deepEqual(await stored(db), []);
  assert.deepEqual(await db.query('SELECT * FROM owner_settings'), []);
  await assert.rejects(() => new AccountInThreeCurrencies1790900000000().down(), /recovery plan/);
  console.log('PASS FX-MIGRATION fresh 26 applies once, replay applies none, new tables empty, down refuses');
}

async function disabled(db) {
  stage = 'FX-OFF disabled collector';
  await post('cbr', { base });
  for (const service of [collector(db, false), new FxRatesService(db, new ConfigService({}), new CbrClient())]) {
    const { result, urls } = await newRequests(() => service.tick(at()));
    assert.deepEqual(result, { outcome: 'disabled' });
    assert.deepEqual(urls, [], 'A disabled collector never calls the Bank of Russia');
  }
  assert.deepEqual(await stored(db), []);
  const view = await collector(db).read(at());
  assert.deepEqual(view.rates, [{ currency: 'USD', rubPerUnit: null, date: null }, { currency: 'EUR', rubPerUnit: null, date: null }], 'No rate is null, never 0');
  assert.equal(view.sync, null);
  console.log('PASS FX-OFF collection follows PRICE_COLLECTION_ENABLED; no stored rate reads as null');
}

async function backfill(db) {
  stage = 'PR-FX-1 backfill from 2025-01-01';
  const now = at();
  const tomorrow = moscowDay(now.getTime()) + DAY;
  const { result, urls } = await newRequests(() => collector(db).tick(now));
  assert.deepEqual(urls.map((url) => [url.pathname, url.searchParams.get('VAL_NM_RQ'), url.searchParams.get('date_req1'), url.searchParams.get('date_req2')]),
    [['/scripts/XML_dynamic.asp', 'R01235', '01/01/2025', cbrDate(tomorrow)], ['/scripts/XML_dynamic.asp', 'R01239', '01/01/2025', cbrDate(tomorrow)]]);
  const expected = [...expectedRates('USD', backfillStart, tomorrow), ...expectedRates('EUR', backfillStart, tomorrow)];
  assert.deepEqual(result, { outcome: 'collected', stored: expected.length });
  assert.deepEqual((await stored(db)).map(({ source, ...row }) => { assert.equal(source, 'cbr'); return row; }), expected);
  const sync = await state(db);
  assert.equal(sync.state, 'synced');
  assert.equal(sync.lastSuccessAt.toISOString(), now.toISOString());
  assert.equal(sync.errorCode, null);
  const view = await collector(db).read(now);
  const today = moscowDay(now.getTime());
  const latest = (currency) => expectedRates(currency, backfillStart, today).at(-1);
  assert.deepEqual(view.rates, ['USD', 'EUR'].map((currency) => ({ currency, rubPerUnit: latest(currency).rubPerUnit, date: latest(currency).rateDate })),
    "Today's rate is the latest effective on or before the Moscow date, never tomorrow's");
  console.log(`PASS PR-FX-1 backfilled ${expected.length} Bank of Russia rates from 2025-01-01 to tomorrow; weekends keep gaps`);
  return now;
}

async function incremental(db, first) {
  stage = 'FX-INCREMENTAL due once per hour, overlap re-read is idempotent';
  const before = await stored(db);
  const again = await newRequests(() => collector(db).tick(new Date(first.getTime() + 60000)));
  assert.deepEqual(again.result, { outcome: 'not_due' });
  assert.deepEqual(again.urls, []);
  const next = new Date(first.getTime() + HOUR);
  const { result, urls } = await newRequests(() => collector(db).tick(next));
  const last = Date.parse(`${before.filter((row) => row.currency === 'USD').at(-1).rateDate}T00:00:00Z`);
  assert.deepEqual(urls.map((url) => url.searchParams.get('date_req1')), [cbrDate(last - 7 * DAY), cbrDate(last - 7 * DAY)],
    'Later runs re-read one week before the latest stored rate');
  const added = (await stored(db)).length - before.length;
  assert.deepEqual(result, { outcome: 'collected', stored: added });
  assert.deepEqual((await stored(db)).slice(0, 0), []);
  for (const row of before) assert.ok((await stored(db)).some((item) => JSON.stringify(item) === JSON.stringify(row)), 'Stored rates never change');
  console.log('PASS FX-INCREMENTAL not due within the hour; re-read adds nothing twice and keeps every stored rate');
}

async function failures(db) {
  stage = 'FX-FAIL one or both series unavailable';
  const before = await stored(db);
  await post('cbr', { base, fail: { R01239: 503 } });
  const one = await collector(db).collect(at());
  assert.equal(one.outcome, 'collected');
  let sync = await state(db);
  assert.equal(sync.state, 'delayed');
  assert.equal(sync.errorCode, 'unavailable');
  assert.equal(sync.errorMessage, 'Bank of Russia did not answer; no new rates for EUR');
  await post('cbr', { base, fail: { R01235: 500, R01239: 500 } });
  const lastSuccess = sync.lastSuccessAt.toISOString();
  await collector(db).collect(new Date(Date.now() + 1000));
  sync = await state(db);
  assert.equal(sync.state, 'failed');
  assert.equal(sync.errorMessage, 'Bank of Russia did not answer; no new rates for USD, EUR');
  assert.equal(sync.lastSuccessAt.toISOString(), lastSuccess, 'A failure keeps the last success');
  assert.deepEqual(await stored(db), before, 'A failing provider removes or changes nothing');
  const view = await collector(db).read(new Date());
  assert.equal(view.sync.state, 'failed');
  assert.ok(view.rates.every((rate) => rate.rubPerUnit !== null), 'Stored rates stay available while the provider is down');
  await post('cbr', { base });
  console.log('PASS FX-FAIL delayed and failed states name the missing series; stored rates stay usable');
}

async function appendOnly(db) {
  stage = 'FX-APPEND-ONLY';
  const before = await stored(db);
  for (const sql of [`UPDATE fx_rates SET "rubPerUnit"=1`, 'DELETE FROM fx_rates', 'TRUNCATE fx_rates']) {
    await assert.rejects(() => db.query(sql), (error) => error.driverError?.code === '23001' || error.code === '23001', sql);
  }
  await assert.rejects(() => db.query(`INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit") VALUES ('RUB','cbr','2025-01-01',1)`), /check/i);
  await assert.rejects(() => db.query(`INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit") VALUES ('USD','cbr','2025-01-01',0)`), /check/i);
  await assert.rejects(() => db.query(`INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit") VALUES ('USD','ecb','2025-01-01',1)`), /check/i);
  assert.deepEqual(await stored(db), before);
  console.log('PASS FX-APPEND-ONLY update, delete and truncate refused; RUB, zero and unknown sources refused');
}

async function ownerSettings(db) {
  stage = 'CUR-SWITCH owner main currency';
  const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
    ('currency-owner@example.invalid','synthetic-not-a-hash',true),
    ('currency-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
  const service = new OwnerSettingsService(db);
  assert.deepEqual(await service.read(owner.id), { mainCurrency: 'USD' }, 'No saved row means USD');
  assert.deepEqual(await service.update(owner.id, { mainCurrency: 'EUR' }), { mainCurrency: 'EUR' });
  assert.deepEqual(await service.update(owner.id, { mainCurrency: 'RUB' }), { mainCurrency: 'RUB' });
  assert.deepEqual(await service.read(owner.id), { mainCurrency: 'RUB' });
  assert.deepEqual(await service.read(other.id), { mainCurrency: 'USD' }, 'One owner never changes another');
  const before = await fingerprint(db);
  for (const input of [{ mainCurrency: 'GBP' }, { mainCurrency: 'rub' }, { mainCurrency: 'EUR', theme: 'dark' }, {}, [], null, 'EUR']) {
    await rejected(() => service.update(owner.id, input), 400);
  }
  await rejected(() => service.read('not-a-uuid'), 400);
  await assert.rejects(() => db.query(`INSERT INTO owner_settings ("ownerId","mainCurrency") VALUES ($1,'GBP')`, [other.id]), /check/i);
  await assert.rejects(() => db.query(`INSERT INTO owner_settings ("ownerId","mainCurrency") VALUES ($1,'USD')`, [randomUUID()]), /foreign key/i);
  assert.equal(await fingerprint(db), before, 'Refused input changes nothing');
  console.log('PASS CUR-SWITCH main currency stored per owner (USD default); invalid currencies and owners refused');
  return { owner: owner.id, other: other.id };
}

async function threeCurrencyPortfolio(db, owners) {
  stage = 'CUR-PNL-RUB/CUR-RATE-GAP/CUR-NO-RATE whole portfolio in three currencies';
  const { owner } = owners;
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  const s = { accounting: make('accounting.service', 'AccountingService'), trades: make('trade.service', 'TradeService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService') };
  const instrument = async (body) => (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value.id;
  const btc = await instrument({ name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const eth = await instrument({ name: 'Ethereum', symbol: 'ETH', assetType: 'crypto' });
  const rub = await instrument({ name: 'Rubles', symbol: 'RUB', assetType: 'fiat' });
  const account = { id: (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Trust Wallet' })).value.id, revision: 0 };
  await s.trades.initialize(owner, account.id, { requestId: randomUUID(), coverageFrom: '2025-01-01T00:00:00.000Z', assertEmpty: true });
  const trade = async (instrumentId, side, occurredAt, quantity, grossUsd) => {
    await s.trades.create(owner, account.id, { requestId: randomUUID(), expectedJournalRevision: account.revision,
      instrumentId, side, occurredAt, orderWithinTimestamp: 0, quantity, grossUsd, feeUsd: '0' });
    account.revision++;
  };
  await trade(btc, 'buy', '2025-06-02T09:00:00.000Z', '0.01', '1000');
  await trade(eth, 'buy', '2025-06-02T10:00:00.000Z', '1', '2000');
  // Sunday 8 June 2025: no Bank of Russia rate for that date.
  await trade(eth, 'sell', '2025-06-08T12:00:00.000Z', '1', '2500');
  await trade(rub, 'buy', '2025-06-02T11:00:00.000Z', '5000', '62.5');
  const now = new Date();
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('BTC','USD','kraken',$1,110000,'hourly-close')`, [new Date(now.getTime() - 30 * 60000)]);
  const read = (query = {}) => s.portfolio.read(owner, query, now);
  const assetOf = (report, id) => report.assets.find((item) => item.instrumentId === id);

  // CUR-NO-RATE: nothing stored yet.
  const noRate = await read({ currency: 'EUR' });
  assert.equal(noRate.currency, 'EUR');
  assert.equal(noRate.mainCurrency, 'RUB');
  assert.deepEqual(noRate.rates, []);
  assert.equal(noRate.totalValue, null);
  assert.equal(noRate.costBasis, null);
  assert.equal(noRate.realizedPnl, null);
  assert.equal(assetOf(noRate, btc).missingPrice, 'no-rate');
  assert.equal(assetOf(noRate, btc).value, null);
  assert.equal(assetOf(noRate, rub).missingPrice, 'no-rate');
  const usdOnly = await read({ currency: 'USD' });
  assert.equal(assetOf(usdOnly, btc).value, '1100');
  assert.equal(assetOf(usdOnly, eth).realizedPnl, '500');
  // The main currency answers when no currency is asked; RUB cash needs no rate in RUB.
  const mainOnly = await read();
  assert.equal(mainOnly.currency, 'RUB');
  assert.equal(assetOf(mainOnly, rub).value, '5000');
  assert.equal(assetOf(mainOnly, btc).missingPrice, 'no-rate');

  const today = isoDate(moscowDay(now.getTime()));
  await db.query(`INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit") VALUES
    ('USD','cbr','2025-06-02',80), ('EUR','cbr','2025-06-02',100),
    ('USD','cbr','2025-06-07',78.5), ('EUR','cbr','2025-06-07',90),
    ('USD','cbr',$1,95), ('EUR','cbr',$1,110)`, [today]);
  const before = await fingerprint(db);
  const rubView = await read();
  assert.deepEqual(rubView.rates, [{ currency: 'USD', date: today, rubPerUnit: '95' }, { currency: 'EUR', date: today, rubPerUnit: '110' }]);
  assert.deepEqual(['costBasis', 'value', 'unrealizedPnl'].map((key) => assetOf(rubView, btc)[key]), ['80000', '104500', '24500'], 'CUR-PNL-RUB');
  // CUR-RATE-GAP: the Sunday sale uses Saturday's 78.5: 2500 × 78.5 − 2000 × 80.
  assert.equal(assetOf(rubView, eth).realizedPnl, '36250');
  assert.equal(assetOf(rubView, rub).value, '5000');
  assert.equal(assetOf(rubView, rub).costBasis, '5000');
  assert.equal(rubView.totalValue, '109500');
  const eurView = await read({ currency: 'EUR' });
  assert.deepEqual(['costBasis', 'value', 'unrealizedPnl'].map((key) => assetOf(eurView, btc)[key]), ['800', '950', '150']);
  assert.equal(assetOf(eurView, eth).realizedPnl, '580.555555555555555555555555555556');
  const usdView = await read({ currency: 'USD' });
  assert.deepEqual(['costBasis', 'value', 'unrealizedPnl'].map((key) => assetOf(usdView, btc)[key]), ['1000', '1100', '100']);
  assert.equal(usdView.realizedPnl, '500');
  for (const query of [{ currency: 'GBP' }, { currency: 'eur' }, { currency: 'EUR', at: now.toISOString() }, { at: now.toISOString() }]) {
    await rejected(() => read(query), 400);
  }
  assert.equal(await fingerprint(db), before, 'Every read and refusal preserves all rows');
  console.log('PASS CUR-PNL-RUB/CUR-RATE-GAP/CUR-NO-RATE costs at purchase-date rates, Sunday sale at the Saturday rate, missing rates never zero');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await post('reset', {});
  for (const name of Object.values(databases)) {
    await createDatabase(name);
    assert.match(migrate(name), /Migrations applied: 26/);
    assert.match(migrate(name), /Migrations applied: 0/);
  }
  const rates = sourceFor(databases.rates);
  const accounting = sourceFor(databases.accounting);
  await rates.initialize();
  await accounting.initialize();
  try {
    assert.equal((await rates.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 26);
    await migration(rates);
    await disabled(rates);
    const first = await backfill(rates);
    await incremental(rates, first);
    await failures(rates);
    await appendOnly(rates);
    const owners = await ownerSettings(accounting);
    await threeCurrencyPortfolio(accounting, owners);
  } finally {
    await rates.destroy();
    await accounting.destroy();
  }
}

const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 180000);
watchdog.unref();
main().catch((error) => { console.error(`FAIL ${stage}: ${error.stack ?? error.message}`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
