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
const databases = { rates: 'capital_tracker_fx_rates_e2e', upgrade: 'capital_tracker_fx_history_e2e', broken: 'capital_tracker_fx_broken_e2e', accounting: 'capital_tracker_three_currency_e2e' };
const control = 'http://providers:8080/__control';
const HOUR = 3600000;
const DAY = 86400000;
const backfillStart = Date.parse('2025-01-01T00:00:00Z');
// History is read from a month before 1 January 2009, four years (1460 days) per request.
const historyStart = Date.parse('2008-12-01T00:00:00Z');
const REQUEST = 1460 * 86400000;
const codes = { USD: 'R01235', EUR: 'R01239' };
const base = { R01235: 80, R01239: 90 };
let stage = 'synthetic configuration';

const moscowDay = (ms) => Math.floor((ms + 3 * HOUR) / DAY) * DAY;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const cbrDate = (ms) => isoDate(ms).split('-').reverse().join('/');
// The fixture's formula restated: Tuesday..Saturday in the range up to tomorrow (Moscow),
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
// The requests the collector makes for one series: four-year ranges from `from` to `to`,
// newest first.
function ranges(code, from, to) {
  const urls = [];
  for (let start = from; start <= to; start += REQUEST)
    urls.push(['/scripts/XML_dynamic.asp', code, cbrDate(start), cbrDate(Math.min(start + REQUEST - DAY, to))]);
  return urls.reverse();
}
const requested = (urls) => urls.map((url) => [url.pathname, url.searchParams.get('VAL_NM_RQ'), url.searchParams.get('date_req1'), url.searchParams.get('date_req2')]);
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
    assert.match(name, /^capital_tracker_(fx_rates|fx_history|fx_broken|three_currency)_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
// A short pause before the one repeated request keeps the failure stages quick.
const collector = (db, enabled = true) => new FxRatesService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }), new CbrClient({ retryPauseMs: 50 }));
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
  console.log('PASS FX-MIGRATION fresh 27 applies once, replay applies none, new tables empty, down refuses');
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
  stage = 'PR-FX-1 backfill from December 2008';
  const now = at();
  const tomorrow = moscowDay(now.getTime()) + DAY;
  const { result, urls } = await newRequests(() => collector(db).tick(now));
  assert.deepEqual(requested(urls), [...ranges('R01235', historyStart, tomorrow), ...ranges('R01239', historyStart, tomorrow)],
    'The first run reads the whole history in four-year requests, newest first');
  const expected = [...expectedRates('USD', historyStart, tomorrow), ...expectedRates('EUR', historyStart, tomorrow)];
  assert.deepEqual(result, { outcome: 'collected', stored: expected.length });
  assert.deepEqual((await stored(db)).map(({ source, ...row }) => { assert.equal(source, 'cbr'); return row; }), expected);
  const sync = await state(db);
  assert.equal(sync.state, 'synced');
  assert.equal(sync.lastSuccessAt.toISOString(), now.toISOString());
  assert.equal(sync.errorCode, null);
  const view = await collector(db).read(now);
  const today = moscowDay(now.getTime());
  const latest = (currency) => expectedRates(currency, historyStart, today).at(-1);
  assert.deepEqual(view.rates, ['USD', 'EUR'].map((currency) => ({ currency, rubPerUnit: latest(currency).rubPerUnit, date: latest(currency).rateDate })),
    "Today's rate is the latest effective on or before the Moscow date, never tomorrow's");
  const early = await collector(db).read(now, '2009-01-04');
  assert.deepEqual(early.rates.map(({ currency, date }) => [currency, date]), [['USD', '2009-01-03'], ['EUR', '2009-01-03']],
    'A Sunday in 2009 has the latest rate on or before it');
  console.log(`PASS PR-FX-1 backfilled ${expected.length} Bank of Russia rates from December 2008 to tomorrow; weekends keep gaps`);
  return now;
}

