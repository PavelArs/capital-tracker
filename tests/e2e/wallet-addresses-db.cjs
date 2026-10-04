'use strict';

// Real PostgreSQL acceptance for wallet-address-import (ADDR-*). Only the external
// Esplora provider is synthetic: requests leave through HTTPS_PROXY to providers.cjs.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const { WalletAddressService } = require('/app/backend/dist/wallet-addresses/wallet-address.service.js');
const { EsploraClient } = require('/app/backend/dist/wallet-addresses/esplora-client.js');
const { AddWalletAddressImport1790400000000 } = require('/app/backend/dist/migrations/1790400000000-AddWalletAddressImport.js');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_wallet_addresses_e2e';
const control = 'http://providers:8080/__control';
const esplora = 'https://blockstream.info/api/address';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const addresses = {
  pages: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  resume: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  invalid: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  race: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  foreign: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  gap: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
  limit: 'bc1qrp33g2q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q6vkm53',
};
const txid = (address, i) => sha256(`ct-e2e-tx:${address}:${i}`);

// Independent oracle for providers.cjs transaction i (0 is oldest).
function expected(address, i) {
  const kind = i % 4;
  const [received, sent, fee, direction] = [
    [100000 + i * 1000, 0, 500, 'in'],
    [5700 + i, 57000 + i, 300, 'out'],
    [19800 + i, 20000 + i, 200, 'self'],
    [312500000 + i, 0, 0, 'in'],
  ][kind];
  return {
    txid: txid(address, i), blockHeight: 800000 + i,
    blockTime: new Date((1700000000 + i * 600) * 1000).toISOString(),
    receivedSats: String(received), sentSats: String(sent), feeSats: String(fee), direction,
  };
}
const btc = (sats) => {
  const value = BigInt(sats);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100000000n}.${String(abs % 100000000n).padStart(8, '0')}`;
};

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function providerUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => url);
}
async function newRequests(action) {
  const before = (await providerUrls()).length;
  const result = await action();
  return { result, urls: (await providerUrls()).slice(before) };
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
    assert.match(name, /^capital_tracker_wallet_addresses_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function refusal(action, status) {
  await assert.rejects(async () => action(), (error) => error?.getStatus?.() === status);
}
async function rows(db, addressId) {
  return db.query(`SELECT txid, "blockHeight", "blockHash", "blockTime", "receivedUnits"::text AS "receivedSats",
    "sentUnits"::text AS "sentSats", "feeUnits"::text AS "feeSats", direction, raw::text AS raw, "observedAt"
    FROM wallet_address_transactions WHERE "addressId"=$1 ORDER BY "blockHeight" DESC, txid`, [addressId]);
}
// Rows are the newest `count` transactions of a `total`-transaction history.
function assertStored(stored, address, total, count = total) {
  assert.equal(stored.length, count);
  assert.equal(new Set(stored.map((row) => row.txid)).size, count, 'Each txid is stored once');
  stored.forEach((row, index) => {
    const i = total - 1 - index;
    const oracle = expected(address, i);
    assert.deepEqual({ txid: row.txid, blockHeight: row.blockHeight, blockTime: row.blockTime.toISOString(),
      receivedSats: row.receivedSats, sentSats: row.sentSats, feeSats: row.feeSats, direction: row.direction }, oracle);
    assert.equal(row.blockHash, sha256(`ct-e2e-block:${800000 + i}`));
    assert.equal(JSON.parse(row.raw).txid, oracle.txid, 'Raw provider observation is retained');
  });
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 24/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('wallet-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('wallet-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const service = new WalletAddressService(db, new EsploraClient());

    // ADDR-ADD
    const added = await newRequests(async () => {
      const first = await service.register(owner, { address: addresses.pages.toUpperCase() });
      const again = await service.register(owner, { address: addresses.pages });
      await refusal(() => service.register(owner, { address: 'bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }), 400);
      await refusal(() => service.register(owner, { address: 'not-an-address' }), 400);
      await refusal(() => service.register(owner, { address: addresses.pages, label: 'x' }), 400);
      return { first, again };
    });
    assert.equal(added.result.first.created, true);
    assert.equal(added.result.again.created, false);
    assert.equal(added.result.again.value.id, added.result.first.value.id);
    assert.deepEqual({ ...added.result.first.value, id: undefined, createdAt: undefined }, {
      id: undefined, createdAt: undefined, network: 'bitcoin', address: addresses.pages,
      transactionCount: 0, sync: { state: 'never', completedAt: null },
    });
    assert.deepEqual(added.urls, [], 'Registration never calls the provider');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_addresses'))[0].n, 1);
    const pages = added.result.first.value.id;
    console.log('PASS ADDR-ADD normalized bech32, idempotent duplicate, 400 for invalid input, no provider call');

    // ADDR-SYNC-PAGES
    await post('bitcoin-history', { address: addresses.pages, count: 60 });
    const first = await newRequests(() => service.sync(owner, pages));
    assert.deepEqual(first.urls, [
      `${esplora}/${addresses.pages}/txs/chain`,
      `${esplora}/${addresses.pages}/txs/chain/${txid(addresses.pages, 35)}`,
      `${esplora}/${addresses.pages}/txs/chain/${txid(addresses.pages, 10)}`,
    ]);
    assert.equal(first.result.outcome, 'complete');
    assert.equal(first.result.reason, null);
    assert.equal(first.result.imported, 60);
    assert.equal(first.result.address.transactionCount, 60);
    assert.equal(first.result.address.sync.state, 'complete');
    assert.ok(first.result.address.sync.completedAt);
    assertStored(await rows(db, pages), addresses.pages, 60);
    console.log('PASS ADDR-SYNC-PAGES three page requests store 60 exact rows and complete');

    // ADDR-SYNC-REPLAY
    const before = JSON.stringify(await rows(db, pages));
    const replay = await newRequests(() => service.sync(owner, pages));
    assert.deepEqual(replay.urls, [`${esplora}/${addresses.pages}/txs/chain`]);
    assert.equal(replay.result.outcome, 'complete');
    assert.equal(replay.result.imported, 0);
    assert.equal(JSON.stringify(await rows(db, pages)), before, 'Replay leaves every row unchanged');
    console.log('PASS ADDR-SYNC-REPLAY one request, zero imported, rows unchanged');

    // ADDR-SYNC-INCREMENTAL
    await post('bitcoin-history', { address: addresses.pages, append: 3 });
    const incremental = await newRequests(() => service.sync(owner, pages));
    assert.deepEqual(incremental.urls, [`${esplora}/${addresses.pages}/txs/chain`]);
    assert.equal(incremental.result.outcome, 'complete');
    assert.equal(incremental.result.imported, 3);
    const grown = await rows(db, pages);
    assertStored(grown, addresses.pages, 63);
    assert.equal(JSON.stringify(grown.slice(3)), before, 'Earlier rows are untouched');
    console.log('PASS ADDR-SYNC-INCREMENTAL only three new rows added');

    // ADDR-SYNC-RESUME
    const resume = (await service.register(owner, { address: addresses.resume })).value.id;
    await post('bitcoin-history', { address: addresses.resume, count: 60, fault: { onRequest: 2, status: 429 } });
    const failed = await newRequests(() => service.sync(owner, resume));
    assert.equal(failed.urls.length, 2);
    assert.deepEqual({ outcome: failed.result.outcome, reason: failed.result.reason, imported: failed.result.imported,
      state: failed.result.address.sync.state, count: failed.result.address.transactionCount },
    { outcome: 'provider_error', reason: 'rate_limited', imported: 25, state: 'partial', count: 25 });
    assertStored(await rows(db, resume), addresses.resume, 60, 25);
    const resumed = await newRequests(() => service.sync(owner, resume));
    assert.deepEqual(resumed.urls, [
      `${esplora}/${addresses.resume}/txs/chain/${txid(addresses.resume, 35)}`,
      `${esplora}/${addresses.resume}/txs/chain/${txid(addresses.resume, 10)}`,
    ], 'Resume continues from the committed cursor');
    assert.equal(resumed.result.outcome, 'complete');
    assert.equal(resumed.result.imported, 35);
    assertStored(await rows(db, resume), addresses.resume, 60);
    for (const status of [500, 503]) {
      await post('bitcoin-history', { address: addresses.resume, count: 60, fault: { onRequest: 1, status } });
      const unavailable = await service.sync(owner, resume);
      assert.deepEqual([unavailable.outcome, unavailable.reason, unavailable.imported], ['provider_error', 'unavailable', 0]);
    }
    console.log('PASS ADDR-SYNC-RESUME 429 keeps 25 committed rows; next sync resumes to 60 without gaps; 5xx reported unavailable');

    // ADDR-SYNC-INVALID
    const invalid = (await service.register(owner, { address: addresses.invalid })).value.id;
    await post('bitcoin-history', { address: addresses.invalid, count: 30, fault: { onRequest: 1, invalid: true } });
    const malformed = await service.sync(owner, invalid);
    assert.deepEqual([malformed.outcome, malformed.reason, malformed.imported, malformed.address.sync.state],
      ['provider_error', 'invalid_response', 0, 'never']);
    assert.equal((await rows(db, invalid)).length, 0);
    const state = await db.query('SELECT "walkTopTxid","walkCursorTxid","completedTopTxid" FROM wallet_addresses WHERE id=$1', [invalid]);
    assert.deepEqual(state[0], { walkTopTxid: null, walkCursorTxid: null, completedTopTxid: null });
    console.log('PASS ADDR-SYNC-INVALID malformed page stores nothing and keeps the cursor');

    // ADDR-SYNC-END: an empty page after a cursor ends history only when the address
    // transaction count agrees; a lagging backend's [] must not leave a gap.
    await post('bitcoin-history', { address: addresses.invalid, count: 50 });
    const exact = await newRequests(() => service.sync(owner, invalid));
    assert.deepEqual(exact.urls, [
      `${esplora}/${addresses.invalid}/txs/chain`,
      `${esplora}/${addresses.invalid}/txs/chain/${txid(addresses.invalid, 25)}`,
      `${esplora}/${addresses.invalid}/txs/chain/${txid(addresses.invalid, 0)}`,
      `${esplora}/${addresses.invalid}`,
    ]);
    assert.deepEqual([exact.result.outcome, exact.result.imported, exact.result.address.sync.state], ['complete', 50, 'complete']);
    assertStored(await rows(db, invalid), addresses.invalid, 50);
    const gap = (await service.register(owner, { address: addresses.gap })).value.id;
    await post('bitcoin-history', { address: addresses.gap, count: 60, fault: { onRequest: 2, empty: true } });
    const lagging = await service.sync(owner, gap);
    assert.deepEqual([lagging.outcome, lagging.reason, lagging.imported, lagging.address.sync.state],
      ['provider_error', 'unavailable', 25, 'partial']);
    assertStored(await rows(db, gap), addresses.gap, 60, 25);
    await post('bitcoin-history', { address: addresses.gap, append: 3 });
    const caughtUp = await newRequests(() => service.sync(owner, gap));
    assert.deepEqual(caughtUp.urls, [
      `${esplora}/${addresses.gap}/txs/chain/${txid(addresses.gap, 35)}`,
      `${esplora}/${addresses.gap}/txs/chain/${txid(addresses.gap, 10)}`,
    ], 'The walk resumes below its cursor although newer transactions arrived');
    assert.deepEqual([caughtUp.result.outcome, caughtUp.result.imported], ['complete', 35]);
    assert.deepEqual((await rows(db, gap)).map((row) => row.txid),
      Array.from({ length: 60 }, (_value, index) => txid(addresses.gap, 59 - index)), 'No gap below the first page');
    const newer = await service.sync(owner, gap);
    assert.deepEqual([newer.outcome, newer.imported], ['complete', 3]);
    assertStored(await rows(db, gap), addresses.gap, 63);
    const anchor = await db.query('SELECT "completedTopTxid" FROM wallet_addresses WHERE id=$1', [gap]);
    await post('bitcoin-history', { address: addresses.gap, count: 63, fault: { onRequest: 1, empty: true } });
    const emptyTop = await service.sync(owner, gap);
    assert.deepEqual([emptyTop.outcome, emptyTop.reason, emptyTop.address.sync.state], ['provider_error', 'unavailable', 'complete']);
    assert.deepEqual(await db.query('SELECT "completedTopTxid" FROM wallet_addresses WHERE id=$1', [gap]), anchor);
    console.log('PASS ADDR-SYNC-END exact multiple of 25 completes via tx_count; lagging [] keeps the cursor; arrivals mid-walk leave no gap; empty top keeps the anchor');

    // ADDR-SYNC-LIMIT: one call reads at most 10 pages.
    const limited = (await service.register(owner, { address: addresses.limit })).value.id;
    await post('bitcoin-history', { address: addresses.limit, count: 300 });
    const firstCall = await newRequests(() => service.sync(owner, limited));
    assert.equal(firstCall.urls.length, 10);
    assert.deepEqual([firstCall.result.outcome, firstCall.result.reason, firstCall.result.imported, firstCall.result.address.sync.state],
      ['partial', null, 250, 'partial']);
    const secondCall = await service.sync(owner, limited);
    assert.deepEqual([secondCall.outcome, secondCall.imported, secondCall.address.transactionCount], ['complete', 50, 300]);
    assertStored(await rows(db, limited), addresses.limit, 300);
    console.log('PASS ADDR-SYNC-LIMIT 10 pages per call, then partial; the next call completes 300');

    // ADDR-DB
    const [stored] = await rows(db, pages);
    await assert.rejects(() => db.query(`INSERT INTO wallet_address_transactions
      ("ownerId","addressId",txid,"blockHeight","blockHash","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
      SELECT "ownerId","addressId",txid,"blockHeight","blockHash","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw
      FROM wallet_address_transactions WHERE "addressId"=$1 AND txid=$2`, [pages, stored.txid]), (error) => error.code === '23505');
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address)
      VALUES (gen_random_uuid(),$1,'bitcoin',$2)`, [owner, addresses.pages]), (error) => error.code === '23505');
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address)
      VALUES (gen_random_uuid(),$1,'ethereum','0xabc0000000000000000000000000000000000000')`, [owner]), (error) => error.code === '23514');
    const race = (await service.register(owner, { address: addresses.race })).value.id;
    await post('bitcoin-history', { address: addresses.race, count: 60 });
    const settled = await Promise.allSettled([service.sync(owner, race), service.sync(owner, race)]);
    const conflicts = settled.filter((item) => item.status === 'rejected');
    assert.equal(conflicts.length, 1, 'Exactly one racing sync loses');
    assert.equal(conflicts[0].reason.getStatus(), 409);
    const finish = await service.sync(owner, race);
    assert.equal(finish.outcome, 'complete');
    assertStored(await rows(db, race), addresses.race, 60);
    console.log('PASS ADDR-DB unique (address, txid) and (owner, address); racing sync gets 409; no duplicates');

    // ADDR-PRIVATE and reads
    const foreign = (await service.register(stranger, { address: addresses.foreign })).value.id;
    const denied = await newRequests(async () => {
      await refusal(() => service.sync(owner, foreign), 404);
      await refusal(() => service.transactions(owner, foreign, {}), 404);
      await refusal(() => service.sync(owner, 'not-a-uuid'), 400);
      await refusal(() => service.transactions(owner, pages, { limit: '101' }), 400);
      await refusal(() => service.transactions(owner, pages, { limit: '10', extra: '1' }), 400);
    });
    assert.deepEqual(denied.urls, []);
    assert.deepEqual((await service.list(owner)).map((item) => item.address).sort(),
      [addresses.pages, addresses.resume, addresses.invalid, addresses.race, addresses.gap, addresses.limit].sort());
    assert.deepEqual((await service.list(stranger)).map((item) => item.address), [addresses.foreign]);
    const page = await service.transactions(owner, pages, { limit: '2', offset: '1' });
    assert.deepEqual(page, {
      total: 63, offset: 1, limit: 2, nextOffset: 3, missingUsdValueCount: 63,
      items: [61, 60].map((i) => {
        const oracle = expected(addresses.pages, i);
        return { txid: oracle.txid, blockHeight: oracle.blockHeight, blockTime: oracle.blockTime, direction: oracle.direction,
          receivedBtc: btc(oracle.receivedSats), sentBtc: btc(oracle.sentSats), feeBtc: btc(oracle.feeSats),
          netBtc: btc(BigInt(oracle.receivedSats) - BigInt(oracle.sentSats)), usdValue: null, usdValueStatus: 'missing', trade: null };
      }),
    });
    assert.equal(page.items[0].netBtc, '-0.00051300');
    assert.equal(page.items[1].netBtc, '0.00160000');
    const last = await service.transactions(owner, pages, { offset: '50' });
    assert.equal(last.items.length, 13);
    assert.equal(last.nextOffset, null);
    console.log('PASS ADDR-PRIVATE foreign 404, invalid query 400, owner-scoped reads; usdValue missing, never zero');

    // ADDR-MIGRATION down refusal
    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new AddWalletAddressImport1790400000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS ADDR-MIGRATION fresh 24 applies once; down refuses');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
