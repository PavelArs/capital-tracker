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
const { BitcoinSyncAdapter } = require('/app/backend/dist/wallet-addresses/bitcoin-sync.adapter.js');
const { WalletSyncService } = require('/app/backend/dist/wallet-addresses/wallet-sync.service.js');
const { SyncStatusService } = require('/app/backend/dist/sync-status/sync-status.service.js');
const { AddWalletAddressImport1790400000000 } = require('/app/backend/dist/migrations/1790400000000-AddWalletAddressImport.js');
const { BindWalletsToAccounts1791600000000 } = require('/app/backend/dist/migrations/1791600000000-BindWalletsToAccounts.js');

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
  trust: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  cold: '3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC',
  // Synthetic base58check P2PKH addresses for background sync (hash of a fixed label).
  background: '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d',
  down: '163rBrz831SADWG2mTwT9UMX4XdSKtr4Wr',
  throws: '18PjkHGLoZETfDKmyASszWiqvN69Knq64x',
  long: '162gaPRBaLg8rtmdQW7Zar6DbKdm9u39CA',
};
// Synthetic BIP-39 words of the standard test vector: never a real wallet's phrase.
const seedPhrase = Array(11).fill('abandon').concat('about').join(' ');
const txid = (address, i) => sha256(`ct-e2e-tx:${address}:${i}`);
const accountRow = async (db, owner, name) => (await db.query(`INSERT INTO manual_accounts
  (id,"ownerId","requestId","canonicalPayload",name) VALUES (gen_random_uuid(),$1,gen_random_uuid(),$2,$3) RETURNING id`,
  [owner, JSON.stringify({ name }), name]))[0].id;

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
// Chain balance of the newest `count` transactions of providers.cjs history: received - sent.
const balance = (address, count) => btc(Array.from({ length: count }, (_value, i) => expected(address, i))
  .reduce((sum, row) => sum + BigInt(row.receivedSats) - BigInt(row.sentSats), 0n));
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
  assert.match(migrate(database), /Migrations applied: 52/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('wallet-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('wallet-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const bitcoin = new BitcoinSyncAdapter(db, new EsploraClient());
    // The background switch is the hourly collection's (M3); the probe drives ticks itself.
    const scheduler = (enabled, adapters = [bitcoin]) =>
      new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }), adapters);
    const service = new WalletAddressService(db, scheduler(false));

    // ADDR-ADD
    const added = await newRequests(async () => {
      const first = await service.register(owner, { address: addresses.pages.toUpperCase() });
      const again = await service.register(owner, { address: addresses.pages });
      await refusal(() => service.register(owner, { address: 'bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }), 400);
      await refusal(() => service.register(owner, { address: 'not-an-address' }), 400);
      await refusal(() => service.register(owner, { address: addresses.pages, nickname: 'x' }), 400);
      return { first, again };
    });
    assert.equal(added.result.first.created, true);
    assert.equal(added.result.again.created, false);
    assert.equal(added.result.again.value.id, added.result.first.value.id);
    assert.deepEqual({ ...added.result.first.value, id: undefined, createdAt: undefined }, {
      id: undefined, createdAt: undefined, network: 'bitcoin', address: addresses.pages,
      accountId: null, label: null, transactionCount: 0, chainBalance: null, balances: null, staking: null, pools: null, reportedBalance: null, accountKey: null, exchange: null,
      sync: { state: 'never', completedAt: null, status: null, lastAttemptAt: null, lastSuccessAt: null, nextRunAt: null, errorMessage: null },
    });
    assert.deepEqual(added.urls, [], 'Registration never calls the provider');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_addresses'))[0].n, 1);
    const pages = added.result.first.value.id;
    console.log('PASS ADDR-ADD normalized bech32, idempotent duplicate, 400 for invalid input, no provider call');

    // WAL-ADD, WAL-DUP, WAL-NO-SECRETS, WAL-ACCOUNT: an address belongs to one of the owner's accounts.
    const trustAccount = await accountRow(db, owner, 'Trust Wallet');
    const coldAccount = await accountRow(db, owner, 'Cold storage');
    const strangerAccount = await accountRow(db, stranger, 'Stranger wallet');
    const bound = await newRequests(async () => {
      const created = await service.register(owner, { network: 'bitcoin', address: addresses.trust,
        accountId: trustAccount, label: ' Trust Wallet BTC ' });
      const repeated = await service.register(owner, { network: 'bitcoin', address: addresses.trust,
        accountId: coldAccount, label: 'Elsewhere' });
      for (const input of [
        { address: seedPhrase },
        { address: `${seedPhrase} ${seedPhrase}` },
        { address: addresses.cold, seed: seedPhrase },
        { network: 'ethereum', address: addresses.cold },
        { address: addresses.cold, label: 'x'.repeat(41) },
        { address: addresses.cold, label: 'Line\nbreak' },
      ]) await refusal(() => service.register(owner, input), 400);
      await refusal(() => service.register(owner, { address: addresses.cold, accountId: strangerAccount }), 404);
      await refusal(() => service.register(owner, { address: addresses.cold, accountId: '00000000-0000-4000-8000-000000000000' }), 404);
      return { created, repeated };
    });
    assert.equal(bound.result.created.created, true);
    assert.deepEqual([bound.result.created.value.accountId, bound.result.created.value.label, bound.result.created.value.chainBalance],
      [trustAccount, 'Trust Wallet BTC', null]);
    assert.equal(bound.result.repeated.created, false);
    assert.deepEqual(bound.result.repeated.value, bound.result.created.value, 'A repeated address keeps its account and name');
    assert.deepEqual(bound.urls, [], 'Binding never calls the provider');
    assert.deepEqual(await db.query('SELECT address FROM wallet_addresses ORDER BY address'),
      [addresses.pages, addresses.trust].sort().map((address) => ({ address })), 'Refused requests store nothing');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM wallet_addresses
      WHERE address LIKE '%abandon%' OR label LIKE '%abandon%'`))[0].n, 0, 'A seed phrase is never stored');
    const trust = bound.result.created.value.id;
    const moved = await service.update(owner, trust, { accountId: coldAccount, label: null });
    assert.deepEqual([moved.accountId, moved.label, moved.address], [coldAccount, null, addresses.trust]);
    const renamed = await service.update(owner, trust, { label: 'Spare BTC' });
    assert.deepEqual([renamed.accountId, renamed.label], [coldAccount, 'Spare BTC'], 'Only the sent field changes');
    const assigned = await service.update(owner, pages, { accountId: trustAccount });
    assert.deepEqual([assigned.accountId, assigned.label], [trustAccount, null], 'An existing address gets its account');
    await refusal(() => service.update(owner, trust, { accountId: strangerAccount }), 404);
    await refusal(() => service.update(owner, trust, {}), 400);
    await refusal(() => service.update(owner, trust, { address: addresses.cold }), 400);
    await refusal(() => service.update(stranger, trust, { label: 'Mine' }), 404);
    const unbound = await service.update(owner, trust, { accountId: null });
    assert.deepEqual([unbound.accountId, unbound.label], [null, 'Spare BTC']);
    await assert.rejects(() => db.query('UPDATE wallet_addresses SET "accountId"=$1 WHERE id=$2', [strangerAccount, trust]),
      (error) => error.code === '23503', "Another owner's account is refused by the database");
    await assert.rejects(() => db.query('DELETE FROM manual_accounts WHERE id=$1', [trustAccount]),
      (error) => error.code === '23001', 'An account with an address cannot disappear');
    await service.update(owner, trust, { accountId: trustAccount, label: 'Trust Wallet BTC' });
    console.log('PASS WAL-ADD/WAL-DUP/WAL-NO-SECRETS/WAL-ACCOUNT address bound with a name; repeat unchanged; seed phrase, foreign account and bad names refused and never stored; move, rename, unbind');

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
    // PR-SYN-1: "Sync now" records the wallet's source like the background job does.
    assert.equal(first.result.address.sync.status, 'synced');
    assert.equal(first.result.address.sync.errorMessage, null);
    assert.equal(first.result.address.sync.lastSuccessAt, first.result.address.sync.lastAttemptAt);
    assert.ok(Date.parse(first.result.address.sync.nextRunAt) - Date.parse(first.result.address.sync.lastAttemptAt) === 3600000,
      'A synced wallet is checked again in an hour');
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

    // SYNC-RECONCILE: the chain balance is the whole stored history's received minus sent.
    const reconciled = (await service.list(owner)).find((item) => item.id === pages);
    assert.deepEqual([reconciled.sync.state, reconciled.transactionCount, reconciled.chainBalance],
      ['complete', 63, balance(addresses.pages, 63)]);
    assert.notEqual(reconciled.chainBalance, '0.00000000');
    assert.deepEqual(reconciled.balances, [{ symbol: 'BTC', quantity: reconciled.chainBalance }]);
    console.log(`PASS SYNC-RECONCILE complete history of 63 gives chain balance ${reconciled.chainBalance}`);

    // ADDR-SYNC-RESUME
    const resume = (await service.register(owner, { address: addresses.resume })).value.id;
    await post('bitcoin-history', { address: addresses.resume, count: 60, fault: { onRequest: 2, status: 429 } });
    const failed = await newRequests(() => service.sync(owner, resume));
    assert.equal(failed.urls.length, 2);
    assert.deepEqual({ outcome: failed.result.outcome, reason: failed.result.reason, imported: failed.result.imported,
      state: failed.result.address.sync.state, count: failed.result.address.transactionCount },
    { outcome: 'provider_error', reason: 'rate_limited', imported: 25, state: 'partial', count: 25 });
    assert.deepEqual([failed.result.address.sync.status, failed.result.address.sync.errorMessage, failed.result.address.sync.lastSuccessAt],
      ['delayed', 'The Bitcoin data source is busy. The app tries again in a few minutes.', null]);
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
      assert.deepEqual([unavailable.address.sync.status, unavailable.address.sync.errorMessage],
        ['failed', 'Bitcoin data is temporarily unavailable.']);
      assert.ok(unavailable.address.sync.lastSuccessAt, 'A failure keeps the last success');
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
    assert.equal(firstCall.result.address.chainBalance, null, 'A partly loaded history has no chain balance');
    const secondCall = await service.sync(owner, limited);
    assert.deepEqual([secondCall.outcome, secondCall.imported, secondCall.address.transactionCount], ['complete', 50, 300]);
    assert.equal(secondCall.address.chainBalance, balance(addresses.limit, 300));
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
    // M14 allows Ethereum, stored lower case only, M15 Solana, Tron and Stellar (M23) their own addresses; any other network is still refused.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address)
      VALUES (gen_random_uuid(),$1,'dogecoin','0xabc0000000000000000000000000000000000000')`, [owner]), (error) => error.code === '23514');
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address)
      VALUES (gen_random_uuid(),$1,'solana','0xabc0000000000000000000000000000000000000')`, [owner]), (error) => error.code === '23514');
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address)
      VALUES (gen_random_uuid(),$1,'ethereum','0xABC0000000000000000000000000000000000000')`, [owner]), (error) => error.code === '23514');
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address)
      VALUES (gen_random_uuid(),$1,'ethereum',$2)`, [owner, addresses.trust]), (error) => error.code === '23514');
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
      [addresses.pages, addresses.trust, addresses.resume, addresses.invalid, addresses.race, addresses.gap, addresses.limit].sort());
    assert.deepEqual((await service.list(stranger)).map((item) => item.address), [addresses.foreign]);
    const page = await service.transactions(owner, pages, { limit: '2', offset: '1' });
    assert.deepEqual(page, {
      total: 63, offset: 1, limit: 2, nextOffset: 3, missingUsdValueCount: 63,
      items: [61, 60].map((i) => {
        const oracle = expected(addresses.pages, i);
        const amounts = { received: btc(oracle.receivedSats), sent: btc(oracle.sentSats), fee: btc(oracle.feeSats),
          net: btc(BigInt(oracle.receivedSats) - BigInt(oracle.sentSats)) };
        // M14 names the amounts per asset; the Bitcoin screen keeps its *Btc names.
        return { txid: oracle.txid, blockHeight: oracle.blockHeight, blockTime: oracle.blockTime, direction: oracle.direction,
          symbol: 'BTC', ...amounts, receivedBtc: amounts.received, sentBtc: amounts.sent, feeBtc: amounts.fee,
          netBtc: amounts.net, usdValue: null, usdValueStatus: 'missing' };
      }),
    });
    assert.equal(page.items[0].netBtc, '-0.00051300');
    assert.equal(page.items[1].netBtc, '0.00160000');
    const last = await service.transactions(owner, pages, { offset: '50' });
    assert.equal(last.items.length, 13);
    assert.equal(last.nextOffset, null);
    console.log('PASS ADDR-PRIVATE foreign 404, invalid query 400, owner-scoped reads; usdValue missing, never zero');

    // SYNC-SWITCH: the background job follows the hourly collection switch and is single.
    const off = await newRequests(() => scheduler(false).tick());
    assert.deepEqual([off.result, off.urls], [{ outcome: 'disabled' }, []]);
    const holder = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(7340600011)');
      const locked = await newRequests(() => scheduler(true).tick());
      assert.deepEqual([locked.result, locked.urls], [{ outcome: 'busy' }, []]);
    } finally {
      await holder.query('SELECT pg_advisory_unlock(7340600011)');
      await holder.end();
    }
    console.log('PASS SYNC-SWITCH tick disabled without PRICE_COLLECTION_ENABLED; a held scheduler lock reports busy; no provider call');

    // SYNC-BG, SYNC-ISOLATION. Wallets synced above are due again only after their hour; the
    // ones never synced (trust, foreign) are left out by pretending they were just checked.
    const quiet = await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "nextRunAt")
      SELECT 'wallet:' || id, 'synced', now(), now() + interval '1 day' FROM wallet_addresses
      ON CONFLICT (key) DO UPDATE SET "nextRunAt" = EXCLUDED."nextRunAt" RETURNING key`);
    assert.equal(quiet.length, 8);
    const background = (await service.register(owner, { address: addresses.background, accountId: trustAccount, label: 'Background' })).value.id;
    const down = (await service.register(owner, { address: addresses.down })).value.id;
    const throws = (await service.register(owner, { address: addresses.throws })).value.id;
    await post('bitcoin-history', { address: addresses.background, count: 3 });
    await post('bitcoin-history', { address: addresses.down, count: 5, fault: { onRequest: 1, status: 503 } });
    await post('bitcoin-history', { address: addresses.throws, count: 2 });
    // An adapter that throws for one wallet stands for any unexpected error in one source.
    const brittle = { network: 'bitcoin', name: 'Bitcoin', step: async (ownerId, addressId) => {
      if (addressId === throws) throw new Error('synthetic adapter failure');
      return bitcoin.step(ownerId, addressId);
    } };
    const t0 = new Date();
    const tick = (at) => newRequests(() => scheduler(true, [brittle]).tick(at));
    const firstTick = await tick(t0);
    assert.deepEqual(firstTick.result, { outcome: 'ran', wallets: [
      { id: background, state: 'synced' }, { id: down, state: 'failed' }, { id: throws, state: 'failed' }] });
    assert.deepEqual(firstTick.urls, [`${esplora}/${addresses.background}/txs/chain`, `${esplora}/${addresses.down}/txs/chain`]);
    assertStored(await rows(db, background), addresses.background, 3);
    assert.equal((await rows(db, down)).length, 0);
    const byId = async () => new Map((await service.list(owner)).map((item) => [item.id, item]));
    let listed = await byId();
    assert.deepEqual(listed.get(background).sync, { state: 'complete', completedAt: listed.get(background).sync.completedAt,
      status: 'synced', lastAttemptAt: t0.toISOString(), lastSuccessAt: t0.toISOString(),
      nextRunAt: new Date(t0.getTime() + 3600000).toISOString(), errorMessage: null });
    assert.equal(listed.get(background).chainBalance, balance(addresses.background, 3));
    assert.deepEqual(listed.get(down).sync, { state: 'never', completedAt: null, status: 'failed', lastAttemptAt: t0.toISOString(),
      lastSuccessAt: null, nextRunAt: new Date(t0.getTime() + 900000).toISOString(), errorMessage: 'Bitcoin data is temporarily unavailable.' });
    assert.deepEqual([listed.get(throws).sync.status, listed.get(throws).sync.errorMessage], ['failed', 'The sync stopped unexpectedly.']);
    const again = await tick(new Date(t0.getTime() + 60000));
    assert.deepEqual([again.result, again.urls], [{ outcome: 'ran', wallets: [] }, []], 'Nothing is due a minute later');

    await post('bitcoin-history', { address: addresses.background, append: 1 });
    const t1 = new Date(t0.getTime() + 3600000);
    const hourLater = await tick(t1);
    assert.deepEqual(hourLater.result, { outcome: 'ran', wallets: [
      { id: down, state: 'synced' }, { id: throws, state: 'failed' }, { id: background, state: 'synced' }] });
    assertStored(await rows(db, background), addresses.background, 4);
    assertStored(await rows(db, down), addresses.down, 5);
    listed = await byId();
    assert.deepEqual([listed.get(down).sync.status, listed.get(down).sync.errorMessage, listed.get(down).sync.lastSuccessAt],
      ['synced', null, t1.toISOString()], 'A recovered wallet clears its error');
    assert.equal(listed.get(background).transactionCount, 4);
    console.log('PASS SYNC-BG background job stores 3 raw transactions, then exactly 4 an hour later; nothing runs before it is due');
    console.log('PASS SYNC-ISOLATION a 503 and a throwing adapter fail only their own wallets with readable reasons; the next run recovers');

    // SYNC-LONG: a long history continues on the next tick, not in an hour.
    const long = (await service.register(owner, { address: addresses.long })).value.id;
    await post('bitcoin-history', { address: addresses.long, count: 300 });
    const t2 = new Date(t1.getTime() + 60000);
    const firstPart = await tick(t2);
    assert.deepEqual(firstPart.result, { outcome: 'ran', wallets: [{ id: long, state: 'syncing' }] });
    assert.equal(firstPart.urls.length, 10);
    listed = await byId();
    assert.deepEqual([listed.get(long).sync.state, listed.get(long).sync.status, listed.get(long).sync.nextRunAt, listed.get(long).chainBalance],
      ['partial', 'syncing', t2.toISOString(), null]);
    const rest = await tick(new Date(t2.getTime() + 60000));
    assert.deepEqual(rest.result, { outcome: 'ran', wallets: [{ id: long, state: 'synced' }] });
    assertStored(await rows(db, long), addresses.long, 300);
    console.log('PASS SYNC-LONG 300 transactions load over two ticks; partial shows syncing and is due at once');

    // SYNC-INTERRUPTED: a pass that died while syncing reads as failed and runs again.
    await db.query(`UPDATE sync_sources SET state = 'syncing', "errorCode" = NULL, "errorMessage" = NULL,
      "lastAttemptAt" = $2, "nextRunAt" = $3 WHERE key = $1`,
    [`wallet:${throws}`, new Date(Date.now() - 20 * 60000), new Date(Date.now() - 5 * 60000)]);
    // The list reads the clock: twenty minutes in "syncing" means the pass died.
    const died = (await service.list(owner)).find((item) => item.id === throws);
    assert.deepEqual([died.sync.status, died.sync.errorMessage], ['failed', 'The sync stopped before it finished.']);
    const rerun = await tick(new Date(t2.getTime() + 120000));
    assert.deepEqual(rerun.result.wallets, [{ id: throws, state: 'failed' }]);
    const healthy = await scheduler(true).tick(new Date(t2.getTime() + 120000 + 900000));
    assert.deepEqual(healthy.wallets, [{ id: throws, state: 'synced' }]);
    assertStored(await rows(db, throws), addresses.throws, 2);
    console.log('PASS SYNC-INTERRUPTED a stale syncing state reads as failed, is picked up again and recovers');

    // SYNC-STATUS: one state per source; prices are healthy while either provider is fresh.
    await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt", "errorCode", "errorMessage") VALUES
      ('prices:kraken', 'synced', $1, $1, $3, NULL, NULL),
      ('prices:coingecko', 'failed', $2, NULL, $3, 'unavailable', 'CoinGecko did not answer'),
      ('fx:cbr', 'delayed', $1, $4, $3, 'invalid_response', 'Bank of Russia sent an unreadable answer; no new rates for USD')
      ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state, "lastAttemptAt" = EXCLUDED."lastAttemptAt",
        "lastSuccessAt" = EXCLUDED."lastSuccessAt", "nextRunAt" = EXCLUDED."nextRunAt",
        "errorCode" = EXCLUDED."errorCode", "errorMessage" = EXCLUDED."errorMessage"`,
    [new Date(t2.getTime() - 12 * 60000), new Date(t2.getTime() - 60000), new Date(t2.getTime() + 3600000), new Date(t2.getTime() - 86400000)]);
    await db.query(`UPDATE sync_sources SET state = 'failed', "errorCode" = 'unavailable',
      "errorMessage" = 'Bitcoin data is temporarily unavailable.' WHERE key = $1`, [`wallet:${down}`]);
    const status = new SyncStatusService(db);
    const report = await status.read(owner, t2);
    const named = Object.fromEntries(report.sources.map((item) => [item.key, item]));
    assert.deepEqual(named.prices, { key: 'prices', kind: 'prices', name: 'Prices', state: 'synced',
      lastAttemptAt: new Date(t2.getTime() - 60000).toISOString(), lastSuccessAt: new Date(t2.getTime() - 12 * 60000).toISOString(), errorMessage: null });
    assert.deepEqual([named['fx:cbr'].state, named['fx:cbr'].name, named['fx:cbr'].errorMessage],
      ['delayed', 'Bank of Russia rates', 'Bank of Russia sent an unreadable answer; no new rates for USD']);
    assert.deepEqual(named[`wallet:${down}`], { key: `wallet:${down}`, kind: 'wallet', name: 'Bitcoin', state: 'failed',
      lastAttemptAt: t1.toISOString(), lastSuccessAt: t1.toISOString(), errorMessage: 'Bitcoin data is temporarily unavailable.' });
    assert.deepEqual([named[`wallet:${background}`].name, named[`wallet:${background}`].state], ['Background', 'synced']);
    assert.equal(report.sources.filter((item) => item.kind === 'wallet').length, 11);
    assert.deepEqual(report.sources.slice(0, 2).map((item) => item.key), ['prices', 'fx:cbr']);
    const strangers = await status.read(stranger, t2);
    assert.deepEqual(strangers.sources.filter((item) => item.kind === 'wallet').map((item) => item.key), [`wallet:${foreign}`],
      "Another owner's wallets never appear");
    const stale = await status.read(owner, new Date(t2.getTime() + 3 * 3600000));
    assert.deepEqual([stale.sources[0].state, stale.sources[0].errorMessage], ['failed', 'CoinGecko did not answer'],
      'Prices older than two hours need attention, with the last provider error');
    await refusal(() => status.read('not-a-uuid'), 400);
    console.log('PASS SYNC-STATUS prices synced 12 min ago, FX delayed and a failed wallet each report their own state and reason; owner-scoped');

    // ADDR-MIGRATION down refusal
    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new AddWalletAddressImport1790400000000().down(), /recovery plan/);
    await assert.rejects(() => new BindWalletsToAccounts1791600000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS ADDR-MIGRATION fresh 32 applies once; both wallet migrations refuse down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
