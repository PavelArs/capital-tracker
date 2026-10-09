'use strict';

// Real PostgreSQL acceptance for track-tron-wallets. Only TronGrid is synthetic: requests leave
// through HTTPS_PROXY to the providers.cjs stub, which answers from the raw items this probe
// posts in TronGrid's own shapes. Every address, hash and amount is synthetic.
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
const { EsploraClient } = require(`${dist}/wallet-addresses/esplora-client.js`);
const { BitcoinSyncAdapter } = require(`${dist}/wallet-addresses/bitcoin-sync.adapter.js`);
const { TronGridClient } = require(`${dist}/wallet-addresses/trongrid-client.js`);
const { TronSyncAdapter } = require(`${dist}/wallet-addresses/tron-sync.adapter.js`);
const { TrackTronWallets1793600000000 } = require(`${dist}/migrations/1793600000000-TrackTronWallets.js`);
const { readChainMoves } = require(`${dist}/accounting/portfolio-valuation.service.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_tron_wallets_e2e';
const control = 'http://providers:8080/__control';
const tronHost = 'api.trongrid.io';
const now = new Date('2026-10-09T12:00:00.000Z');
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
// Base58check restated from the format so the probe does not trust the code it checks.
function base58(bytes) {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}
const check = (payload) => base58(Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]));
// Synthetic accounts: 0x41 and 20 bytes of a hash of a fixed label, never a real wallet.
const payload = (label) => Buffer.concat([Buffer.from([0x41]), sha256(`ct-e2e-tron:${label}`).subarray(0, 20)]);
const account = (label) => ({ address: check(payload(label)), hex: payload(label).toString('hex') });
const hash = (id) => sha256(`ct-e2e-tron-tx:${id}`).toString('hex');
const wallet = account('main');
const cold = account('cold');
const busy = account('busy');
const staker = account('staker');
const outside = account('outside');
const witness = account('witness');
// The public TRC-20 contracts of USDT and USDC on Tron, and a look-alike token.
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDC = 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';
const fake = account('fake-usdt');
const SUN = 1_000_000;
const block = (n) => 70000000 + n;
const at = (n) => 1760000000000 + n * 3000;
const tip = (n) => ({ number: block(n), timestamp: at(n) });
// A synthetic Bitcoin wallet that shares the scheduler.
const bitcoinAddress = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';

// An item of /v1/accounts/{address}/transactions as TronGrid returns it: addresses in hex.
function tx(id, n, type, value, { ret = 'SUCCESS', fee = 0 } = {}) {
  return { ret: [{ contractRet: ret, fee }], signature: ['0'.repeat(130)], txID: hash(id), net_usage: 268,
    raw_data_hex: '0a02', net_fee: 0, energy_usage: 0, blockNumber: block(n), block_timestamp: at(n), energy_fee: 0,
    energy_usage_total: 0, internal_transactions: [],
    raw_data: { contract: [{ parameter: { value, type_url: `type.googleapis.com/protocol.${type}` }, type }],
      ref_block_bytes: '0000', ref_block_hash: '0000000000000000', expiration: at(n) + 60000, timestamp: at(n) - 1000 } };
}
const transfer = (id, n, from, to, amount, options) =>
  tx(id, n, 'TransferContract', { amount, owner_address: from.hex, to_address: to.hex }, options);
// An internal transfer of TRX by a contract, listed apart.
const internal = (id, n, from, to, units) => ({ internal_tx_id: hash(`internal:${id}`),
  data: { note: '63616c6c', rejected: false, call_value: { _: units } }, block_timestamp: at(n),
  to_address: to.hex, tx_id: hash(id), from_address: from.hex });
// An item of /v1/accounts/{address}/transactions/trc20: addresses in base58.
const trc20 = (id, n, contract, from, to, value) => ({ transaction_id: hash(id),
  token_info: { symbol: contract === USDC ? 'USDC' : 'USDT', address: contract, decimals: 6, name: 'Synthetic' },
  block_timestamp: at(n), from: from.address, to: to.address, type: 'Transfer', value: String(value) });
// gettransactioninfobyid: the node's record of a run; zero fields left out like Tron's JSON.
const info = (id, n, extra = {}) => ({ id: hash(id), blockNumber: block(n), blockTimeStamp: at(n),
  contractResult: [''], receipt: { net_usage: 268 }, ...extra });

// The main wallet's history, oldest first.
const history = {
  transactions: [
    transfer(1, 10, outside, wallet, 1000 * SUN),
    // Sent to a new account: the fee includes its activation.
    transfer(2, 12, wallet, outside, 100 * SUN, { fee: 1.1 * SUN }),
    // A USDT transfer the wallet signed: energy burned in TRX.
    tx(4, 20, 'TriggerSmartContract', { owner_address: wallet.hex, contract_address: payload('usdt').toString('hex'),
      data: 'a9059cbb' }, { fee: 13.8 * SUN }),
    // A contract call that reverted: only its fee leaves.
    tx(6, 30, 'TriggerSmartContract', { owner_address: wallet.hex, contract_address: payload('dex').toString('hex'),
      data: '7ff36ab5', call_value: 40 * SUN }, { ret: 'REVERT', fee: 5 * SUN }),
    // Not solid yet.
    transfer(9, 150, outside, wallet, 7 * SUN),
  ],
  internal: [internal(8, 40, account('dex'), wallet, 25 * SUN)],
  tokens: [
    trc20(3, 15, USDT, outside, wallet, 500 * SUN),
    trc20(4, 20, USDT, wallet, outside, 200 * SUN),
    trc20(5, 25, USDC, outside, wallet, 50 * SUN),
    // Address poisoning: a zero-value USDT transfer and a look-alike token.
    trc20(7, 35, USDT, outside, wallet, 0),
    trc20(70, 35, fake.address, outside, wallet, 999 * SUN),
  ],
  infos: {
    [hash(2)]: info(2, 12, { fee: 1.1 * SUN }),
    [hash(3)]: info(3, 15, { contract_address: payload('usdt').toString('hex') }),
    [hash(4)]: info(4, 20, { fee: 13.8 * SUN, receipt: { energy_fee: 13.8 * SUN, energy_usage_total: 130000, result: 'SUCCESS' } }),
    [hash(5)]: info(5, 25),
    [hash(6)]: info(6, 30, { fee: 5 * SUN, result: 'FAILED', resMessage: '52455645525420', receipt: { energy_fee: 5 * SUN, result: 'REVERT' } }),
    [hash(8)]: info(8, 40),
  },
};
// Independent oracle of the stored legs of the main wallet, newest block first.
const mainLegs = [
  { txid: hash(8), asset: null, received: 25 * SUN, sent: 0, fee: 0, direction: 'in', n: 40 },
  { txid: hash(6), asset: null, received: 0, sent: 5 * SUN, fee: 5 * SUN, direction: 'out', n: 30 },
  { txid: `${hash(5)}-2`, asset: 'USDC', received: 50 * SUN, sent: 0, fee: 0, direction: 'in', n: 25 },
  { txid: hash(4), asset: null, received: 0, sent: 13.8 * SUN, fee: 13.8 * SUN, direction: 'out', n: 20 },
  { txid: `${hash(4)}-1`, asset: 'USDT', received: 0, sent: 200 * SUN, fee: 0, direction: 'out', n: 20 },
  { txid: `${hash(3)}-1`, asset: 'USDT', received: 500 * SUN, sent: 0, fee: 0, direction: 'in', n: 15 },
  { txid: hash(2), asset: null, received: 0, sent: 101.1 * SUN, fee: 1.1 * SUN, direction: 'out', n: 12 },
  { txid: hash(1), asset: null, received: 1000 * SUN, sent: 0, fee: 0, direction: 'in', n: 10 },
];

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
// Few items per call keep each control body small.
async function postTron({ transactions = [], internal: inner = [], tokens = [], infos = {} }, extra = {}) {
  for (let index = 0; index < transactions.length; index += 3) await post('tron', { transactions: transactions.slice(index, index + 3) });
  for (let index = 0; index < tokens.length; index += 4) await post('tron', { tokens: tokens.slice(index, index + 4) });
  if (inner.length) await post('tron', { internal: inner });
  const entries = Object.entries(infos);
  for (let index = 0; index < entries.length; index += 4) await post('tron', { infos: Object.fromEntries(entries.slice(index, index + 4)) });
  return post('tron', extra);
}
async function tronCalls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).filter(({ url }) => new URL(url).hostname === tronHost);
}
async function newRequests(action) {
  const before = (await tronCalls()).length;
  const result = await action();
  return { result, calls: (await tronCalls()).slice(before) };
}
// What one TronGrid call asked: the endpoint and the account, contract or hash it names.
const call = ({ method, url }) => {
  assert.equal(method, 'GET');
  const parsed = new URL(url);
  const query = parsed.searchParams;
  if (parsed.pathname === '/walletsolidity/getblock' && parsed.search === '?detail=false') return ['tip'];
  if (parsed.pathname === '/walletsolidity/gettransactioninfobyid') return ['info', query.get('value')];
  if (parsed.pathname === '/walletsolidity/getaccount') return ['account', query.get('address')];
  if (parsed.pathname === '/wallet/getReward') return ['reward', query.get('address')];
  const list = /^\/v1\/accounts\/([^/]+)\/transactions(\/trc20)?$/.exec(parsed.pathname);
  assert.ok(list, `Unexpected TronGrid call ${parsed.pathname}`);
  return [list[2] ? 'trc20' : 'transactions', list[1], ...(list[2] ? [query.get('contract_address')] : []),
    Number(query.get('min_timestamp')), query.get('fingerprint')];
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
    assert.match(name, /^capital_tracker_tron_wallets_e2e$/);
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
  legs.map(({ txid, asset, received, sent, fee, direction, n }) => ({ txid, asset, received: String(received),
    sent: String(sent), fee: String(fee), direction, block: block(n) })));
  rows.forEach((row, index) => {
    assert.equal(row.blockHash, null);
    assert.equal(row.blockTime.toISOString(), new Date(at(legs[index].n)).toISOString());
    assert.equal(row.raw.txid, row.txid, 'Raw provider observation is retained');
    assert.equal(row.raw.hash, row.txid.split('-')[0]);
  });
}
function services(db, apiKey = null) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const bitcoin = new BitcoinSyncAdapter(db, new EsploraClient());
  const tron = new TronSyncAdapter(db, new TronGridClient({ apiKey, pauseMs: 0 }));
  const scheduler = (enabled) => new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }),
    [bitcoin, tron], classifications);
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
  assert.match(migrate(database), /Migrations applied: 51/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('tron-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('tron-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const newAccount = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const mainAccount = await newAccount('Main');
    const coldAccount = await newAccount('Cold');

    // TRON-ADD, WAL-INVALID, WAL-DUP: no provider call while an address is added.
    const added = await newRequests(async () => {
      const first = await s.addresses.register(owner, { network: 'tron', address: wallet.address, accountId: mainAccount, label: 'Main TRX' });
      const again = await s.addresses.register(owner, { network: 'tron', address: wallet.address, accountId: coldAccount });
      const broken = `${wallet.address.slice(0, -1)}${wallet.address.endsWith('1') ? '2' : '1'}`;
      for (const input of [
        // A changed last character breaks the checksum.
        { network: 'tron', address: broken },
        // The hex form, the lower-case text, another network's address and a Solana-length key.
        { network: 'tron', address: wallet.hex },
        { network: 'tron', address: wallet.address.toLowerCase() },
        { network: 'tron', address: `0x${'ab'.repeat(20)}` },
        { network: 'tron', address: bitcoinAddress },
        { network: 'tron', address: base58(sha256('ct-e2e-tron:solana-key')) },
        { network: 'tron', address: base58(Buffer.concat([sha256('ct-e2e-tron:secret'), sha256('ct-e2e-tron:secret-2')])) },
        { network: 'solana', address: wallet.address },
        { network: 'ethereum', address: wallet.address },
        { network: 'bitcoin', address: wallet.address },
      ]) await refusal(() => s.addresses.register(owner, input), 400);
      return { first, again };
    });
    assert.deepEqual(added.calls, []);
    const { first, again } = added.result;
    assert.deepEqual([first.created, again.created, again.value.id], [true, false, first.value.id]);
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label, first.value.balances, first.value.staking, first.value.sync.state],
      ['tron', wallet.address, mainAccount, 'Main TRX', null, null, 'never']);
    const mainId = first.value.id;
    console.log('PASS TRON-ADD a base58check T-address is stored exactly as given; WAL-DUP returns the same wallet; WAL-INVALID 400 for a broken checksum, hex or lower-case form, other networks\' addresses and keys; no provider call');

    // TRON-IDENTITY: the first sync lists the wallet's transactions, internal TRX and USDT and
    // USDC transfers up to the newest solid block, then reads the node's record of each
    // transaction the wallet signed and of each one the lists give no block for.
    await postTron(history, { tip: tip(100) });
    const sync1 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync1.result.outcome, sync1.result.reason, sync1.result.imported], ['complete', null, 8]);
    assert.deepEqual(sync1.calls.map(call), [
      ['tip'],
      ['transactions', wallet.address, 1, null],
      ['trc20', wallet.address, USDT, 1, null],
      ['trc20', wallet.address, USDC, 1, null],
      ...[2, 3, 4, 5, 6, 8].map((id) => ['info', hash(id)]),
      ['account', wallet.address],
    ]);
    assert.ok(sync1.calls.every(({ url }) => !new URL(url).searchParams.has('apikey')));
    assertLegs(await stored(db, mainId), mainLegs);
    const usdtSend = (await stored(db, mainId)).filter((row) => row.txid.startsWith(hash(4)));
    assert.deepEqual(usdtSend.map((row) => [row.txid, row.asset, row.fee]), [[hash(4), null, String(13.8 * SUN)], [`${hash(4)}-1`, 'USDT', '0']]);
    assert.equal(usdtSend[0].raw.contractType, 'TriggerSmartContract');
    assert.equal(usdtSend[0].raw.info.fee, 13.8 * SUN);
    assert.equal(usdtSend[1].raw.contract, USDT);
    // SYNC-RECONCILE: per asset, received minus sent of the whole stored history.
    const summary = sync1.result.address;
    assert.deepEqual(summary.balances, [
      { symbol: 'TRX', quantity: '905.100000' },
      { symbol: 'USDT', quantity: '300.000000' },
      { symbol: 'USDC', quantity: '50.000000' },
    ]);
    assert.deepEqual([summary.chainBalance, summary.transactionCount, summary.sync.state, summary.staking], ['905.100000', 8, 'complete', null]);
    const cursor = async (id) => (await db.query(`SELECT a."scannedBlock", t."readTo" FROM wallet_addresses a
      JOIN wallet_tron_accounts t ON t."addressId"=a.id WHERE a.id=$1`, [id]))[0];
    assert.deepEqual(await cursor(mainId), { scannedBlock: block(100), readTo: new Date(at(100)) });
    console.log('PASS TRON-IDENTITY a USDT send stores a TRX fee leg (hash) and a USDT leg (hash-1); USDC is hash-2; a reverted call keeps its fee; TRX from a contract counts; zero-value and look-alike tokens skipped');
    console.log('PASS SYNC-RECONCILE complete history gives TRX 905.1, USDT 300, USDC 50');

    // Resync: nothing twice; only a block made solid since is read.
    const sync2 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync2.result.outcome, sync2.result.imported], ['complete', 0]);
    assert.deepEqual(sync2.calls.map(call), [['tip'], ['account', wallet.address]]);
    await post('tron', { tip: tip(200) });
    const sync3 = await newRequests(() => s.addresses.sync(owner, mainId));
    assert.deepEqual([sync3.result.outcome, sync3.result.imported], ['complete', 1]);
    assert.deepEqual(sync3.calls.map(call), [
      ['tip'],
      ['transactions', wallet.address, at(100) + 1, null],
      ['trc20', wallet.address, USDT, at(100) + 1, null],
      ['trc20', wallet.address, USDC, at(100) + 1, null],
      ['account', wallet.address],
    ]);
    const finalLegs = [{ txid: hash(9), asset: null, received: 7 * SUN, sent: 0, fee: 0, direction: 'in', n: 150 }, ...mainLegs];
    assertLegs(await stored(db, mainId), finalLegs);
    // Reading the same solid blocks again stores nothing twice.
    await db.query('UPDATE wallet_tron_accounts SET "readTo"=NULL WHERE "addressId"=$1', [mainId]);
    await db.query('UPDATE wallet_addresses SET "scannedBlock"=NULL, "completedAt"=NULL WHERE id=$1', [mainId]);
    const replay = await s.addresses.sync(owner, mainId);
    assert.deepEqual([replay.outcome, replay.imported, replay.address.transactionCount], ['complete', 0, 9]);
    assertLegs(await stored(db, mainId), finalLegs);
    console.log('PASS TRON-SYNC resync stores each leg once: 0 new on the same block, 1 once its block is solid, 0 after a full replay');

    // TRON-SYNC: a list longer than a pass may read ends before the block time of its last item;
    // the next pass continues there.
    const busyId = (await s.addresses.register(owner, { network: 'tron', address: busy.address })).value.id;
    await postTron({ transactions: [10, 11, 12, 13, 14, 15, 16].map((n) => transfer(`busy-${n}`, 200 + n, outside, busy, SUN)) },
      { tip: tip(250), pageSize: 1 });
    const partial = await newRequests(() => s.addresses.sync(owner, busyId));
    assert.deepEqual([partial.result.outcome, partial.result.imported, partial.result.address.sync.state, partial.result.address.balances],
      ['partial', 4, 'partial', null]);
    assert.deepEqual(partial.calls.map(call).slice(0, 6), [
      ['tip'],
      ['transactions', busy.address, 1, null],
      ...[1, 2, 3, 4].map((offset) => ['transactions', busy.address, 1, `offset-${offset}`]),
    ]);
    assert.deepEqual((await cursor(busyId)).readTo, new Date(at(214) - 1));
    const rest = await s.addresses.sync(owner, busyId);
    assert.deepEqual([rest.outcome, rest.imported, rest.address.balances[0]], ['complete', 3, { symbol: 'TRX', quantity: '7.000000' }]);
    await post('tron', { pageSize: 200 });
    console.log('PASS TRON-SYNC a list of more pages than one pass reads stores whole block times (4 of 7), then the rest on the next pass');

    // Constraints: base58check T-addresses, hex hashes, non-zero stake moves.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'tron',$2)`,
      [owner, wallet.hex]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'dogecoin',$2)`,
      [owner, wallet.address]), /wallet_addresses_(network|address)_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_tron_stake_moves("ownerId","addressId",txid,"blockHeight","blockTime",units)
      VALUES ($1,$2,$3,1,now(),0)`, [owner, mainId, hash(99)]), /wallet_tron_stake_moves_units_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_tron_stake_moves("ownerId","addressId",txid,"blockHeight","blockTime",units)
      VALUES ($1,$2,$3,1,now(),5)`, [owner, mainId, hash(99).toUpperCase()]), /wallet_tron_stake_moves_txid_check/);
    console.log('PASS TRON-DB network, address, stake move id and amount checks refuse anything else');

    // TRON-LINK: once the main wallet's TRX has a cost, its send to the cold wallet becomes one transfer.
    const coldId = (await s.addresses.register(owner, { network: 'tron', address: cold.address, accountId: coldAccount })).value.id;
    await postTron({ transactions: [transfer(20, 220, wallet, cold, 50 * SUN)], infos: { [hash(20)]: info(20, 220, { fee: 0.27 * SUN }) } }, { tip: tip(300) });
    assert.equal((await s.addresses.sync(owner, coldId)).imported, 1);
    await s.classifications.classify(owner, mainId, hash(1), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '250' } });
    assert.equal((await s.addresses.sync(owner, mainId)).imported, 1);
    const links = await db.query(`SELECT "addressId", type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [hash(20)]);
    assert.equal(links.length, 2, 'Both legs of the own transfer are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const list = (await s.operations.read(owner, {}, now)).operations;
    const byTx = (txid) => list.filter((operation) => operation.chain?.txid === txid);
    const moved = byTx(hash(20));
    assert.equal(moved.length, 1, 'A linked pair is listed once');
    assert.deepEqual([moved[0].type, moved[0].asset.symbol, moved[0].quantity, moved[0].fee?.asset.symbol, moved[0].fee?.quantity],
      ['transfer', 'TRX', '50', 'TRX', '0.27']);
    const tokenSend = byTx(`${hash(4)}-1`)[0];
    // TOKEN-FEE: the TRX burnt for energy is the USDT send's fee, not a row of its own.
    assert.deepEqual([tokenSend.asset.symbol, tokenSend.quantity, tokenSend.fee?.asset.symbol, tokenSend.fee?.quantity, tokenSend.status],
      ['USDT', '200', 'TRX', '13.8', 'needs-classification']);
    assert.deepEqual(byTx(hash(4)), []);
    console.log('PASS TRON-LINK a 50 TRX send between own accounts auto-links into one transfer with its TRX fee; token legs list as USDT and USDC');

    // SYNC-ISOLATION and SYNC-BG: the hourly job runs Bitcoin and Tron; a TronGrid over its call
    // limit delays only its wallet, which recovers on its next due run.
    await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "nextRunAt")
      SELECT 'wallet:' || id, 'synced', now(), now() + interval '1 day' FROM wallet_addresses
      ON CONFLICT (key) DO UPDATE SET "nextRunAt" = EXCLUDED."nextRunAt"`);
    const btc = (await s.addresses.register(owner, { network: 'bitcoin', address: bitcoinAddress })).value.id;
    const late = account('late');
    const lateId = (await s.addresses.register(owner, { network: 'tron', address: late.address })).value.id;
    await post('bitcoin-history', { address: bitcoinAddress, count: 2 });
    await postTron({ transactions: [transfer(30, 230, outside, late, 3 * SUN)] }, { fault: { onRequest: 1, limited: true } });
    const t0 = new Date();
    assert.deepEqual(await s.scheduler(true).tick(t0), { outcome: 'ran', wallets: [{ id: btc, state: 'synced' }, { id: lateId, state: 'delayed' }] });
    let listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual([listed.get(lateId).sync.status, listed.get(lateId).sync.errorMessage],
      ['delayed', 'The Tron data source is busy. The app tries again in a few minutes.']);
    assert.equal(listed.get(btc).transactionCount, 2);
    const t1 = new Date(t0.getTime() + 15 * 60000);
    assert.deepEqual(await s.scheduler(true).tick(t1), { outcome: 'ran', wallets: [{ id: lateId, state: 'synced' }] });
    listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual([listed.get(lateId).sync.status, listed.get(lateId).sync.errorMessage, listed.get(lateId).balances[0]],
      ['synced', null, { symbol: 'TRX', quantity: '3.000000' }]);
    console.log('PASS SYNC-ISOLATION a TronGrid over its call limit delays only its wallet with a readable reason; Bitcoin syncs');
    console.log('PASS SYNC-BG the hourly job syncs Tron wallets beside Bitcoin ones and recovers on the next due run');

    // TRON-KEY: TronGrid refusing keyless requests fails the wallet with what to add on the
    // server; a configured TRONGRID_API_KEY goes in TronGrid's header and never in the URL.
    await post('tron', { key: 'acceptance-trongrid-key' });
    const keyless = await s.addresses.sync(owner, lateId);
    assert.deepEqual([keyless.outcome, keyless.reason, keyless.address.sync.errorMessage],
      ['provider_error', 'not_configured', 'TronGrid refused the requests. A free TronGrid API key on the server (TRONGRID_API_KEY) lets the app read Tron wallets reliably.']);
    const keyed = await newRequests(() => services(db, 'acceptance-trongrid-key').addresses.sync(owner, lateId));
    assert.deepEqual([keyed.result.outcome, keyed.result.address.sync.errorMessage], ['complete', null]);
    assert.ok(keyed.calls.length > 0 && keyed.calls.every(({ url }) => !url.includes('acceptance-trongrid-key')));
    await post('tron', { key: null });
    console.log('PASS TRON-KEY without a key TronGrid\'s refusal names TRONGRID_API_KEY; with one it is sent as a header only');

    // Reads stay owner-scoped and per asset.
    const page = await s.addresses.transactions(owner, mainId, {});
    assert.equal(page.total, 10);
    assert.deepEqual(page.items.find((item) => item.txid === `${hash(5)}-2`), {
      txid: `${hash(5)}-2`, blockHeight: block(25), blockTime: new Date(at(25)).toISOString(), direction: 'in',
      symbol: 'USDC', received: '50.000000', sent: '0.000000', net: '50.000000', fee: '0.000000',
      receivedBtc: '50.000000', sentBtc: '0.000000', netBtc: '50.000000', feeBtc: '0.000000',
      usdValue: null, usdValueStatus: 'missing',
    });
    await refusal(() => s.addresses.sync(stranger, mainId), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS TRON-PRIVATE another owner gets 404 for the wallet and sees none; legs read per asset');

    // TRON-STAKE-MOVE, TRON-STAKE-STATE, TRON-REWARD: 2000 TRX arrive; 1000 are staked for energy
    // and 300 for bandwidth; votes are cast; 200 are unstaked and withdrawn after the wait; 12.5
    // TRX of vote rewards are claimed. The chain then reports 800 for energy, 300 for bandwidth
    // and 3.2 TRX of rewards not claimed yet.
    const stakerAccount = await newAccount('Staker');
    const stakerId = (await s.addresses.register(owner, { network: 'tron', address: staker.address, accountId: stakerAccount })).value.id;
    const toClassify = async () => (await s.classifications.needsClassificationCount(owner)).count;
    const waiting = await toClassify();
    const own = (id, n, type, value, extra) => [tx(id, n, type, { owner_address: staker.hex, ...value }), info(id, n, extra)];
    const staking = [
      own('s2', 302, 'FreezeBalanceV2Contract', { frozen_balance: 1000 * SUN, resource: 'ENERGY' }),
      own('s3', 303, 'FreezeBalanceV2Contract', { frozen_balance: 300 * SUN }),
      own('s4', 304, 'VoteWitnessContract', { votes: [{ vote_address: witness.hex, vote_count: 1300 }] }),
      own('s5', 305, 'UnfreezeBalanceV2Contract', { unfreeze_balance: 200 * SUN, resource: 'ENERGY' }),
      own('s6', 306, 'WithdrawExpireUnfreezeContract', {}, { withdraw_expire_amount: 200 * SUN }),
      own('s7', 307, 'WithdrawBalanceContract', {}, { withdraw_amount: 12.5 * SUN }),
    ];
    await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
      VALUES ('TRX','USD','kraken',$1,0.25,'hourly-close')`, [new Date(at(307) - 600000)]);
    await postTron({
      transactions: [transfer('s1', 301, outside, staker, 2000 * SUN), ...staking.map(([item]) => item)],
      infos: Object.fromEntries(staking.map(([, record]) => [record.id, record])),
    }, { tip: tip(400) });
    await post('tron', { accounts: { [staker.address]: { address: staker.address, balance: 912.5 * SUN,
      frozenV2: [{ amount: 300 * SUN }, { type: 'ENERGY', amount: 800 * SUN }, { type: 'TRON_POWER' }],
      votes: [{ vote_address: witness.address, vote_count: 1100 }],
      account_resource: { energy_window_size: 28800 } } }, rewards: { [staker.address]: 3.2 * SUN } });
    const staked = await newRequests(() => s.addresses.sync(owner, stakerId));
    assert.deepEqual([staked.result.outcome, staked.result.imported], ['complete', 5]);
    assert.deepEqual(staked.calls.map(call), [
      ['tip'],
      // Seven transactions are two of the app's small pages.
      ['transactions', staker.address, 1, null],
      ['transactions', staker.address, 1, 'offset-6'],
      ['trc20', staker.address, USDT, 1, null],
      ['trc20', staker.address, USDC, 1, null],
      ...['s2', 's3', 's4', 's5', 's6', 's7'].map((id) => ['info', hash(id)]),
      ['account', staker.address],
      ['reward', staker.address],
    ]);
    const moves = await db.query(`SELECT txid, "blockHeight", units::text AS units FROM wallet_tron_stake_moves
      WHERE "addressId"=$1 ORDER BY "blockHeight"`, [stakerId]);
    assert.deepEqual(moves.map((row) => [row.txid, row.blockHeight, row.units]), [
      [hash('s2'), block(302), String(1000 * SUN)],
      [hash('s3'), block(303), String(300 * SUN)],
      [hash('s6'), block(306), String(-200 * SUN)],
    ]);
    // The wallet's TRX counts what it staked: 2000 - 1000 - 300 + 200 + 12.5 liquid, 1100 staked.
    const stakedSummary = (await s.addresses.list(owner)).find((item) => item.id === stakerId);
    assert.deepEqual(stakedSummary.balances[0], { symbol: 'TRX', quantity: '2012.500000' });
    assert.deepEqual(stakedSummary.staking, { symbol: 'TRX', quantity: '1100.000000', rewards: '12.500000', accounts: [
      { account: 'energy', kind: 'energy', validator: null, pool: null, state: 'active', quantity: '800.000000', rewards: '0.000000', availableAt: null },
      { account: 'bandwidth', kind: 'bandwidth', validator: null, pool: null, state: 'active', quantity: '300.000000', rewards: '0.000000', availableAt: null },
    ], reportedQuantity: null, unclaimedRewards: '3.200000' });
    // Staking moves only the fee (none here); the claimed reward is a Staking reward recorded by
    // itself at the stored TRX price, so it no longer counts provisionally.
    const movesOf = async () => ((await readChainMoves(db.manager, owner)).get(stakerAccount) ?? [])
      .map((move) => [move.inbound, Number(move.quantity)]);
    assert.deepEqual(await movesOf(), [[true, 2000]]);
    const stakeOps = async () => (await s.operations.read(owner, {}, now)).operations
      .filter((operation) => operation.wallet?.id === stakerId)
      .map((operation) => [operation.chain.txid, operation.type, operation.direction, operation.quantity, operation.status]);
    assert.deepEqual(await stakeOps(), [
      [hash('s7'), 'staking-reward', 'in', '12.5', 'recorded'],
      [hash('s6'), 'unstake', 'internal', '200', 'recorded'],
      [hash('s3'), 'stake', 'internal', '300', 'recorded'],
      [hash('s2'), 'stake', 'internal', '1000', 'recorded'],
      [hash('s1'), null, 'in', '2000', 'needs-classification'],
    ]);
    const [reward] = await db.query(`SELECT type, details, automatic, "rewardId" FROM chain_transaction_classification_versions
      WHERE txid=$1`, [hash('s7')]);
    assert.deepEqual([reward.type, reward.details, reward.automatic, reward.rewardId !== null],
      ['staking-reward', { type: 'staking-reward', valueUsd: '3.13' }, true, true]);
    assert.equal(await toClassify(), waiting + 1, 'Only the receipt waits for an answer');
    console.log('PASS TRON-STAKE-MOVE 1300 TRX staked for energy and bandwidth stay in the wallet balance; 200 unstaked and withdrawn come back; listed as Stake and Unstake, nothing to classify');
    console.log('PASS TRON-STAKE-STATE the chain\'s report splits 1100 staked TRX into 800 for energy and 300 for bandwidth; 3.2 TRX unclaimed shown, not counted');
    console.log('PASS TRON-REWARD a 12.5 TRX vote reward claim is recorded by itself as a Staking reward worth 3.13 USD at the stored price');

    // TRON-STAKE-STATE: an unstake still waiting is staked TRX; a chain that reports more than the
    // history explains is shown, never counted. The owner's answer to a claim stands.
    await post('tron', { accounts: { [staker.address]: { address: staker.address, balance: 912.5 * SUN,
      frozenV2: [{ amount: 300 * SUN }, { type: 'ENERGY', amount: 700 * SUN }],
      unfrozenV2: [{ type: 'ENERGY', unfreeze_amount: 100 * SUN, unfreeze_expire_time: at(500) }, { unfreeze_amount: 5 * SUN, unfreeze_expire_time: at(600) }] } } });
    const later = (await s.addresses.sync(owner, stakerId)).address.staking;
    assert.deepEqual(later.accounts.map((item) => [item.kind, item.state, item.quantity, item.availableAt]), [
      ['energy', 'active', '700.000000', null],
      ['bandwidth', 'active', '300.000000', null],
      ['unstaking', 'deactivating', '100.000000', new Date(at(500)).toISOString()],
      ['unstaking', 'deactivating', '5.000000', new Date(at(600)).toISOString()],
    ]);
    assert.deepEqual([later.quantity, later.reportedQuantity, later.unclaimedRewards], ['1100.000000', '1105.000000', '3.200000']);
    console.log('PASS TRON-STAKE-STATE unstakes waiting their 14 days list with their dates; 1105 reported against 1100 explained is shown, the balance keeps the history');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new TrackTronWallets1793600000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS TRON-MIGRATION fresh 51 applies once; the Tron migration refuses down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