async function history(db) {
  stage = 'FX-HISTORY rates stored only from 2025 gain the years before and a lost month';
  // A database collected before the history change: rates from 11 January 2025 only, and
  // USD without February and March 2025, as a request that failed would leave it.
  const first = Date.parse('2025-01-11T00:00:00Z');
  const hole = [Date.parse('2025-02-01T00:00:00Z'), Date.parse('2025-03-31T00:00:00Z')];
  const now = at();
  const tomorrow = moscowDay(now.getTime()) + DAY;
  const kept = [...expectedRates('USD', first, tomorrow), ...expectedRates('EUR', first, tomorrow)]
    .filter((row) => row.currency === 'EUR' || row.rateDate < isoDate(hole[0]) || row.rateDate > isoDate(hole[1]));
  await db.query(`INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit")
    SELECT currency, 'cbr', "rateDate", "rubPerUnit" FROM unnest($1::text[], $2::date[], $3::numeric[]) AS r(currency, "rateDate", "rubPerUnit")`,
  [kept.map((row) => row.currency), kept.map((row) => row.rateDate), kept.map((row) => row.rubPerUnit)]);
  const before = await stored(db);
  const pastWeek = Date.parse(`${kept.filter((row) => row.currency === 'USD').at(-1).rateDate}T00:00:00Z`) - 7 * DAY;
  // The stored rates around the hole: the Friday before it and the Tuesday after it.
  const around = [Date.parse('2025-01-31T00:00:00Z'), Date.parse('2025-04-01T00:00:00Z')];
  const lost = ranges('R01235', around[0] + DAY, around[1] - DAY);
  const missing = (code) => [...ranges(code, pastWeek, tomorrow), ...(code === 'R01235' ? lost : []), ...ranges(code, historyStart, first - DAY)];
  const { result, urls } = await newRequests(() => collector(db).collect(now));
  assert.deepEqual(requested(urls), [...missing('R01235'), ...missing('R01239')],
    'The last week first, then the lost months and the years before the earliest stored rate, newest first');
  const expected = [...expectedRates('USD', historyStart, tomorrow), ...expectedRates('EUR', historyStart, tomorrow)];
  assert.deepEqual(result, { outcome: 'collected', stored: expected.length - before.length });
  assert.deepEqual((await stored(db)).map(({ source, ...row }) => row), expected);
  const after = new Set((await stored(db)).map((row) => JSON.stringify(row)));
  for (const row of before) assert.ok(after.has(JSON.stringify(row)), 'Stored rates never change');
  const last = Date.parse(`${(await stored(db)).filter((row) => row.currency === 'USD').at(-1).rateDate}T00:00:00Z`);
  const again = await newRequests(() => collector(db).collect(new Date(now.getTime() + HOUR)));
  assert.deepEqual(requested(again.urls).map(([, code, from]) => [code, from]), [['R01235', cbrDate(last - 7 * DAY)], ['R01239', cbrDate(last - 7 * DAY)]],
    'Once the history reaches 2009 only the last week is read');
  console.log('PASS FX-HISTORY a database with rates from 2025 and a lost month reads the missing ranges once and keeps every stored rate');
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
  const after = new Set((await stored(db)).map((row) => JSON.stringify(row)));
  for (const row of before) assert.ok(after.has(JSON.stringify(row)), 'Stored rates never change');
  console.log('PASS FX-INCREMENTAL not due within the hour; re-read adds nothing twice and keeps every stored rate');
}

