'use strict';

// Real PostgreSQL acceptance for market-prices (PRC-*). Only the external Kraken and
// CoinGecko providers are synthetic: requests leave through HTTPS_PROXY to providers.cjs.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const { PricesService } = require('/app/backend/dist/prices/prices.service.js');
const { CoinGeckoClient, KrakenClient } = require('/app/backend/dist/prices/price-providers.js');
const { AddHourlyPrices1790800000000 } = require('/app/backend/dist/migrations/1790800000000-AddHourlyPrices.js');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const databases = { main: 'capital_tracker_market_prices_e2e', retry: 'capital_tracker_market_prices_retry_e2e' };
const control = 'http://providers:8080/__control';
const HOUR = 3600000;
const DAY = 86400000;
const backfillStart = Date.parse('2025-01-01T00:00:00Z');
const catalog = [
  ['BTC', 'XBTUSD', 'bitcoin'], ['ETH', 'ETHUSD', 'ethereum'], ['SOL', 'SOLUSD', 'solana'],
  ['ZEC', 'ZECUSD', 'zcash'], ['TRX', 'TRXUSD', 'tron'], ['XLM', 'XLMUSD', 'stellar'],
  ['USDT', 'USDTUSD', 'tether'], ['USDC', 'USDCUSD', 'usd-coin'],
];
const codes = catalog.map(([code]) => code);
const hourly = Object.fromEntries(catalog.map(([code, pair], index) => [pair, code === 'BTC' ? '84945.1' : `${index + 1}.25`]));
const daily = Object.fromEntries(catalog.map(([, pair], index) => [pair, (index + 1) * 1000]));
const gecko = (omit = []) => Object.fromEntries(catalog.filter(([code]) => !omit.includes(code)).map(([, , id], index) => [id, index + 10.5]));
const hourStart = (ms) => Math.floor(ms / HOUR) * HOUR;
// A recent instant five minutes into a UTC hour of the wanted parity (even: Kraken first).
function at(parity, hoursBack = 0) {
  let start = hourStart(Date.now()) - hoursBack * HOUR;
  if ((start / HOUR) % 2 !== (parity === 'even' ? 0 : 1)) start -= HOUR;
  return new Date(start + 5 * 60000);
}
const iso = (ms) => new Date(ms).toISOString();
// Closed daily candles from 2025-01-01 at `now`; candle d closes at d + 1 day.
const closedDays = (now) => Math.floor((now.getTime() - backfillStart) / DAY);

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
}
async function providerUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => new URL(url)).filter(({ hostname }) => ['api.kraken.com', 'api.coingecko.com'].includes(hostname));
}
async function newRequests(action) {
  const before = (await providerUrls()).length;
  const result = await action();
  return { result, urls: (await providerUrls()).slice(before) };
}
const krakenCalls = (urls, interval) => urls.filter((url) => url.hostname === 'api.kraken.com' && url.searchParams.get('interval') === interval).map((url) => url.searchParams.get('pair'));
const geckoCalls = (urls) => urls.filter((url) => url.hostname === 'api.coingecko.com');

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
    assert.match(name, /^capital_tracker_market_prices(_retry)?_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const service = (db, enabled = true) => new PricesService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }),
  new KrakenClient({ pauseMs: 0, retryPauseMs: 0 }), new CoinGeckoClient());
async function observations(db, where = 'TRUE', params = []) {
  return db.query(`SELECT asset, "quoteCurrency", source, kind, price::text AS price, "observedAt", "fetchedAt"
    FROM price_observations WHERE ${where} ORDER BY asset, source, "observedAt"`, params);
}
async function count(db, where = 'TRUE', params = []) {
  return (await db.query(`SELECT count(*)::int AS n FROM price_observations WHERE ${where}`, params))[0].n;
}
async function sources(db) {
  const rows = await db.query('SELECT * FROM sync_sources ORDER BY key');
  return Object.fromEntries(rows.map((row) => [row.key, row]));
}
const fingerprint = async (db) => JSON.stringify(await observations(db));
const exact = (text) => text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const priced = (view, code) => view.assets.find(({ asset }) => asset === code);

async function migration(db) {
  assert.deepEqual(await observations(db), []);
  assert.deepEqual(await db.query('SELECT * FROM sync_sources'), []);
  await assert.rejects(() => new AddHourlyPrices1790800000000().down(), /recovery plan/);
  console.log('PASS PRC-MIGRATION fresh 25 applies once, replay applies none, tables empty, down refuses');
}

