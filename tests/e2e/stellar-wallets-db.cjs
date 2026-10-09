'use strict';

// Real PostgreSQL acceptance for track-stellar-wallets. Only Horizon is synthetic: requests leave
// through HTTPS_PROXY to the providers.cjs stub, which answers from the records this probe posts
// in Horizon's own shapes. Every address, hash and amount is synthetic.
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
const { HorizonClient } = require(`${dist}/wallet-addresses/horizon-client.js`);
const { StellarSyncAdapter } = require(`${dist}/wallet-addresses/stellar-sync.adapter.js`);
const { TrackStellarWallets1794700000000 } = require(`${dist}/migrations/1794700000000-TrackStellarWallets.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_stellar_wallets_e2e';
const control = 'http://providers:8080/__control';
const horizonHost = 'horizon.stellar.org';
const now = new Date('2026-10-09T12:00:00.000Z');
const STROOP = 10_000_000;
// StrKey restated from the format so the probe does not trust the code it checks.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
function strKey(version, key) {
  const payload = Buffer.concat([Buffer.from([version]), key]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc16(payload));
  let bits = '';
  for (const byte of Buffer.concat([payload, checksum])) bits += byte.toString(2).padStart(8, '0');
  let text = '';
  for (let at = 0; at < bits.length; at += 5) text += BASE32[Number.parseInt(bits.slice(at, at + 5).padEnd(5, '0'), 2)];
  return text;
}
const sha256 = (text) => createHash('sha256').update(text).digest();
// Synthetic accounts: the SHA-256 of a fixed label as the public key, never a real wallet.
const account = (label) => strKey(6 << 3, sha256(`ct-e2e-stellar:${label}`));
const hash = (id) => sha256(`ct-e2e-stellar-tx:${id}`).toString('hex');
const wallet = account('main');
const cold = account('cold');
const busy = account('busy');
const drift = account('drift');
const outside = account('outside');
const merged = account('merged');
const bitcoinAddress = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';
// Ledger n, its close time, and the total order ID of the n-th ledger's first transaction.
const ledger = (n) => 60000000 + n;
const at = (n) => new Date(Date.UTC(2026, 8, 1) + n * 5000).toISOString().replace('.000Z', 'Z');
const toid = (n, operation = 0) => ((BigInt(ledger(n)) << 32n) | (1n << 12n) | BigInt(operation)).toString();
const xlm = (amount) => (amount / STROOP).toFixed(7);

// A record of /accounts/{id}/transactions as Horizon returns it, XDR included.
const tx = (id, n, source, { fee = 100, successful = true, operations = 1 } = {}) => ({
  _links: { self: { href: `https://horizon.stellar.org/transactions/${hash(id)}` } }, id: hash(id), paging_token: toid(n),
  successful, hash: hash(id), ledger: ledger(n), created_at: at(n), source_account: source, source_account_sequence: '1',
  fee_account: source, fee_charged: String(fee), max_fee: '1000', operation_count: operations,
  envelope_xdr: 'AAAAAgAAAAA=', result_xdr: 'AAAAAAAAAGQ=', result_meta_xdr: 'AAAAAwAAAAA=', fee_meta_xdr: 'AAAAAgAAAAA=',
  memo_type: 'none', signatures: ['c3ludGhldGlj'] });
// A record of /accounts/{id}/payments: the operation's own fields.
const op = (id, n, index, type, fields) => ({ _links: {}, id: toid(n, index), paging_token: toid(n, index),
  transaction_successful: true, source_account: fields.from ?? fields.funder ?? fields.account, type, type_i: 1,
  created_at: at(n), transaction_hash: hash(id), ...fields });
const pay = (id, n, from, to, amount, index = 1, asset = { asset_type: 'native' }) =>
  op(id, n, index, 'payment', { ...asset, from, to, amount: xlm(amount) });