async function failures(db) {
  stage = 'FX-FAIL one or both series unavailable';
  const before = await stored(db);
  await post('cbr', { base, fail: { R01239: 503 } });
  const { result: one, urls } = await newRequests(() => collector(db).collect(at()));
  assert.equal(one.outcome, 'collected');
  assert.deepEqual(requested(urls).map(([, code]) => code), ['R01235', 'R01239', 'R01239'],
    'A failed answer is asked for once more');
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

async function unreadable(db) {
  stage = 'FX-UNREADABLE an answer that is always unreadable leaves out only a short range';
  // Every answer holding USD of 15 March 2017 (a Wednesday) carries a record of another shape.
  const brokenDate = '2017-03-15';
  await post('cbr', { base, broken: { R01235: brokenDate } });
  const now = at();
  const tomorrow = moscowDay(now.getTime()) + DAY;
  const all = [...expectedRates('USD', historyStart, tomorrow), ...expectedRates('EUR', historyStart, tomorrow)];
  const first = await newRequests(() => collector(db).collect(now));
  assert.equal(first.result.outcome, 'collected');
  const have = new Set((await stored(db)).map(({ currency, rateDate }) => `${currency} ${rateDate}`));
  const missing = all.filter((row) => !have.has(`${row.currency} ${row.rateDate}`));
  assert.ok(missing.every((row) => row.currency === 'USD'), 'EUR is read in full');
  assert.ok(missing.some((row) => row.rateDate === brokenDate), 'The refused date stays missing');
  const span = Date.parse(missing.at(-1).rateDate) - Date.parse(missing[0].rateDate);
  assert.ok(span < 45 * DAY, `Only a short range around the refused record stays missing (${missing[0].rateDate}..${missing.at(-1).rateDate})`);
  assert.ok(first.urls.length <= 10 + 2 * 16, 'Splitting asks a bounded number of times');
  let sync = await state(db);
  assert.equal(sync.state, 'delayed');
  assert.equal(sync.errorCode, 'invalid_response');
  const reported = /^Bank of Russia sent an unreadable answer; no new rates for USD (\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}) \(record on 2017-03-15: "<Value>51,5100<\/Value>"\)$/.exec(sync.errorMessage);
  assert.ok(reported, `The state names the range and the refused record: ${sync.errorMessage}`);
  assert.ok(reported[1] <= missing[0].rateDate && missing.at(-1).rateDate <= reported[2], 'The named range covers what is missing');

  stage = 'FX-UNREADABLE the next run asks again for the short hole only';
  const before = await stored(db);
  const again = await newRequests(() => collector(db).collect(new Date(now.getTime() + HOUR)));
  const history = requested(again.urls).filter(([, code, from]) => code === 'R01235' && from !== cbrDate(Date.parse(`${before.filter((row) => row.currency === 'USD').at(-1).rateDate}T00:00:00Z`) - 7 * DAY));
  // The hole runs from the day after the last stored rate before it, a Saturday at the latest.
  const near = (date, days) => isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY);
  const iso = (date) => date.split('/').reverse().join('-');
  assert.ok(history.length > 0 && history.every(([, , from, to]) => iso(from) >= near(reported[1], -3) && iso(to) <= near(reported[2], 3)),
    `Only the hole is asked for again: ${JSON.stringify(history)}`);
  const after = await stored(db);
  assert.ok(after.length >= before.length, 'Stored rates are kept; the hole can only shrink');
  assert.ok(!after.some((row) => row.currency === 'USD' && row.rateDate === brokenDate), 'The refused date stays missing');

  stage = 'FX-UNREADABLE a readable answer fills the hole';
  await post('cbr', { base });
  await collector(db).collect(new Date(now.getTime() + 2 * HOUR));
  assert.deepEqual((await stored(db)).map(({ source, ...row }) => row), all);
  sync = await state(db);
  assert.equal(sync.state, 'synced');
  assert.equal(sync.errorMessage, null);
  console.log(`PASS FX-UNREADABLE an always unreadable answer splits down to ${missing[0].rateDate}..${missing.at(-1).rateDate}, the state names the refused record, the hole is asked for again and filled`);
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
  assert.deepEqual(await service.read(owner.id), { mainCurrency: 'USD', dustThresholdUsd: null }, 'No saved row means USD');
  assert.deepEqual(await service.update(owner.id, { mainCurrency: 'EUR' }), { mainCurrency: 'EUR', dustThresholdUsd: null });
  assert.deepEqual(await service.update(owner.id, { mainCurrency: 'RUB' }), { mainCurrency: 'RUB', dustThresholdUsd: null });
  assert.deepEqual(await service.read(owner.id), { mainCurrency: 'RUB', dustThresholdUsd: null });
  assert.deepEqual(await service.read(other.id), { mainCurrency: 'USD', dustThresholdUsd: null }, 'One owner never changes another');
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