async function disabled(db) {
  await post('prices', { kraken: { hourly, daily }, coingecko: { prices: gecko() } });
  for (const enabled of [false]) {
    const { result, urls } = await newRequests(() => service(db, enabled).tick(at('even')));
    assert.deepEqual(result, { outcome: 'disabled' });
    assert.deepEqual(urls, [], 'A disabled collector never calls a provider');
  }
  const unset = new PricesService(db, new ConfigService({}), new KrakenClient({ pauseMs: 0, retryPauseMs: 0 }), new CoinGeckoClient());
  const { result, urls } = await newRequests(() => unset.tick(at('even')));
  assert.deepEqual(result, { outcome: 'disabled' });
  assert.deepEqual(urls, []);
  assert.equal(await count(db), 0);
  const view = await service(db).read(at('even'));
  assert.equal(view.quoteCurrency, 'USD');
  assert.deepEqual(view.assets.map(({ asset, price, status, source, observedAt }) => ({ asset, price, status, source, observedAt })),
    codes.map((asset) => ({ asset, price: null, status: 'none', source: null, observedAt: null })), 'No price is null, never 0');
  console.log('PASS PRC-OFF unset/false switch makes no provider request and writes nothing; PRC-STALE none is null');
}

async function hourlyAndBackfill(db) {
  const now = at('even');
  const { result, urls } = await newRequests(() => service(db).collect(now));
  assert.deepEqual(krakenCalls(urls, '1440'), catalog.map(([, pair]) => pair), 'Backfill reads Kraken daily candles once per asset');
  assert.deepEqual(krakenCalls(urls, '60'), catalog.map(([, pair]) => pair), 'Even hour asks Kraken first');
  assert.deepEqual(geckoCalls(urls), [], 'CoinGecko is not asked when Kraken delivers everything');
  for (const url of urls.filter((url) => url.searchParams.get('interval') === '1440')) {
    assert.equal(url.searchParams.get('since'), String(backfillStart / 1000 - 1));
  }
  const days = closedDays(now);
  assert.deepEqual(result, { outcome: 'collected', stored: catalog.length, backfilled: days * catalog.length });
  for (const [code, pair] of catalog) {
    const rows = await observations(db, `asset=$1 AND kind='daily-close'`, [code]);
    assert.equal(rows.length, days, `${code} has one daily close per closed day since 2025-01-01`);
    assert.equal(rows[0].observedAt.toISOString(), '2025-01-02T00:00:00.000Z', 'The 2024 candle is not stored');
    assert.equal(exact(rows[0].price), `${daily[pair]}.5`);
    assert.equal(rows.at(-1).observedAt.getTime(), backfillStart + days * DAY, 'The open day is skipped');
    assert.equal(exact(rows.at(-1).price), `${daily[pair] + days - 1}.5`);
    assert.ok(rows.every((row) => row.source === 'kraken' && row.quoteCurrency === 'USD'));
  }
  const [btc] = await observations(db, `asset='BTC' AND kind='hourly-close'`);
  assert.deepEqual({ ...btc, price: exact(btc.price), observedAt: btc.observedAt.toISOString(), fetchedAt: undefined },
    { asset: 'BTC', quoteCurrency: 'USD', source: 'kraken', kind: 'hourly-close', price: '84945.1', observedAt: iso(hourStart(now.getTime())), fetchedAt: undefined });
  assert.ok(btc.fetchedAt instanceof Date);
  const state = await sources(db);
  assert.deepEqual(Object.keys(state), ['prices:backfill', 'prices:kraken']);
  for (const key of ['prices:backfill', 'prices:kraken']) {
    assert.equal(state[key].state, 'synced');
    assert.equal(state[key].errorCode, null);
    assert.ok(state[key].lastSuccessAt instanceof Date);
  }
  assert.equal(state['prices:kraken'].nextRunAt.toISOString(), iso(hourStart(now.getTime()) + HOUR + 5 * 60000));
  const view = await service(db).read(now);
  assert.deepEqual(priced(view, 'BTC'), { asset: 'BTC', price: '84945.1', quoteCurrency: 'USD', observedAt: iso(hourStart(now.getTime())), source: 'kraken', status: 'fresh' });
  assert.deepEqual(view.sources.map(({ key, state: value }) => `${key}:${value}`), ['prices:backfill:synced', 'prices:kraken:synced']);
  console.log(`PASS PRC-HOURLY BTC 84945 kraken fresh; PRC-BACKFILL ${days} closed days x ${catalog.length} assets from 2025-01-02`);
  return now;
}