// The main wallet's history, oldest first.
const history = {
  transactions: [
    tx(1, 10, outside),
    tx(2, 12, wallet),
    tx(3, 14, outside),
    tx(4, 16, wallet, { successful: false }),
    tx(5, 18, wallet),
    tx(6, 20, outside, { operations: 2 }),
    tx(7, 22, merged),
  ],
  payments: [
    // An account is created by its first payment.
    op(1, 10, 1, 'create_account', { funder: outside, account: wallet, starting_balance: xlm(100 * STROOP) }),
    pay(2, 12, wallet, outside, 10 * STROOP),
    // USDC on Stellar is not tracked, and someone else paid the fee.
    pay(3, 14, outside, wallet, 5 * STROOP, 1, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: outside }),
    // XLM paid into a path payment that delivered another asset.
    op(5, 18, 1, 'path_payment_strict_send', { from: wallet, to: outside, asset_type: 'credit_alphanum4', asset_code: 'USDC',
      asset_issuer: outside, amount: '0.3000000', source_asset_type: 'native', source_amount: xlm(2 * STROOP), path: [] }),
    pay(6, 20, outside, wallet, 1 * STROOP, 1),
    pay(6, 20, outside, wallet, 2 * STROOP, 2),
    op(7, 22, 1, 'account_merge', { account: merged, into: wallet }),
  ],
  effects: { [toid(22, 1)]: [
    { type: 'account_debited', account: merged, asset_type: 'native', amount: xlm(7 * STROOP) },
    { type: 'account_credited', account: wallet, asset_type: 'native', amount: xlm(7 * STROOP) },
    { type: 'account_removed', account: merged },
  ] },
};
// Independent oracle of the stored legs of the main wallet, newest ledger first.
const mainLegs = [
  { txid: hash(7), received: 7 * STROOP, sent: 0, fee: 0, direction: 'in', n: 22 },
  { txid: hash(6), received: 3 * STROOP, sent: 0, fee: 0, direction: 'in', n: 20 },
  { txid: hash(5), received: 0, sent: 2 * STROOP + 100, fee: 100, direction: 'out', n: 18 },
  { txid: hash(4), received: 0, sent: 100, fee: 100, direction: 'out', n: 16 },
  { txid: hash(2), received: 0, sent: 10 * STROOP + 100, fee: 100, direction: 'out', n: 12 },
  { txid: hash(1), received: 100 * STROOP, sent: 0, fee: 0, direction: 'in', n: 10 },
];
const balanceOf = (legs) => legs.reduce((sum, leg) => sum + leg.received - leg.sent, 0);

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function postStellar({ transactions = [], payments = [], effects = {}, accounts = {} }, extra = {}) {
  for (let index = 0; index < transactions.length; index += 10) await post('stellar', { transactions: transactions.slice(index, index + 10) });
  for (let index = 0; index < payments.length; index += 10) await post('stellar', { payments: payments.slice(index, index + 10) });
  return post('stellar', { effects, accounts, ...extra });
}
const reported = (amount) => ({ balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '5.0000000' },
  { asset_type: 'native', balance: xlm(amount) }] });
