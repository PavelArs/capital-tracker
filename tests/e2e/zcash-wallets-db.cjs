'use strict';

// Real PostgreSQL acceptance for track-zcash-wallets. Only Blockbook is synthetic: requests leave
// through HTTPS_PROXY to the providers.cjs stub, which answers from the transactions this probe
// posts in Blockbook's own shapes. Every address, hash and amount is synthetic.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const dist = '/app/backend/dist';
const { TypeOrmConfigService } = require(`${dist}/config/typeorm.config.js`);
const { WalletAddressService } = require(`${dist}/wallet-addresses/wallet-address.service.js`);
const { WalletSyncService } = require(`${dist}/wallet-addresses/wallet-sync.service.js`);
const { BlockbookClient } = require(`${dist}/wallet-addresses/blockbook-client.js`);
const { ZcashSyncAdapter } = require(`${dist}/wallet-addresses/zcash-sync.adapter.js`);
const { TrackZcashWallets1795300000000 } = require(`${dist}/migrations/1795300000000-TrackZcashWallets.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_zcash_wallets_e2e';
const control = 'http://providers:8080/__control';
const hosts = ['zec1.trezor.io', 'zec5.trezor.io'];
const now = new Date('2026-10-09T12:00:00.000Z');
const ZAT = 100_000_000;
const FEE = 10_000;
// Base58Check restated from the format so the probe does not trust the code it checks.
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (data) => createHash('sha256').update(data).digest();
function base58Check(version, payload) {
  const body = Buffer.concat([Buffer.from([version >> 8, version & 0xff]), payload]);
  const bytes = Buffer.concat([body, sha256(sha256(body)).subarray(0, 4)]);
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = BASE58[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic addresses: the first 20 bytes of the SHA-256 of a fixed label, never a real wallet.
const address = (label, version = 0x1cb8) => base58Check(version, sha256(`ct-e2e-zcash:${label}`).subarray(0, 20));
const hash = (id) => sha256(`ct-e2e-zcash-tx:${id}`).toString('hex');
const wallet = address('main');
const cold = address('cold');
const busy = address('busy');
const outside = address('outside', 0x1cbd);
const bitcoinAddress = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';
const TIP = 3_000_100;
const at = (height) => Math.floor(Date.UTC(2026, 8, 1) / 1000) + (height - 3_000_000) * 75;
const zec = (zatoshi) => (zatoshi / ZAT).toFixed(8);

// A transaction of /api/v2/address/{address}?details=txs as Blockbook returns it.
const input = (from, value, index = 0) => ({ txid: hash(`prev-${index}`), vout: index, sequence: 4294967295, n: index,
  addresses: [from], isAddress: true, value: String(value), hex: '483045' });
const output = (to, value, n = 0) => ({ value: String(value), n, hex: '76a914', addresses: [to], isAddress: true });
const tx = (id, height, vin, vout, fees = FEE) => {
  const valueIn = vin.reduce((sum, item) => sum + Number(item.value), 0);
  const value = vout.reduce((sum, item) => sum + Number(item.value), 0);
  return { txid: hash(id), version: 5, vin, vout, blockHash: sha256(`ct-e2e-zcash-block:${height}`).toString('hex'),
    blockHeight: height, confirmations: TIP - height + 1, blockTime: at(height), size: 250, vsize: 250,
    value: String(value), valueIn: String(valueIn), fees: String(fees) };
};

// The main wallet's history, oldest first.
const history = [
  tx(1, 3_000_010, [input(outside, ZAT + FEE)], [output(wallet, ZAT)]),
  // A payment with change back to the wallet.
  tx(2, 3_000_020, [input(wallet, ZAT)], [output(outside, 30_000_000), output(wallet, 69_990_000, 1)]),
  // A consolidation: everything came back but the fee.
  tx(3, 3_000_030, [input(wallet, 69_990_000)], [output(wallet, 69_980_000)]),
  // Into the shielded pool: no transparent output; Blockbook counts the shielded amount as fee.
  tx(4, 3_000_040, [input(wallet, 69_980_000)], [], 69_980_000),
  // Out of the shielded pool: no transparent input.
  tx(5, 3_000_050, [], [output(wallet, 50_000_000)], 0),
  // Two blocks below the tip: read once more blocks follow.
  tx(6, 3_000_099, [input(outside, 2 * ZAT + FEE)], [output(wallet, 2 * ZAT)]),
];
// Independent oracle of the stored legs of the main wallet, newest block first.
const mainLegs = [
  { txid: hash(5), received: 50_000_000, sent: 0, fee: 0, direction: 'in', height: 3_000_050 },
  { txid: hash(4), received: 0, sent: 69_980_000, fee: 0, direction: 'out', height: 3_000_040 },
  { txid: hash(3), received: 69_980_000, sent: 69_990_000, fee: FEE, direction: 'self', height: 3_000_030 },
  { txid: hash(2), received: 69_990_000, sent: ZAT, fee: FEE, direction: 'out', height: 3_000_020 },
  { txid: hash(1), received: ZAT, sent: 0, fee: 0, direction: 'in', height: 3_000_010 },
];
const balanceOf = (legs) => legs.reduce((sum, leg) => sum + leg.received - leg.sent, 0);

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function postZcash(transactions, extra = {}) {
  for (let index = 0; index < transactions.length; index += 10) await post('zcash', { transactions: transactions.slice(index, index + 10) });
  return post('zcash', extra);
}
async function blockbookCalls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).filter(({ url }) => hosts.includes(new URL(url).hostname));
}
async function newRequests(action) {
  const before = (await blockbookCalls()).length;
  const result = await action();
  return { result, calls: (await blockbookCalls()).slice(before) };
}
// What one Blockbook call asked: the instance, the status or the address page of a block range.
const call = ({ method, url }) => {
  assert.equal(method, 'GET');
  const parsed = new URL(url);
  const host = parsed.hostname.split('.')[0];
  if (parsed.pathname === '/api') return [host, 'status'];
  const path = /^\/api\/v2\/address\/(t[13][1-9A-HJ-NP-Za-km-z]{33})$/.exec(parsed.pathname);
  assert.ok(path, `Unexpected Blockbook call ${parsed.pathname}`);
  const query = parsed.searchParams;
  assert.deepEqual([query.get('details'), query.get('pageSize')], ['txs', '10']);
  return [host, path[1], Number(query.get('from')), Number(query.get('to')), Number(query.get('page'))];
};
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
    assert.match(name, /^capital_tracker_zcash_wallets_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, [`${dist}/migrate.js`], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function refusal(action, status) {
  await assert.rejects(async () => action(), (error) => error?.getStatus?.() === status);
}
async function stored(db, addressId) {
  return db.query(`SELECT txid, asset, "blockHeight", "blockHash", "blockTime", "receivedUnits"::text AS received,
    "sentUnits"::text AS sent, "feeUnits"::text AS fee, direction, raw FROM wallet_address_transactions
    WHERE "addressId"=$1 ORDER BY "blockHeight" DESC, txid`, [addressId]);
}
function assertLegs(rows, legs) {
  assert.deepEqual(rows.map((row) => ({ txid: row.txid, asset: row.asset, received: row.received, sent: row.sent,
    fee: row.fee, direction: row.direction, block: row.blockHeight })),
  legs.map(({ txid, received, sent, fee, direction, height }) => ({ txid, asset: null, received: String(received),
    sent: String(sent), fee: String(fee), direction, block: height })));
  rows.forEach((row, index) => {
    assert.equal(row.blockHash, sha256(`ct-e2e-zcash-block:${legs[index].height}`).toString('hex'));
    assert.equal(row.blockTime.toISOString(), new Date(at(legs[index].height) * 1000).toISOString());
    assert.equal(row.raw.txid, row.txid, 'Raw provider observation is retained');
  });
}
function services(db) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const zcash = new ZcashSyncAdapter(db, new BlockbookClient({ pauseMs: 0 }));
  const scheduler = (enabled) => new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }),
    [zcash], classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    operations: make('operation-list.service', 'OperationListService'),
    classifications,
    scheduler,
    addresses: new WalletAddressService(db, scheduler(false)),
  };
}

async function main() {
  for (const [name, value] of Object.entries(settings)) assert.equal(process.env[name], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 54/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('zcash-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('zcash-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const newAccount = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const mainAccount = await newAccount('Main');
    const coldAccount = await newAccount('Cold');

    // ZCASH-ADD, WAL-INVALID, WAL-DUP: no provider call while an address is added.
    const added = await newRequests(async () => {
      const first = await s.addresses.register(owner, { network: 'zcash', address: wallet, accountId: mainAccount, label: 'Main ZEC' });
      const again = await s.addresses.register(owner, { network: 'zcash', address: wallet, accountId: coldAccount });
      const broken = `${wallet.slice(0, -1)}${wallet.endsWith('2') ? '3' : '2'}`;
      for (const input of [
        { network: 'zcash', address: broken },
        { network: 'zcash', address: wallet.toLowerCase() },
        // Testnet, shielded and unified addresses, and other networks' addresses.
        { network: 'zcash', address: address('testnet', 0x1d25) },
        { network: 'zcash', address: `zs1${'q'.repeat(75)}` },
        { network: 'zcash', address: `u1${'q'.repeat(104)}` },
        { network: 'zcash', address: bitcoinAddress },
        { network: 'zcash', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
        { network: 'bitcoin', address: wallet },
        { network: 'tron', address: wallet },
      ]) await refusal(() => s.addresses.register(owner, input), 400);
      return { first, again };
    });
    assert.deepEqual(added.calls, []);
    const { first, again } = added.result;
    assert.deepEqual([first.created, again.created, again.value.id], [true, false, first.value.id]);
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label, first.value.balances,
      first.value.sync.state], ['zcash', wallet, mainAccount, 'Main ZEC', null, 'never']);
    const mainId = first.value.id;
    console.log('PASS ZCASH-ADD a t-address is stored exactly as given; WAL-DUP returns the same wallet; WAL-INVALID 400 for a broken checksum, lower case, testnet, shielded, unified and other networks; no provider call');

    // ZCASH-IDENTITY: the first sync reads the tip, then every page of the range below it.
    await postZcash(history, { tip: TIP });
    const sync1 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync1.result.outcome, sync1.result.reason, sync1.result.imported], ['complete', null, 5]);
    assert.deepEqual(sync1.calls.map(call), [['zec1', 'status'], ['zec1', wallet, 0, TIP - 2, 1]]);
    assertLegs(await stored(db, mainId), mainLegs);
    // SYNC-RECONCILE: the transparent history gives the transparent balance.
    const balance = balanceOf(mainLegs);
    const summary = sync1.result.address;
    assert.equal(zec(balance), '0.50000000');
    assert.deepEqual(summary.balances, [{ symbol: 'ZEC', quantity: zec(balance) }]);
    assert.deepEqual([summary.chainBalance, summary.transactionCount, summary.sync.state, summary.staking],
      ['0.50000000', 5, 'complete', null]);
    const cursor = async (id) => (await db.query(`SELECT a."scannedBlock", z."readTo", z."walkTo", z."walkPage", z."walkPages"
      FROM wallet_addresses a JOIN wallet_zcash_accounts z ON z."addressId"=a.id WHERE a.id=$1`, [id]))[0];
    assert.deepEqual(await cursor(mainId), { scannedBlock: TIP - 2, readTo: TIP - 2, walkTo: null, walkPage: null, walkPages: null });
    console.log('PASS ZCASH-IDENTITY one ZEC leg per transaction under its txid: a receipt, a payment with change and its fee, a consolidation as self, a move into the shielded pool as a send without a fee, one out of it as a receipt');
    console.log('PASS SYNC-RECONCILE complete transparent history gives 0.5 ZEC');

    // Resync: nothing twice; the transaction near the tip is read once more blocks follow.
    const sync2 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync2.result.outcome, sync2.result.imported], ['complete', 0]);
    assert.deepEqual(sync2.calls.map(call), [['zec1', 'status']]);
    await postZcash([], { tip: TIP + 2 });
    const sync3 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync3.result.outcome, sync3.result.imported], ['complete', 1]);
    assert.deepEqual(sync3.calls.map(call), [['zec1', 'status'], ['zec1', wallet, TIP - 1, TIP, 1]]);
    const finalLegs = [{ txid: hash(6), received: 2 * ZAT, sent: 0, fee: 0, direction: 'in', height: 3_000_099 }, ...mainLegs];
    assertLegs(await stored(db, mainId), finalLegs);
    await db.query('UPDATE wallet_zcash_accounts SET "readTo"=NULL WHERE "addressId"=$1', [mainId]);
    await db.query('UPDATE wallet_addresses SET "scannedBlock"=NULL, "completedAt"=NULL WHERE id=$1', [mainId]);
    const replay = await s.addresses.sync(owner, mainId);
    assert.deepEqual([replay.outcome, replay.imported, replay.address.transactionCount], ['complete', 0, 6]);
    assertLegs(await stored(db, mainId), finalLegs);
    console.log('PASS ZCASH-SYNC resync stores each leg once: 0 new, 1 once its block is 3 deep, 0 after a full replay');

    // ZCASH-SYNC: a walk longer than a pass goes on from its page; a range that changed is read again.
    const busyId = (await s.addresses.register(owner, { network: 'zcash', address: busy })).value.id;
    const busyTx = (id, height) => tx(`busy-${id}`, height, [input(outside, ZAT / 10 + FEE)], [output(busy, ZAT / 10)]);
    await postZcash(Array.from({ length: 85 }, (_, index) => busyTx(index, 3_000_000 + index)));
    const partial = await newRequests(() => s.addresses.sync(owner, busyId));
    assert.deepEqual([partial.result.outcome, partial.result.imported, partial.result.address.sync.state, partial.result.address.balances],
      ['partial', 80, 'partial', null]);
    assert.deepEqual(partial.calls.map(call).slice(1).map((item) => item[4]), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(await cursor(busyId), { scannedBlock: 0, readTo: null, walkTo: TIP, walkPage: 9, walkPages: 9 });
    // Ten more transactions appear inside the range (the instance reindexed): ten pages now.
    await postZcash(Array.from({ length: 10 }, (_, index) => busyTx(`late-${index}`, 3_000_090 + index)));
    const again2 = await newRequests(() => s.addresses.sync(owner, busyId));
    assert.deepEqual([again2.result.outcome, again2.result.imported], ['partial', 10]);
    assert.deepEqual(again2.calls.map(call).map((item) => item[4]), [9, 1, 2, 3, 4, 5, 6, 7]);
    const rest = await s.addresses.sync(owner, busyId);
    assert.deepEqual([rest.outcome, rest.imported, rest.address.transactionCount, rest.address.balances[0]],
      ['complete', 5, 95, { symbol: 'ZEC', quantity: '9.50000000' }]);
    assert.deepEqual(await cursor(busyId), { scannedBlock: TIP, readTo: TIP, walkTo: null, walkPage: null, walkPages: null });
    console.log('PASS ZCASH-SYNC 85 transactions store as 80 in the first pass; a range that changed is read again from its first page; 95 in the end');

    // The second instance answers while the first is down.
    await postZcash([], { tip: TIP + 3, fault: { host: 'zec1.trezor.io', onRequest: 1, status: 502 } });
    const fallback = await newRequests(() => s.addresses.sync(owner, busyId));
    assert.deepEqual([fallback.result.outcome, fallback.result.imported], ['complete', 0]);
    assert.deepEqual(fallback.calls.map(call), [['zec1', 'status'], ['zec5', 'status'], ['zec1', busy, TIP + 1, TIP + 1, 1]]);
    console.log('PASS ZCASH-SYNC Trezor\'s second Zcash instance answers while the first is down');

    // Constraints: t-addresses, a walk with its page, a walk past the read blocks.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'zcash',$2)`,
      [owner, `zs1${'q'.repeat(75)}`]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query('UPDATE wallet_zcash_accounts SET "walkTo"=5 WHERE "addressId"=$1', [mainId]),
      /wallet_zcash_accounts_check/);
    await assert.rejects(() => db.query('UPDATE wallet_zcash_accounts SET "walkTo"=5, "walkPage"=1 WHERE "addressId"=$1', [mainId]),
      /wallet_zcash_accounts_check/);
    await assert.rejects(() => db.query('UPDATE wallet_zcash_accounts SET "walkTo"=$2, "walkPage"=1, "walkPages"=0 WHERE "addressId"=$1',
      [mainId, TIP + 10]),
      /wallet_zcash_accounts_walkPages_check/);
    console.log('PASS ZCASH-DB address and walk checks refuse anything else');

    // ZCASH-LINK: once the main wallet's ZEC has a cost, its send to the cold wallet becomes one transfer.
    const coldId = (await s.addresses.register(owner, { network: 'zcash', address: cold, accountId: coldAccount })).value.id;
    await postZcash([tx(20, TIP + 3, [input(wallet, 2 * ZAT)], [output(cold, 150_000_000), output(wallet, 49_990_000, 1)])],
      { tip: TIP + 5 });
    assert.equal((await s.addresses.sync(owner, coldId)).imported, 1);
    await s.classifications.classify(owner, mainId, hash(6), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '80' } });
    assert.equal((await s.addresses.sync(owner, mainId)).imported, 1);
    const links = await db.query(`SELECT "addressId", type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [hash(20)]);
    assert.equal(links.length, 2, 'Both legs of the own transfer are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const list = (await s.operations.read(owner, {}, now)).operations;
    const moved = list.filter((operation) => operation.chain?.txid === hash(20));
    assert.equal(moved.length, 1, 'A linked pair is listed once');
    assert.deepEqual([moved[0].type, moved[0].asset.symbol, moved[0].quantity, moved[0].fee?.asset.symbol, moved[0].fee?.quantity],
      ['transfer', 'ZEC', '1.5', 'ZEC', '0.0001']);
    const receipt = list.find((operation) => operation.chain?.txid === hash(5));
    assert.deepEqual([receipt.asset.symbol, receipt.quantity, receipt.direction, receipt.status], ['ZEC', '0.5', 'in', 'needs-classification']);
    console.log('PASS ZCASH-LINK a 1.5 ZEC send between own accounts auto-links into one transfer with its ZEC fee; receipts wait for classification');

    // SYNC-ISOLATION, SYNC-BG: Blockbook over its limit delays only that wallet, which recovers on its next run.
    await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "nextRunAt")
      SELECT 'wallet:' || id, 'synced', now(), now() + interval '1 day' FROM wallet_addresses
      ON CONFLICT (key) DO UPDATE SET "nextRunAt" = EXCLUDED."nextRunAt"`);
    const late = address('late');
    const lateId = (await s.addresses.register(owner, { network: 'zcash', address: late })).value.id;
    await postZcash([tx('l1', TIP + 4, [input(outside, 3 * ZAT + FEE)], [output(late, 3 * ZAT)])],
      { tip: TIP + 6, fault: { host: 'zec1.trezor.io', onRequest: 1, status: 429 } });
    const t0 = new Date();
    assert.deepEqual(await s.scheduler(true).tick(t0), { outcome: 'ran', wallets: [{ id: lateId, state: 'delayed' }] });
    let listed = (await s.addresses.list(owner)).find((item) => item.id === lateId);
    assert.deepEqual([listed.sync.status, listed.sync.errorMessage], ['delayed', 'The Zcash data source is busy. The app tries again in a few minutes.']);
    assert.deepEqual(await s.scheduler(true).tick(new Date(t0.getTime() + 15 * 60000)), { outcome: 'ran', wallets: [{ id: lateId, state: 'synced' }] });
    listed = (await s.addresses.list(owner)).find((item) => item.id === lateId);
    assert.deepEqual([listed.sync.status, listed.balances[0]], ['synced', { symbol: 'ZEC', quantity: '3.00000000' }]);
    console.log('PASS SYNC-ISOLATION Blockbook over its limit delays only its wallet with a readable reason; SYNC-BG the hourly job recovers it');

    await refusal(() => s.addresses.sync(stranger, mainId), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS ZCASH-PRIVATE another owner gets 404 for the wallet and sees none');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new TrackZcashWallets1795300000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS ZCASH-MIGRATION fresh 54 applies once; the Zcash migration refuses down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