async function idempotent(db, now) {
  const before = await fingerprint(db);
  const { result, urls } = await newRequests(() => service(db).collect(now));
  assert.deepEqual(krakenCalls(urls, '1440'), [], 'A completed backfill is not repeated');
  assert.deepEqual(krakenCalls(urls, '60'), catalog.map(([, pair]) => pair));
  assert.deepEqual(result, { outcome: 'collected', stored: 0, backfilled: 0 });
  assert.equal(await fingerprint(db), before, 'Same answer twice stores one observation');
  console.log('PASS PRC-IDEMPOTENT replay stores nothing and no daily request repeats');
}

// The daily close of yesterday and the 23:00 hourly close both close at today 00:00.
async function midnight(db) {
  const now = new Date(Math.floor(Date.now() / DAY) * DAY + 5 * 60000);
  const { result } = await newRequests(() => service(db).collect(now));
  assert.equal(result.outcome, 'collected');
  const rows = await observations(db, `asset='BTC' AND source='kraken' AND "observedAt"=$1`, [iso(now.getTime() - 5 * 60000)]);
  assert.deepEqual(rows.map(({ kind }) => kind), ['daily-close', 'hourly-close'], 'Both kinds are kept at the same instant');
  assert.equal(exact(rows.find(({ kind }) => kind === 'hourly-close').price), '84945.1');
  console.log('PASS PRC-3 a daily and an hourly close at the same midnight instant are both stored');
}

async function alternate(db) {
  const now = at('odd');
  const updatedAt = Math.floor(now.getTime() / 1000) - 45;
  await post('prices', { kraken: { hourly, daily }, coingecko: { prices: gecko(['ZEC']), updatedAt } });
  const { result, urls } = await newRequests(() => service(db).collect(now));
  assert.equal(geckoCalls(urls).length, 1, 'Odd hour asks CoinGecko first');
  assert.equal(geckoCalls(urls)[0].searchParams.get('ids'), catalog.map(([, , id]) => id).join(','));
  assert.deepEqual(krakenCalls(urls, '60'), ['ZECUSD'], 'Kraken is asked only for the omitted asset');
  assert.equal(result.outcome, 'collected');
  const rows = await observations(db, '"observedAt"=$1 AND source=$2', [iso(updatedAt * 1000), 'coingecko']);
  assert.deepEqual(rows.map(({ asset }) => asset), codes.filter((code) => code !== 'ZEC').sort());
  assert.ok(rows.every(({ kind }) => kind === 'spot'));
  assert.equal(await count(db, `asset='ZEC' AND source='kraken' AND kind='hourly-close' AND "observedAt"=$1`, [iso(hourStart(now.getTime()))]), 1);
  const state = await sources(db);
  assert.deepEqual({ state: state['prices:coingecko'].state, code: state['prices:coingecko'].errorCode, message: state['prices:coingecko'].errorMessage },
    { state: 'delayed', code: 'missing_assets', message: 'No price for ZEC' });
  assert.equal(state['prices:kraken'].state, 'synced');
  const before = await fingerprint(db);
  const replay = await newRequests(() => service(db).collect(now));
  assert.equal(replay.result.stored, 0);
  assert.equal(await fingerprint(db), before, 'Same CoinGecko answer twice stores one observation');
  console.log('PASS PRC-ALTERNATE odd hour starts with CoinGecko, omitted ZEC from Kraken; CoinGecko replay idempotent');
}

async function fallback(db) {
  const now = at('even', 2);
  const updatedAt = Math.floor(now.getTime() / 1000) - 30;
  await post('prices', { kraken: { hourly, daily, fail: Object.fromEntries(catalog.map(([, pair]) => [pair, 500])) }, coingecko: { prices: gecko(), updatedAt } });
  const { result, urls } = await newRequests(() => service(db).collect(now));
  assert.deepEqual(krakenCalls(urls, '60'), catalog.flatMap(([, pair]) => [pair, pair]), 'Each failed Kraken pair is retried once');
  assert.equal(geckoCalls(urls).length, 1, 'CoinGecko is asked when Kraken is due and fails');
  assert.equal(result.stored, catalog.length);
  assert.deepEqual((await observations(db, '"observedAt"=$1', [iso(updatedAt * 1000)])).map(({ asset, source }) => `${asset}:${source}`),
    [...codes].sort().map((code) => `${code}:coingecko`));
  const state = await sources(db);
  assert.deepEqual({ state: state['prices:kraken'].state, code: state['prices:kraken'].errorCode, message: state['prices:kraken'].errorMessage },
    { state: 'failed', code: 'unavailable', message: 'Kraken did not answer' });
  assert.equal(state['prices:coingecko'].state, 'synced');
  assert.equal(state['prices:coingecko'].errorCode, null);
  const view = await service(db).read(now);
  for (const code of codes) assert.equal(priced(view, code).status, 'fresh', `${code} stays fresh after Kraken fails`);
  assert.equal(view.sources.find(({ key }) => key === 'prices:kraken').errorMessage, 'Kraken did not answer');
  console.log('PASS PRC-FALLBACK Kraken 500 twice -> CoinGecko stored, Kraken error shown, prices fresh');
}