async function paidInRublesAndEuros(db, owners) {
  stage = 'CUR-PAID-RUB trades paid in RUB or EUR';
  const { other: owner } = owners;
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  const s = { accounting: make('accounting.service', 'AccountingService'), trades: make('trade.service', 'TradeService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService') };
  const btc = (await s.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' })).value.id;
  const account = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Ledger' })).value.id;
  await s.trades.initialize(owner, account, { requestId: randomUUID(), coverageFrom: '2025-01-01T00:00:00.000Z', assertEmpty: true });
  const body = (revision, side, occurredAt, quantity, amounts) => ({ requestId: randomUUID(), expectedJournalRevision: revision,
    instrumentId: btc, side, occurredAt, orderWithinTimestamp: 0, quantity, ...amounts });
  const payments = () => db.query(`SELECT "tradeId",version,currency,gross::text,fee::text,"rateDate"::text,
    "perUsd"::text,"rateSource" FROM account_trade_version_payments ORDER BY "createdAt","tradeId",version`);

  // No stored rate for 1 May 2025: refused, nothing written.
  const before = await fingerprint(db);
  await rejected(() => s.trades.create(owner, account, body(0, 'buy', '2025-05-01T09:00:00.000Z', '0.01', { paid: { currency: 'RUB', gross: '80000', fee: '0' } })), 409);
  await rejected(() => s.trades.create(owner, account, body(0, 'buy', '2025-06-02T09:00:00.000Z', '0.01', { paid: { currency: 'USD', gross: '1', fee: '0' } })), 400);
  await rejected(() => s.trades.create(owner, account, body(0, 'buy', '2025-06-02T09:00:00.000Z', '0.01', { grossUsd: '1', feeUsd: '0', paid: { currency: 'RUB', gross: '1', fee: '0' } })), 400);
  assert.equal(await fingerprint(db), before, 'A refused paid trade writes nothing');

  // 80000 RUB at 80 RUB per USD on 2 June 2025.
  const buyBody = body(0, 'buy', '2025-06-02T09:00:00.000Z', '0.01', { paid: { currency: 'RUB', gross: '80000.00', fee: '0' } });
  const buy = await s.trades.create(owner, account, buyBody);
  assert.equal(buy.created, true);
  assert.deepEqual([buy.value.trade.grossUsd, buy.value.trade.feeUsd], ['1000', '0']);
  const rubPaid = { currency: 'RUB', gross: '80000', fee: '0', rateDate: '2025-06-02', perUsd: '80', rateSource: 'bank-of-russia' };
  assert.deepEqual(buy.value.trade.paid, rubPaid);
  const replay = await s.trades.create(owner, account, buyBody);
  assert.equal(replay.created, false);
  assert.deepEqual(replay.value.trade, buy.value.trade, 'A replay returns the saved amounts as paid');
  await rejected(() => s.trades.create(owner, account, { ...buyBody, paid: undefined, grossUsd: '1000', feeUsd: '0' }), 409);

  // Sunday 8 June 2025: 400 EUR less 4 EUR fee at Saturday's 90 RUB per EUR and 78.5 RUB per USD.
  const sale = await s.trades.create(owner, account, body(1, 'sell', '2025-06-08T12:00:00.000Z', '0.004', { paid: { currency: 'EUR', gross: '400', fee: '4' } }));
  assert.deepEqual([sale.value.trade.grossUsd, sale.value.trade.feeUsd], ['458.598726114649681528662420382166', '4.585987261146496815286624203822']);
  assert.deepEqual(sale.value.trade.paid, { currency: 'EUR', gross: '400', fee: '4', rateDate: '2025-06-08', perUsd: '0.872222222222222222222222222222', rateSource: 'bank-of-russia' });
  // The rates on a chosen date, as the trade form prefills them: Sunday uses Saturday's.
  assert.deepEqual((await collector(db).read(new Date(), '2025-06-08')).rates, [
    { currency: 'USD', rubPerUnit: '78.5', date: '2025-06-07' }, { currency: 'EUR', rubPerUnit: '90', date: '2025-06-07' }]);

  const now = new Date();
  const assetOf = async (currency) => (await s.portfolio.read(owner, { currency }, now)).assets.find((item) => item.instrumentId === btc);
  // CUR-PAID-RUB: rubles stay exact; the EUR proceeds convert at the sale date, the RUB cost at the buy date.
  const inRub = await assetOf('RUB');
  assert.deepEqual([inRub.costBasis, inRub.value, inRub.unrealizedPnl, inRub.realizedPnl], ['48000', '62700', '14700', '3640']);
  const inEur = await assetOf('EUR');
  assert.deepEqual([inEur.costBasis, inEur.realizedPnl], ['480', '76']);
  const inUsd = await assetOf('USD');
  assert.deepEqual([inUsd.costBasis, inUsd.realizedPnl], ['600', '54.012738853503184713375796178344']);

  // A void keeps the sale's amounts as paid; a correction to USD amounts drops them.
  const voided = await s.trades.void(owner, account, sale.value.trade.tradeId, { requestId: randomUUID(), expectedJournalRevision: 2 });
  assert.deepEqual(voided.value.trade.paid, sale.value.trade.paid);
  const corrected = await s.trades.correct(owner, account, buy.value.trade.tradeId, body(3, 'buy', '2025-06-02T09:00:00.000Z', '0.01', { grossUsd: '1000', feeUsd: '0' }));
  assert.equal(corrected.value.trade.paid, undefined);
  const history = await s.trades.listVersions(owner, account, buy.value.trade.tradeId);
  assert.deepEqual(history.items.map((item) => item.paid ?? null), [null, rubPaid]);
  assert.deepEqual((await payments()).map(({ tradeId, version, currency }) => [tradeId, version, currency]), [
    [buy.value.trade.tradeId, 1, 'RUB'], [sale.value.trade.tradeId, 1, 'EUR'], [sale.value.trade.tradeId, 2, 'EUR']]);
  assert.equal((await assetOf('RUB')).costBasis, '80000', 'The corrected buy costs 1000 USD at 80');

  // The owner's own rate needs no stored rate: 75000 RUB at 75 RUB per USD on 1 May 2025.
  const wallet = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Wallet' })).value.id;
  await s.trades.initialize(owner, wallet, { requestId: randomUUID(), coverageFrom: '2025-01-01T00:00:00.000Z', assertEmpty: true });
  const own = await s.trades.create(owner, wallet, body(0, 'buy', '2025-05-01T09:00:00.000Z', '0.01', { paid: { currency: 'RUB', gross: '75000', fee: '0', perUsd: '75' } }));
  assert.deepEqual([own.value.trade.grossUsd, own.value.trade.paid], ['1000',
    { currency: 'RUB', gross: '75000', fee: '0', rateDate: '2025-05-01', perUsd: '75', rateSource: 'owner' }]);
  assert.equal((await assetOf('RUB')).costBasis, '155000', 'The ruble cost stays exactly what was paid');

  // The table refuses what the service never writes.
  const insert = (values) => db.query(`INSERT INTO account_trade_version_payments
    ("ownerId","accountId","tradeId",version,currency,gross,fee,"rateDate","perUsd","rateSource")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, values);
  const key = [owner, account, buy.value.trade.tradeId, 2];
  const atRest = await fingerprint(db);
  for (const [values, pattern] of [
    [[...key, 'USD', 1, 0, '2025-06-02', 80, 'owner'], /check/i],
    [[...key, 'RUB', 1, 0, '2025-06-02', 0, 'owner'], /check/i],
    [[...key, 'RUB', 1, 0, '2025-06-02', 80, 'guess'], /check/i],
    [[...key, 'EUR', 0, 0, '2025-06-02', 0.9, 'owner'], /check/i],
    [[...key, 'EUR', 1, -1, '2025-06-02', 0.9, 'owner'], /check/i],
    [[owner, account, buy.value.trade.tradeId, 9, 'EUR', 1, 0, '2025-06-02', 0.9, 'owner'], /foreign key/i],
  ]) await assert.rejects(() => insert(values), pattern);
  assert.equal(await fingerprint(db), atRest);
  const { PaidCurrencyTrades1791100000000 } = require('/app/backend/dist/migrations/1791100000000-PaidCurrencyTrades.js');
  await assert.rejects(() => new PaidCurrencyTrades1791100000000().down(), /recovery plan/);
  console.log('PASS CUR-PAID-RUB RUB/EUR trades keep amounts as paid at the Bank of Russia rate of their date or the owner\'s rate; exact ruble cost and P&L; no rate is a conflict');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await post('reset', {});
  for (const name of Object.values(databases)) {
    await createDatabase(name);
    assert.match(migrate(name), /Migrations applied: 53/);
    assert.match(migrate(name), /Migrations applied: 0/);
  }
  const rates = sourceFor(databases.rates);
  const upgrade = sourceFor(databases.upgrade);
  const broken = sourceFor(databases.broken);
  const accounting = sourceFor(databases.accounting);
  await rates.initialize();
  await upgrade.initialize();
  await broken.initialize();
  await accounting.initialize();
  try {
    assert.equal((await rates.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 53);
    await migration(rates);
    await disabled(rates);
    const first = await backfill(rates);
    await incremental(rates, first);
    await failures(rates);
    await appendOnly(rates);
    await history(upgrade);
    await unreadable(broken);
    const owners = await ownerSettings(accounting);
    await threeCurrencyPortfolio(accounting, owners);
    await paidInRublesAndEuros(accounting, owners);
  } finally {
    await rates.destroy();
    await upgrade.destroy();
    await broken.destroy();
    await accounting.destroy();
  }
}

const watchdog = setTimeout(() => { console.error(`FAIL timeout at ${stage}`); process.exit(1); }, 180000);
watchdog.unref();
main().catch((error) => { console.error(`FAIL ${stage}: ${error.stack ?? error.message}`); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