async function horizonCalls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).filter(({ url }) => new URL(url).hostname === horizonHost);
}
async function newRequests(action) {
  const before = (await horizonCalls()).length;
  const result = await action();
  return { result, calls: (await horizonCalls()).slice(before) };
}
// What one Horizon call asked: the list or record and the cursor it continued from.
const call = ({ method, url }) => {
  assert.equal(method, 'GET');
  const parsed = new URL(url);
  const effects = /^\/operations\/([0-9]+)\/effects$/.exec(parsed.pathname);
  if (effects) return ['effects', effects[1]];
  const path = /^\/accounts\/([A-Z2-7]{56})(?:\/(transactions|payments))?$/.exec(parsed.pathname);
  assert.ok(path, `Unexpected Horizon call ${parsed.pathname}`);
  return path[2] ? [path[2], path[1], parsed.searchParams.get('cursor')] : ['account', path[1]];
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
    assert.match(name, /^capital_tracker_stellar_wallets_e2e$/);
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
  legs.map(({ txid, received, sent, fee, direction, n }) => ({ txid, asset: null, received: String(received),
    sent: String(sent), fee: String(fee), direction, block: ledger(n) })));
  rows.forEach((row, index) => {
    assert.equal(row.blockHash, null);
    assert.equal(row.blockTime.toISOString(), new Date(at(legs[index].n)).toISOString());
    assert.equal(row.raw.txid, row.txid, 'Raw provider observation is retained');
    assert.equal(row.raw.transaction.hash, row.txid);
    assert.equal(row.raw.transaction.envelope_xdr, undefined, 'The XDR blobs are not stored');
  });
}
function services(db) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const stellar = new StellarSyncAdapter(db, new HorizonClient({ pauseMs: 0 }));
  const scheduler = (enabled) => new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }),
    [stellar], classifications);
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
  assert.match(migrate(database), /Migrations applied: 49/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('stellar-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('stellar-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const newAccount = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const mainAccount = await newAccount('Main');
    const coldAccount = await newAccount('Cold');

    // STELLAR-ADD, WAL-INVALID, WAL-DUP: no provider call while an address is added.
    const added = await newRequests(async () => {
      const first = await s.addresses.register(owner, { network: 'stellar', address: wallet, accountId: mainAccount, label: 'Main XLM' });
      const again = await s.addresses.register(owner, { network: 'stellar', address: wallet, accountId: coldAccount });
      const broken = `${wallet.slice(0, -1)}${wallet.endsWith('A') ? 'B' : 'A'}`;
      for (const input of [
        { network: 'stellar', address: broken },
        { network: 'stellar', address: wallet.toLowerCase() },
        // A secret seed, a muxed exchange address and other networks' addresses.
        { network: 'stellar', address: strKey(18 << 3, sha256('ct-e2e-stellar:seed')) },
        { network: 'stellar', address: strKey(12 << 3, Buffer.concat([sha256('ct-e2e-stellar:muxed'), Buffer.alloc(8)])) },
        { network: 'stellar', address: bitcoinAddress },
        { network: 'stellar', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
        { network: 'tron', address: wallet },
        { network: 'solana', address: wallet },
        { network: 'bitcoin', address: wallet },
      ]) await refusal(() => s.addresses.register(owner, input), 400);
      return { first, again };
    });
    assert.deepEqual(added.calls, []);
    const { first, again } = added.result;
    assert.deepEqual([first.created, again.created, again.value.id], [true, false, first.value.id]);
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label, first.value.balances,
      first.value.reportedBalance, first.value.sync.state], ['stellar', wallet, mainAccount, 'Main XLM', null, null, 'never']);
    const mainId = first.value.id;
    console.log('PASS STELLAR-ADD a G-account is stored exactly as given; WAL-DUP returns the same wallet; WAL-INVALID 400 for a broken checksum, lower case, a secret seed, a muxed address and other networks; no provider call');

    // STELLAR-IDENTITY: the first sync lists the wallet's transactions and payments oldest first,
    // reads a merge's amount from its effects, and the balance Horizon reports.
    const balance = balanceOf(mainLegs);
    await postStellar(history, { accounts: { [wallet]: reported(balance) } });
    const sync1 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync1.result.outcome, sync1.result.reason, sync1.result.imported], ['complete', null, 6]);
    assert.deepEqual(sync1.calls.map(call), [
      // Seven transactions are two of the app's short pages.
      ['transactions', wallet, null],
      ['transactions', wallet, toid(18)],
      ['payments', wallet, null],
      ['effects', toid(22, 1)],
      ['account', wallet],
    ]);
    assertLegs(await stored(db, mainId), mainLegs);
    const pathLeg = (await stored(db, mainId)).find((row) => row.txid === hash(5));
    assert.equal(pathLeg.raw.operations[0].type, 'path_payment_strict_send');
    // SYNC-RECONCILE: the whole stored history gives the balance Horizon reports.
    const summary = sync1.result.address;
    assert.deepEqual(summary.balances, [{ symbol: 'XLM', quantity: xlm(balance) }]);
    assert.equal(xlm(balance), '97.9999700');
    assert.deepEqual([summary.chainBalance, summary.transactionCount, summary.sync.state, summary.staking, summary.reportedBalance],
      ['97.9999700', 6, 'complete', null, null]);
    const cursor = async (id) => (await db.query(`SELECT a."scannedBlock", s."readTo"::text AS "readTo",
      s."reportedUnits"::text AS reported FROM wallet_addresses a
      JOIN wallet_stellar_accounts s ON s."addressId"=a.id WHERE a.id=$1`, [id]))[0];
    assert.deepEqual(await cursor(mainId), { scannedBlock: ledger(22), readTo: toid(22), reported: String(balance) });
    console.log('PASS STELLAR-IDENTITY one XLM leg per transaction under its hash: account creation, payments, a path payment\'s XLM, two payments in one transaction, a merge by its effect, the fee of a failed one; USDC on Stellar skipped');
    console.log('PASS SYNC-RECONCILE complete history gives 97.99997 XLM, the balance Horizon reports');

    // Resync: nothing twice; a new transaction is read after the cursor.
    const sync2 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync2.result.outcome, sync2.result.imported], ['complete', 0]);
    assert.deepEqual(sync2.calls.map(call), [['transactions', wallet, toid(22)], ['account', wallet]]);
    await postStellar({ transactions: [tx(8, 30, outside)], payments: [pay(8, 30, outside, wallet, 4 * STROOP)] },
      { accounts: { [wallet]: reported(balance + 4 * STROOP) } });
    const sync3 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync3.result.outcome, sync3.result.imported], ['complete', 1]);
    // The payments continue past every operation of the stored transaction.
    const after22 = ((BigInt(toid(22))) | 0xfffn).toString();
    assert.deepEqual(sync3.calls.map(call), [['transactions', wallet, toid(22)], ['payments', wallet, after22], ['account', wallet]]);
    const finalLegs = [{ txid: hash(8), received: 4 * STROOP, sent: 0, fee: 0, direction: 'in', n: 30 }, ...mainLegs];
    assertLegs(await stored(db, mainId), finalLegs);
    await db.query('UPDATE wallet_stellar_accounts SET "readTo"=NULL WHERE "addressId"=$1', [mainId]);
    await db.query('UPDATE wallet_addresses SET "scannedBlock"=NULL, "completedAt"=NULL WHERE id=$1', [mainId]);
    const replay = await s.addresses.sync(owner, mainId);
    assert.deepEqual([replay.outcome, replay.imported, replay.address.transactionCount], ['complete', 0, 7]);
    assertLegs(await stored(db, mainId), finalLegs);
    console.log('PASS STELLAR-SYNC resync stores each leg once: 0 new, 1 for a new transaction, 0 after a full replay');

    // STELLAR-SYNC: a history longer than a pass reads commits whole transactions and goes on next pass.
    const busyId = (await s.addresses.register(owner, { network: 'stellar', address: busy })).value.id;
    const many = Array.from({ length: 45 }, (_, index) => index + 100);
    await postStellar({ transactions: many.map((n) => tx(`busy-${n}`, n, outside)),
      payments: many.map((n) => pay(`busy-${n}`, n, outside, busy, STROOP)) }, { accounts: { [busy]: reported(45 * STROOP) } });
    const partial = await newRequests(() => s.addresses.sync(owner, busyId));
    assert.deepEqual([partial.result.outcome, partial.result.imported, partial.result.address.sync.state, partial.result.address.balances],
      ['partial', 40, 'partial', null]);
    assert.deepEqual(partial.calls.map(call).filter(([kind]) => kind === 'transactions').length, 8);
    assert.equal((await cursor(busyId)).readTo, toid(139));
    const rest = await s.addresses.sync(owner, busyId);
    assert.deepEqual([rest.outcome, rest.imported, rest.address.balances[0]], ['complete', 5, { symbol: 'XLM', quantity: '45.0000000' }]);
    console.log('PASS STELLAR-SYNC 45 transactions store as 40 whole ones in the first pass and 5 in the next');

    // STELLAR-REPORTED: a balance Horizon reports that the history does not explain is shown, never counted.
    const driftId = (await s.addresses.register(owner, { network: 'stellar', address: drift })).value.id;
    await postStellar({ transactions: [tx('d1', 200, outside)], payments: [pay('d1', 200, outside, drift, 10 * STROOP)] },
      { accounts: { [drift]: reported(50 * STROOP) } });
    const drifted = (await s.addresses.sync(owner, driftId)).address;
    assert.deepEqual([drifted.chainBalance, drifted.reportedBalance], ['10.0000000', '50.0000000']);
    console.log('PASS STELLAR-REPORTED 50 XLM reported against 10 read is shown beside the balance, which keeps the history');

    // Constraints: G-addresses, a positive cursor, a reported balance with its time.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'stellar',$2)`,
      [owner, wallet.toLowerCase()]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query('UPDATE wallet_stellar_accounts SET "readTo"=0 WHERE "addressId"=$1', [mainId]),
      /wallet_stellar_accounts_readTo_check/);
    await assert.rejects(() => db.query('UPDATE wallet_stellar_accounts SET "reportedAt"=NULL WHERE "addressId"=$1', [mainId]),
      /wallet_stellar_accounts_check/);
    console.log('PASS STELLAR-DB address, cursor and reported balance checks refuse anything else');

    // STELLAR-LINK: once the main wallet's XLM has a cost, its send to the cold wallet becomes one transfer.
    const coldId = (await s.addresses.register(owner, { network: 'stellar', address: cold, accountId: coldAccount })).value.id;
    await postStellar({ transactions: [tx(20, 40, wallet)], payments: [pay(20, 40, wallet, cold, 20 * STROOP)] },
      { accounts: { [cold]: reported(20 * STROOP) } });
    assert.equal((await s.addresses.sync(owner, coldId)).imported, 1);
    await s.classifications.classify(owner, mainId, hash(1), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '30' } });
    assert.equal((await s.addresses.sync(owner, mainId)).imported, 1);
    const links = await db.query(`SELECT "addressId", type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [hash(20)]);
    assert.equal(links.length, 2, 'Both legs of the own transfer are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const list = (await s.operations.read(owner, {}, now)).operations;
    const moved = list.filter((operation) => operation.chain?.txid === hash(20));
    assert.equal(moved.length, 1, 'A linked pair is listed once');
    assert.deepEqual([moved[0].type, moved[0].asset.symbol, moved[0].quantity, moved[0].fee?.asset.symbol, moved[0].fee?.quantity],
      ['transfer', 'XLM', '20', 'XLM', '0.00001']);
    const receipt = list.find((operation) => operation.chain?.txid === hash(6));
    assert.deepEqual([receipt.asset.symbol, receipt.quantity, receipt.direction, receipt.status], ['XLM', '3', 'in', 'needs-classification']);
    console.log('PASS STELLAR-LINK a 20 XLM send between own accounts auto-links into one transfer with its XLM fee; receipts wait for classification');

    // SYNC-ISOLATION, SYNC-BG: Horizon over its limit delays only that wallet, which recovers on its next run.
    await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "nextRunAt")
      SELECT 'wallet:' || id, 'synced', now(), now() + interval '1 day' FROM wallet_addresses
      ON CONFLICT (key) DO UPDATE SET "nextRunAt" = EXCLUDED."nextRunAt"`);
    const late = account('late');
    const lateId = (await s.addresses.register(owner, { network: 'stellar', address: late })).value.id;
    await postStellar({ transactions: [tx('l1', 300, outside)], payments: [pay('l1', 300, outside, late, 3 * STROOP)] },
      { accounts: { [late]: reported(3 * STROOP) }, fault: { onRequest: 1, status: 429 } });
    const t0 = new Date();
    assert.deepEqual(await s.scheduler(true).tick(t0), { outcome: 'ran', wallets: [{ id: lateId, state: 'delayed' }] });
    let listed = (await s.addresses.list(owner)).find((item) => item.id === lateId);
    assert.deepEqual([listed.sync.status, listed.sync.errorMessage], ['delayed', 'The Stellar data source is busy. The app tries again in a few minutes.']);
    assert.deepEqual(await s.scheduler(true).tick(new Date(t0.getTime() + 15 * 60000)), { outcome: 'ran', wallets: [{ id: lateId, state: 'synced' }] });
    listed = (await s.addresses.list(owner)).find((item) => item.id === lateId);
    assert.deepEqual([listed.sync.status, listed.balances[0]], ['synced', { symbol: 'XLM', quantity: '3.0000000' }]);
    console.log('PASS SYNC-ISOLATION Horizon over its limit delays only its wallet with a readable reason; SYNC-BG the hourly job recovers it');

    await refusal(() => s.addresses.sync(stranger, mainId), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS STELLAR-PRIVATE another owner gets 404 for the wallet and sees none');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new TrackStellarWallets1794700000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS STELLAR-MIGRATION fresh 49 applies once; the Stellar migration refuses down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