async function rateLimited(db) {
  const now = at('odd', 2);
  await post('prices', { kraken: { hourly, daily }, coingecko: { status: 429 } });
  const { result, urls } = await newRequests(() => service(db).collect(now));
  assert.equal(geckoCalls(urls).length, 1);
  assert.deepEqual(krakenCalls(urls, '60'), catalog.map(([, pair]) => pair), 'Kraken still delivers');
  assert.equal(result.outcome, 'collected');
  const state = await sources(db);
  assert.deepEqual({ state: state['prices:coingecko'].state, code: state['prices:coingecko'].errorCode },
    { state: 'failed', code: 'rate_limited' });
  assert.equal(state['prices:kraken'].state, 'synced');
  const next = iso(hourStart(now.getTime()) + HOUR + 5 * 60000);
  assert.equal(state['prices:coingecko'].nextRunAt.toISOString(), next);
  assert.equal(state['prices:kraken'].nextRunAt.toISOString(), next);
  console.log('PASS PRC-SOURCES rate-limited CoinGecko does not block Kraken; both next at hour + 5 min');
}

async function schedule(db) {
  const latest = (await db.query(`SELECT max("lastAttemptAt") AS at FROM sync_sources WHERE key IN ('prices:kraken', 'prices:coingecko')`))[0].at.getTime();
  const sameHour = new Date(hourStart(latest) + 50 * 60000);
  const { result, urls } = await newRequests(() => service(db).tick(sameHour));
  assert.deepEqual(result, { outcome: 'not_due' });
  assert.deepEqual(urls, []);
  await post('prices', { kraken: { hourly, daily }, coingecko: { prices: gecko() } });
  const nextHour = new Date(hourStart(latest) + HOUR + 5 * 60000);
  const due = await newRequests(() => service(db).tick(nextHour));
  assert.equal(due.result.outcome, 'collected');
  assert.ok(due.urls.length > 0);
  // Another process holding the collector's lock makes this run step aside.
  const holder = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: databases.main });
  await holder.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(7340600001)');
    const blocked = await newRequests(() => service(db).collect(nextHour));
    assert.deepEqual(blocked.result, { outcome: 'busy' });
    assert.deepEqual(blocked.urls, [], 'A busy run calls no provider');
    await holder.query('COMMIT');
  } finally { await holder.end(); }
  assert.equal((await service(db).collect(nextHour)).outcome, 'collected', 'The lock is free once the holder ends');
  console.log('PASS PRC-2 schedule: not due within the attempted hour, due the next hour, a run steps aside while another holds the lock');
}

async function appendOnly(db) {
  const before = await fingerprint(db);
  for (const statement of [`UPDATE price_observations SET price = 1 WHERE asset='BTC'`, `DELETE FROM price_observations WHERE asset='BTC'`, 'TRUNCATE price_observations']) {
    await assert.rejects(() => db.query(statement), (error) => error.code === '23001', statement);
  }
  assert.equal(await fingerprint(db), before);
  await assert.rejects(() => db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES('BTC','USD','kraken',now(),0,'spot')`), (error) => error.code === '23514', 'Zero price refused');
  await assert.rejects(() => db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES('BTC','USD','binance',now(),1,'spot')`), (error) => error.code === '23514', 'Unknown source refused');
  console.log('PASS PRC-APPEND-ONLY update/delete/truncate refused (23001); zero price and unknown source refused');
}

async function interrupted(db) {
  const now = new Date();
  await db.query(`UPDATE sync_sources SET state='syncing', "lastAttemptAt"=$1 WHERE key='prices:kraken'`, [new Date(now.getTime() - 20 * 60000)]);
  const view = await service(db).read(now);
  const kraken = view.sources.find(({ key }) => key === 'prices:kraken');
  assert.deepEqual({ state: kraken.state, errorCode: kraken.errorCode }, { state: 'failed', errorCode: 'interrupted' });
  await db.query(`UPDATE sync_sources SET "lastAttemptAt"=$1 WHERE key='prices:kraken'`, [new Date(now.getTime() - 5 * 60000)]);
  assert.equal((await service(db).read(now)).sources.find(({ key }) => key === 'prices:kraken').state, 'syncing');
  console.log('PASS PRC-5 a source left syncing for over 15 minutes reads as failed/interrupted');
}

async function stale(db) {
  const now = new Date(hourStart(Date.now()) + 5 * 60000);
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind) VALUES
    ('BTC','USD','kraken',$1,'83000.5','hourly-close'), ('ETH','USD','coingecko',$2,'3001.75','spot')`,
  [new Date(now.getTime() - 3 * HOUR), new Date(now.getTime() - 10 * 60000)]);
  const view = await service(db).read(now);
  assert.deepEqual(priced(view, 'BTC'), { asset: 'BTC', price: '83000.5', quoteCurrency: 'USD', observedAt: iso(now.getTime() - 3 * HOUR), source: 'kraken', status: 'stale' });
  assert.equal(priced(view, 'ETH').status, 'fresh');
  assert.deepEqual(priced(view, 'SOL'), { asset: 'SOL', price: null, quoteCurrency: 'USD', observedAt: null, source: null, status: 'none' });
  console.log('PASS PRC-STALE 3 h old BTC stale with stored price, fresh ETH, SOL none/null');
}

async function backfillRetry(db) {
  await post('prices', { kraken: { hourly, daily, dailyFail: { ETHUSD: 500 } }, coingecko: { prices: gecko() } });
  const now = at('even');
  const days = closedDays(now);
  const first = await newRequests(() => service(db).collect(now));
  assert.equal(krakenCalls(first.urls, '1440').filter((pair) => pair === 'ETHUSD').length, 2, 'A failed daily request is retried once');
  assert.equal(first.result.backfilled, days * (catalog.length - 1));
  assert.equal(await count(db, `asset='ETH' AND kind='daily-close'`), 0);
  let state = await sources(db);
  assert.deepEqual({ state: state['prices:backfill'].state, code: state['prices:backfill'].errorCode, message: state['prices:backfill'].errorMessage },
    { state: 'failed', code: 'unavailable', message: 'No history for ETH' });
  assert.equal(state['prices:backfill'].lastSuccessAt, null);
  await post('prices', { kraken: { hourly, daily }, coingecko: { prices: gecko() } });
  const later = new Date(now.getTime() + HOUR);
  const second = await newRequests(() => service(db).collect(later));
  assert.deepEqual(krakenCalls(second.urls, '1440'), ['ETHUSD'], 'Only the failed asset is retried');
  assert.equal(await count(db, `asset='ETH' AND kind='daily-close'`), closedDays(later));
  for (const [code] of catalog.filter(([code]) => code !== 'ETH')) {
    assert.equal(await count(db, `asset=$1 AND kind='daily-close'`, [code]), days, `${code} history is not duplicated`);
  }
  state = await sources(db);
  assert.equal(state['prices:backfill'].state, 'synced');
  assert.equal(state['prices:backfill'].errorCode, null);
  const third = await newRequests(() => service(db).collect(new Date(later.getTime() + HOUR)));
  assert.deepEqual(krakenCalls(third.urls, '1440'), []);
  console.log('PASS PRC-BACKFILL-RETRY failed ETH history retried alone, then synced and never repeated');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await post('reset', {});
  for (const name of Object.values(databases)) {
    await createDatabase(name);
    assert.match(migrate(name), /Migrations applied: 28/);
    assert.match(migrate(name), /Migrations applied: 0/);
  }
  const main = sourceFor(databases.main);
  const retry = sourceFor(databases.retry);
  await main.initialize();
  await retry.initialize();
  try {
    await migration(main);
    await disabled(main);
    const now = await hourlyAndBackfill(main);
    await idempotent(main, now);
    await midnight(main);
    await alternate(main);
    await fallback(main);
    await rateLimited(main);
    await schedule(main);
    await appendOnly(main);
    await interrupted(main);
    await stale(retry);
    await backfillRetry(retry);
  } finally {
    await main.destroy();
    await retry.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
