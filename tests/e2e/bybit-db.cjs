'use strict';

// Real PostgreSQL acceptance for sync-bybit-account (M22). Only Bybit and Esplora are
// synthetic: requests leave through HTTPS_PROXY to the providers.cjs stub, which checks every
// Bybit signature itself. Keys, user IDs, hashes and amounts are synthetic.
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
const { BybitClient } = require(`${dist}/wallet-addresses/bybit-client.js`);
const { BybitKeyBox } = require(`${dist}/wallet-addresses/bybit-key-box.js`);
const { BybitSyncAdapter } = require(`${dist}/wallet-addresses/bybit-sync.adapter.js`);
const { SyncBybitAccount1793300000000 } = require(`${dist}/migrations/1793300000000-SyncBybitAccount.js`);
const { ReadBybitEarn1794000000000 } = require(`${dist}/migrations/1794000000000-ReadBybitEarn.js`);
const { ReadBybitConverts1794400000000 } = require(`${dist}/migrations/1794400000000-ReadBybitConverts.js`);
const { PriceBybitCoins1794500000000 } = require(`${dist}/migrations/1794500000000-PriceBybitCoins.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_bybit_e2e';
const control = 'http://providers:8080/__control';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const DAY = 86_400_000;
const started = Date.now();
const ago = (ms) => started - ms;

// Synthetic keys: what Bybit says of each, as /v5/user/query-api answers.
const uid = 123456789;
const info = (overrides = {}) => ({ id: '100001', note: 'synthetic', readOnly: 1, secret: '', type: 1,
  permissions: { ContractTrade: [], Spot: [], Wallet: [], Options: [], Derivatives: [], Exchange: [], Earn: [] },
  ips: ['*'], deadlineDay: 90, expiredAt: '2027-01-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z',
  unified: 0, uta: 1, userID: uid, inviterID: 0, vipLevel: 'No VIP', mktMakerLevel: '0', affiliateID: 0,
  rsaPublicKey: '', isMaster: true, parentUid: '0', kycLevel: 'LEVEL_DEFAULT', kycRegion: '', ...overrides });
const key = (apiKey, overrides) => ({ apiKey, apiSecret: `${apiKey}Secret0000000000`, info: info(overrides) });
const readOnly = key('AcceptanceReadOnly01');
const replacement = key('AcceptanceReadOnly02', { ips: ['192.0.2.10'], expiredAt: '' });
const refused = [
  [key('AcceptanceTrading001', { readOnly: 0, permissions: { Spot: ['SpotTrade'], Wallet: [] } }), /can trade or withdraw/],
  [key('AcceptanceWithdraw01', { permissions: { Wallet: ['AccountTransfer', 'Withdraw'] } }), /can trade or withdraw/],
  [key('AcceptanceClassic001', { uta: 0 }), /classic Bybit account/],
  [key('AcceptanceSubAcct001', { isMaster: false }), /sub-account/],
];
const unknownKey = { apiKey: 'AcceptanceUnknown001', apiSecret: 'AcceptanceUnknown001Secret000000' };

// The owner's cold Bitcoin wallet: a synthetic base58check address. It receives 1 BTC (R) and
// sends 0.5 BTC to Bybit (H) with 0.4999 BTC change back and a 0.0001 BTC fee.
const cold = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';
const outside = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const bybitDepositAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const txid = (n) => sha256(`ct-e2e-bybit-tx:${n}`);
const chain = [
  { txid: txid(1), height: 800010, inputs: [[outside, 100_010_000]], outputs: [[cold, 100_000_000]], fee: 10_000 },
  { txid: txid(2), height: 800020, inputs: [[cold, 100_000_000]], outputs: [[bybitDepositAddress, 50_000_000], [cold, 49_990_000]], fee: 10_000 },
];

// Bybit's records, each { at, row } exactly as Bybit lists it.
const T0 = ago(20 * DAY);
const T1 = ago(10 * DAY);
const T2 = ago(5 * DAY);
const fill = { symbol: 'BTCUSDT', orderId: '1000000000000000001', orderLinkId: '', side: 'Buy', orderPrice: '65000',
  orderQty: '0.01', leavesQty: '0', createType: 'CreateByUser', orderType: 'Limit', stopOrderType: '', execFee: '0.00001',
  execId: '2100000000000000001', execPrice: '65000', execQty: '0.01', execType: 'Trade', execValue: '650',
  execTime: String(T1), feeCurrency: 'BTC', isMaker: false, feeRate: '0.001', tradeIv: '', markIv: '', markPrice: '',
  indexPrice: '', underlyingPrice: '', blockTradeId: '', closedSize: '', seq: 1, extraFees: '' };
const executions = [
  { at: T1, row: fill },
  // Neither coin can be recorded (a one-letter ticker, fiat): nothing is stored.
  { at: T1 + 60_000, row: { ...fill, symbol: 'SEUR', execId: '2100000000000000002', execTime: String(T1 + 60_000), feeCurrency: 'S' } },
];
const deposit = (at, overrides) => ({ at, row: { id: '', coin: 'USDT', chain: 'ETH', amount: '1000', txID: `0x${txid(10)}`,
  status: 3, toAddress: 'synthetic-deposit-address', tag: '', depositFee: '', successAt: String(at), confirmations: '64',
  txIndex: '0', blockHash: '', batchReleaseLimit: '-1', depositType: '0', fromAddress: '', ...overrides } });
const usdtDeposit = deposit(T0, {});
const btcDeposit = deposit(T2, { coin: 'BTC', chain: 'BTC', amount: '0.5', txID: txid(2) });
const pendingAt = ago(2 * 60 * 60_000);
const pendingDeposit = deposit(pendingAt, { coin: 'BTC', chain: 'BTC', amount: '0.2', txID: txid(3), status: 1, successAt: '' });
// From another Bybit user, long ago: an older window of the list.
const internalDeposit = { at: ago(400 * DAY), row: { id: '9000001', type: 1, coin: 'USDT', amount: '100', status: 2,
  address: 'synthetic@example.invalid', createdTime: String(Math.floor(ago(400 * DAY) / 1000)), txID: '' } };
// To a chain the app does not track: Bybit names it by its own ID.
const withdrawal = { at: ago(3 * DAY), row: { coin: 'USDT', chain: 'TRX', amount: '50', txID: 'c'.repeat(64), status: 'success',
  toAddress: 'synthetic-trx-address', tag: '', withdrawFee: '1', createTime: String(ago(3 * DAY)), updateTime: String(ago(3 * DAY)),
  withdrawId: '7000001', withdrawType: 0 } };
// What Bybit holds: 200 USDT more than the records, the P2P purchase the API never lists.
const balances = {
  FUND: [{ coin: 'USDT', walletBalance: '349', transferBalance: '349', bonus: '' }, { coin: 'BTC', walletBalance: '0.2', transferBalance: '0.2', bonus: '' }],
  UNIFIED: [{ coin: 'USDT', walletBalance: '250', transferBalance: '250', bonus: '' }, { coin: 'BTC', walletBalance: '0.50999', transferBalance: '0.50999', bonus: '' },
    { coin: 'S', walletBalance: '5', transferBalance: '5', bonus: '' }],
};

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function bybitUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => new URL(url)).filter(({ hostname }) => hostname === 'api.bybit.com');
}
async function bybitState() {
  const response = await fetch(`${control}/bybit`);
  assert.equal(response.status, 200);
  return response.json();
}
async function newRequests(action) {
  const before = (await bybitUrls()).length;
  const result = await action();
  return { result, urls: (await bybitUrls()).slice(before) };
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
    assert.match(name, /^capital_tracker_bybit_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, [`${dist}/migrate.js`], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function refusal(action, status, message) {
  await assert.rejects(async () => action(), (error) => error?.getStatus?.() === status
    && (message === undefined || message.test(error.message)));
}
function services(db) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const client = new BybitClient({ pauseMs: 0 });
  const box = new BybitKeyBox(new ConfigService(process.env));
  const adapters = [new BitcoinSyncAdapter(db, new EsploraClient({ pauseMs: 0 })), new BybitSyncAdapter(db, client, box)];
  const scheduler = new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: 'false' }), adapters, classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    operations: make('operation-list.service', 'OperationListService'),
    trades,
    classifications,
    addresses: new WalletAddressService(db, scheduler, client, box),
  };
}
async function syncUntilComplete(s, owner, wallet) {
  const passes = [];
  for (let pass = 0; pass < 12; pass++) {
    const step = await newRequests(() => s.addresses.sync(owner, wallet));
    passes.push(step);
    if (step.result.outcome !== 'partial') break;
  }
  return passes;
}
async function held(db, owner, accountId) {
  const { readValuationInputs, accountsAt } = require(`${dist}/accounting/portfolio-valuation.service.js`);
  const { canonicalDecimalToAtoms, formatAtoms } = require(`${dist}/accounting/money.js`);
  const symbols = new Map((await db.query('SELECT id, symbol FROM accounting_instruments WHERE "ownerId"=$1', [owner]))
    .map((row) => [row.id, row.symbol]));
  const inputs = await db.transaction('REPEATABLE READ', (manager) => readValuationInputs(manager, owner));
  const account = accountsAt(inputs, new Date().toISOString())
    .find((item) => item.accountId === accountId);
  const totals = new Map();
  for (const lot of account?.lots ?? []) {
    const symbol = symbols.get(lot.instrumentId);
    totals.set(symbol, (totals.get(symbol) ?? 0n) + canonicalDecimalToAtoms(lot.quantity));
  }
  return Object.fromEntries([...totals].filter(([, value]) => value !== 0n).sort()
    .map(([symbol, value]) => [symbol, formatAtoms(value)]));
}
const legsOf = (db, walletId) => db.query(`SELECT txid, asset, "blockHeight", "blockHash", "receivedUnits"::text AS received,
  "sentUnits"::text AS sent, "feeUnits"::text AS fee, direction, raw FROM wallet_address_transactions
  WHERE "addressId"=$1 ORDER BY "blockTime", txid`, [walletId]);

async function main() {
  for (const [name, value] of Object.entries(settings)) assert.equal(process.env[name], value, 'Exact synthetic environment required');
  assert.ok(process.env.MFA_KEY_FILE && process.env.MFA_KEY_ID, 'Synthetic server key must be mounted');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 53/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('bybit-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('bybit-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const account = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const exchange = await account('Bybit');
    const coldAccount = await account('Cold storage');

    // BYBIT-KEY: Bybit is asked about the key before anything is stored; a key that can trade
    // or withdraw, a classic account, a sub-account and a key Bybit does not know are refused.
    await post('bybit', { keys: [readOnly, replacement, ...refused.map(([item]) => item)] });
    for (const [item, message] of refused) {
      await refusal(() => s.addresses.register(owner, { network: 'bybit', apiKey: item.apiKey, apiSecret: item.apiSecret, accountId: exchange }), 422, message);
    }
    await refusal(() => s.addresses.register(owner, { network: 'bybit', ...unknownKey }), 422, /did not accept this API key/);
    await refusal(() => s.addresses.register(owner, { network: 'bybit', apiKey: readOnly.apiKey, apiSecret: `${readOnly.apiSecret}x` }), 422, /did not accept/);
    await refusal(() => s.addresses.register(owner, { network: 'bybit', address: String(uid) }), 400);
    assert.deepEqual(await db.query('SELECT * FROM bybit_accounts'), []);
    assert.deepEqual(await db.query("SELECT * FROM wallet_addresses WHERE network='bybit'"), []);
    const first = await s.addresses.register(owner, { network: 'bybit', apiKey: ` ${readOnly.apiKey} `, apiSecret: readOnly.apiSecret, accountId: exchange, label: 'Bybit' });
    assert.equal(first.created, true);
    const wallet = first.value.id;
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label, first.value.sync.state, first.value.balances],
      ['bybit', String(uid), exchange, 'Bybit', 'never', null]);
    assert.deepEqual({ ...first.value.exchange, historyFrom: undefined },
      { keyHint: 'ly01', ipBound: false, keyExpiresAt: '2027-01-01T00:00:00.000Z', reportedAt: null, untracked: [], historyFrom: undefined,
        earnAllowed: null, earn: null, convertAllowed: null });
    // The secret and the key are stored encrypted only, and never returned.
    const storedRows = JSON.stringify(await db.query('SELECT * FROM bybit_accounts')) + JSON.stringify(await db.query('SELECT * FROM wallet_addresses'));
    const listed = JSON.stringify(await s.addresses.list(owner));
    for (const text of [storedRows, listed, JSON.stringify(first)]) {
      assert.ok(!text.includes(readOnly.apiSecret) && !text.includes(readOnly.apiKey), 'Key and secret never stored or shown in clear');
    }
    const [sealed] = await db.query('SELECT credentials FROM bybit_accounts WHERE "walletId"=$1', [wallet]);
    assert.deepEqual(Object.keys(sealed.credentials).sort(), ['ciphertext', 'keyId', 'nonce', 'tag', 'v']);
    assert.equal(sealed.credentials.keyId, process.env.MFA_KEY_ID);
    assert.equal((await bybitState()).badSignatures, 1, 'Only the mistyped secret was signed wrongly');
    console.log('PASS BYBIT-KEY trading, withdrawal, classic and sub-account keys get 422 before anything is stored; an unknown key or wrong secret too; a read-only key is stored encrypted (AES-GCM envelope), shown as …ly01 only');

    // BYBIT-TRADES: the first read covers two years in Bybit's windows over several bounded
    // passes. 0.01 BTC bought for 650 USDT with a 0.00001 BTC fee counts provisionally until
    // the account's records hold the USDT it spent.
    await post('bybit', { executions, deposits: [usdtDeposit, btcDeposit, pendingDeposit], internalDeposits: [internalDeposit],
      withdrawals: [withdrawal], balances, pageSize: 1 });
    const passes = await syncUntilComplete(s, owner, wallet);
    const last = passes.at(-1).result;
    assert.deepEqual([last.outcome, last.reason], ['complete', null]);
    assert.ok(passes.length >= 4, 'Two years of windows take several passes');
    assert.ok(passes.slice(0, -1).every(({ result }) => result.outcome === 'partial' && result.address.sync.state !== 'complete'));
    assert.ok(passes.every(({ urls }) => urls.length <= 40), 'At most 40 requests a pass');
    const urls = passes.flatMap(({ urls: list }) => list);
    const windows = (path) => urls.filter((url) => url.pathname === path && !url.searchParams.has('cursor'))
      .map((url) => [Number(url.searchParams.get('startTime')), Number(url.searchParams.get('endTime'))]);
    for (const [path, longest] of [['/v5/execution/list', 7 * DAY], ['/v5/asset/deposit/query-record', 30 * DAY],
      ['/v5/asset/deposit/query-internal-record', 30 * DAY], ['/v5/asset/withdraw/query-record', 30 * DAY]]) {
      const read = windows(path);
      assert.ok(read.length > 1, `${path} read in windows`);
      assert.ok(read.every(([from, to]) => to - from < longest), `${path} windows within Bybit's limit`);
      // No gap from two years back to now; a window is read again while a record in it is
      // still to settle, and every pass reads the last hour again.
      let covered = read[0][1];
      for (const [from, to] of read.slice(1)) {
        assert.ok(from <= covered, `${path} leaves no gap`);
        covered = Math.max(covered, to);
      }
      assert.ok(read[0][0] <= ago(728 * DAY) && covered >= ago(60_000));
    }
    assert.ok(urls.some((url) => url.search.endsWith('&cursor=1%3A1')), 'A second page is asked with the cursor exactly as given');
    assert.equal((await bybitState()).badSignatures, 1, 'Every sync request was signed correctly');
    for (const url of urls) assert.ok(!url.href.includes(readOnly.apiSecret));
    const stored = await legsOf(db, wallet);
    assert.deepEqual(stored.map((row) => [row.txid, row.asset, row.received, row.sent, row.fee, row.direction, row.blockHeight, row.blockHash]), [
      ['bybit-deposit-internal-9000001', 'USDT', '100000000000000000000', '0', '0', 'in', 0, null],
      [txid(10), 'USDT', '1000000000000000000000', '0', '0', 'in', 0, null],
      ['bybit-trade-2100000000000000001', 'BTC', '9990000000000000', '0', '0', 'in', 0, null],
      [txid(2), 'BTC', '500000000000000000', '0', '0', 'in', 0, null],
      ['bybit-withdrawal-7000001', 'USDT', '0', '51000000000000000000', '1000000000000000000', 'out', 0, null],
    ]);
    for (const row of stored) assert.equal(row.raw.txid, row.txid, 'Raw Bybit record is retained');
    assert.deepEqual(stored[2].raw.trade, { side: 'buy', base: 'BTC', quote: 'USDT', price: '65000', quantity: '0.01', value: '650', fee: '0.00001', feeCoin: 'BTC' });
    assert.equal(stored[2].raw.quoteUnits, '-650000000000000000000');
    // CLS-PROVISIONAL: nothing answered yet; the account follows Bybit's records.
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.50999', USDT: '399' });
    const heads = await db.query('SELECT txid FROM chain_transaction_classifications WHERE "addressId"=$1', [wallet]);
    assert.deepEqual(heads, [], 'The buy is not recognised while the records hold no USDT');
    // BYBIT-TRADES: answering the fill "Buy" in USDT is refused while the records hold no USDT; it
    // would enter the 650 as new money while the unanswered deposits still count.
    await refusal(() => s.classifications.classify(owner, wallet, 'bybit-trade-2100000000000000001', { requestId: randomUUID(),
      hidden: false, expectedVersion: 0, classification: { type: 'buy', currency: 'USDT', amount: '649.35', fee: '0.65' } }), 409,
      /do not hold the USDT/);
    assert.deepEqual(await db.query('SELECT txid FROM chain_transaction_classifications WHERE "addressId"=$1', [wallet]), [],
      'The refused answer left nothing behind');
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.50999', USDT: '399' });
    console.log(`PASS BYBIT-SYNC two years read in ${passes.length} passes of at most 40 signed requests, in windows Bybit accepts (7 days of trades, under 30 of records), pages by raw cursor; 5 legs; untracked pair and pending deposit left out`);
    console.log('PASS CLS-PROVISIONAL before any answer the Bybit account holds 0.50999 BTC and 399 USDT (100 + 1000 − 650 − 51)');

    // The owner answers the USDT deposit; the buy is then recognised without asking.
    await s.classifications.classify(owner, wallet, txid(10), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '1000' } });
    const recognised = await db.query(`SELECT v.type, v.automatic FROM chain_transaction_classification_versions v
      WHERE v."addressId"=$1 AND v.txid='bybit-trade-2100000000000000001'`, [wallet]);
    assert.equal(recognised.length, 1);
    assert.deepEqual([recognised[0].type, recognised[0].automatic], ['buy', true]);
    const listOf = async () => (await s.operations.read(owner, {}, new Date())).operations;
    const buys = (await listOf()).filter((item) => item.chain?.txid === 'bybit-trade-2100000000000000001');
    assert.equal(buys.length, 1);
    const [buy] = buys;
    assert.deepEqual([buy.type, buy.status, buy.asset.symbol, buy.quantity, buy.account?.id, buy.classification?.automatic],
      ['buy', 'recorded', 'BTC', '0.00999', exchange, true]);
    assert.equal(buy.settlement?.asset?.symbol ?? buy.settlement?.currency, 'USDT');
    // 649.35 for 0.00999 BTC is 65,000 USDT each; the fee 0.00001 BTC is 0.65 USDT.
    assert.equal(buy.valueUsd, '649.35');
    assert.equal(buy.feeUsd, '0.65');
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.50999', USDT: '399' });
    const again = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([again.result.outcome, again.result.imported], ['complete', 0]);
    assert.ok(again.urls.length <= 12, 'A synced account reads only its last windows again');
    assert.equal((await listOf()).filter((item) => item.chain?.txid === 'bybit-trade-2100000000000000001').length, 1);
    assert.equal((await legsOf(db, wallet)).length, 5);
    console.log('PASS BYBIT-TRADES once the USDT deposit is answered, the fill is one automatic Buy of 0.00999 BTC at 65,000 USDT (649.35 + 0.65 fee) in the Bybit account; a second sync adds nothing');

    // BYBIT-DEPOSIT (D7): the cold wallet's send and Bybit's deposit with the same hash form
    // one transfer once the cold wallet's coins have a cost.
    await post('bitcoin-chain', { transactions: chain });
    const coldWallet = (await s.addresses.register(owner, { network: 'bitcoin', address: cold, accountId: coldAccount, label: 'Cold BTC' })).value.id;
    assert.equal((await s.addresses.sync(owner, coldWallet)).imported, 2);
    await s.classifications.classify(owner, coldWallet, txid(1), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '60000' } });
    const links = await db.query(`SELECT "addressId", txid, type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [txid(2)]);
    assert.equal(links.length, 2, 'Both sides of the deposit are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const transfer = (await listOf()).filter((item) => item.chain?.txid === txid(2));
    assert.equal(transfer.length, 1, 'A linked pair is listed once');
    assert.deepEqual([transfer[0].type, transfer[0].asset.symbol, transfer[0].quantity, transfer[0].fee?.quantity],
      ['transfer', 'BTC', '0.5', '0.0001']);
    assert.deepEqual(await held(db, owner, coldAccount), { BTC: '0.4999' });
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.50999', USDT: '399' });
    console.log('PASS BYBIT-DEPOSIT 0.5001 BTC leaving the cold wallet and Bybit\'s 0.5 BTC deposit with the same hash link into one transfer with a 0.0001 BTC fee');

    // A deposit still confirming holds the list back: it is stored when Bybit credits it.
    const [{ depositsReadTo }] = await db.query('SELECT "depositsReadTo" FROM bybit_accounts WHERE "walletId"=$1', [wallet]);
    assert.ok(depositsReadTo.getTime() <= pendingAt, 'The deposit list is read again from the pending deposit');
    await post('bybit', { deposits: [usdtDeposit, btcDeposit, { ...pendingDeposit, row: { ...pendingDeposit.row, status: 3, successAt: String(pendingAt) } }] });
    const credited = await s.addresses.sync(owner, wallet);
    assert.deepEqual([credited.outcome, credited.imported], ['complete', 1]);
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.70999', USDT: '399' });
    console.log('PASS BYBIT-PENDING a confirming deposit holds the list\'s cursor and is stored once credited');

    // BYBIT-GAPS: the balances Bybit reports stand beside the records; the P2P purchase the API
    // never lists shows as 200 USDT more on Bybit until it is entered by hand.
    const summary = credited.address;
    assert.deepEqual(summary.balances, [
      { symbol: 'BTC', quantity: '0.70999' }, { symbol: 'ETH', quantity: '0' }, { symbol: 'SOL', quantity: '0' },
      { symbol: 'USDT', quantity: '599' }, { symbol: 'USDC', quantity: '0' },
    ]);
    assert.deepEqual(summary.exchange.untracked, [{ symbol: 'S', quantity: '5' }]);
    assert.ok(Date.parse(summary.exchange.reportedAt) >= started);
    assert.equal(summary.sync.state, 'complete');
    const usdt = (await db.query("SELECT id FROM accounting_instruments WHERE \"ownerId\"=$1 AND symbol='USDT'", [owner]))[0].id;
    const journal = await s.trades.getJournal(owner, exchange);
    await s.trades.create(owner, exchange, { requestId: randomUUID(), expectedJournalRevision: journal.journal.journalRevision,
      instrumentId: usdt, side: 'buy', occurredAt: new Date(ago(DAY)).toISOString(), orderWithinTimestamp: 0,
      quantity: '200', grossUsd: '200', feeUsd: '0' });
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.70999', USDT: '599' });
    console.log('PASS BYBIT-GAPS Bybit reports 599 USDT against 399 recorded; the 200 USDT P2P purchase entered by hand closes the gap; 5 S shown as untracked (BYBIT-ANY-COIN: a one-letter ticker cannot be recorded)');

    // A key Bybit stops accepting fails the sync with its reason; a new key replaces it and
    // keeps what was read.
    await post('bybit', { fault: { onRequest: 1, retCode: 33004 } });
    const expired = await s.addresses.sync(owner, wallet);
    assert.deepEqual([expired.outcome, expired.reason], ['provider_error', 'key_rejected']);
    assert.match(expired.address.sync.errorMessage, /^Bybit did not accept the API key: .*Add the account again with a new read-only key\. Bybit answered: Synthetic refusal \(code 33004\)\.$/);
    const cursorsBefore = await db.query('SELECT "tradesReadTo", "depositsReadTo", "internalReadTo", "withdrawalsReadTo" FROM bybit_accounts');
    const renewed = await s.addresses.register(owner, { network: 'bybit', apiKey: replacement.apiKey, apiSecret: replacement.apiSecret });
    assert.deepEqual([renewed.created, renewed.value.id, renewed.value.accountId], [false, wallet, exchange]);
    assert.deepEqual([renewed.value.exchange.keyHint, renewed.value.exchange.ipBound, renewed.value.exchange.keyExpiresAt], ['ly02', true, null]);
    assert.deepEqual(await db.query('SELECT "tradesReadTo", "depositsReadTo", "internalReadTo", "withdrawalsReadTo" FROM bybit_accounts'), cursorsBefore);
    const [{ nextRunAt }] = await db.query("SELECT \"nextRunAt\" FROM sync_sources WHERE key = 'wallet:' || $1", [wallet]);
    assert.ok(nextRunAt.getTime() <= Date.now(), 'A new key is tried at the next tick');
    const resumed = await s.addresses.sync(owner, wallet);
    assert.deepEqual([resumed.outcome, resumed.imported], ['complete', 0]);
    await post('bybit', { fault: { onRequest: 1, retCode: 10006 } });
    assert.deepEqual((await s.addresses.sync(owner, wallet)).reason, 'rate_limited');
    console.log('PASS BYBIT-KEY-RENEW a key Bybit refuses fails the sync as key_rejected with Bybit\'s words; adding the account with a new key keeps its records and cursors; a rate limit is its own reason');

    // BYBIT-EARN: a key without the Earn permission reads no Earn and says so.
    const noEarn = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([noEarn.result.outcome, noEarn.result.address.exchange.earnAllowed, noEarn.result.address.exchange.earn],
      ['complete', false, null]);
    assert.ok(!noEarn.urls.some((url) => url.pathname.startsWith('/v5/earn/')), 'No Earn request without the permission');
    // The owner ticks Earn on the same key in Bybit and moves 300 USDT and 0.1 BTC into Earn,
    // which pays 0.5 USDT and 0.0001 BTC of yield into the funding account. Bybit lists three
    // months of yield; one older, one still pending and one in an untracked coin never count.
    const earnKey = { ...replacement, info: { ...replacement.info, permissions: { ...replacement.info.permissions, Earn: ['Earn'] } } };
    const paid = (category, n, at, coin, amount, status = 'Success') => ({ at, row: { productId: category === 'OnChain' ? '8' : '428', coin,
      id: String(1002000 + n), amount, yieldType: 'Normal', distributionMode: 'Auto', effectiveStakingAmount: '300', orderId: '', status,
      createdAt: String(at) } });
    const yieldAt = ago(30 * DAY);
    await post('bybit', {
      keys: [readOnly, earnKey],
      balances: {
        FUND: [{ coin: 'USDT', walletBalance: '49.5', transferBalance: '49.5', bonus: '' }, { coin: 'BTC', walletBalance: '0.1001', transferBalance: '0.1001', bonus: '' }],
        UNIFIED: balances.UNIFIED,
      },
      earn: {
        FlexibleSaving: [{ coin: 'USDT', productId: '428', amount: '300', totalPnl: '', claimableYield: '0.01' },
          { coin: 'USDC', productId: '429', amount: '0', totalPnl: '', claimableYield: '0' }],
        OnChain: [{ coin: 'BTC', productId: '8', amount: '0.1', totalPnl: '0', claimableYield: '', id: '326', status: 'Active' }],
        fixed: [{ positionId: '4064', productId: '724', category: 'FixedTermSaving', coin: 'W', amount: '10', status: 'Active' }],
      },
      flexibleYield: [paid('FlexibleSaving', 1, yieldAt, 'USDT', '0.5'), paid('FlexibleSaving', 2, ago(100 * DAY), 'USDT', '9'),
        paid('FlexibleSaving', 3, ago(2 * DAY), 'USDT', '0.25', 'Pending'), paid('FlexibleSaving', 4, ago(20 * DAY), 'W', '1')],
      onchainYield: [paid('OnChain', 5, ago(10 * DAY), 'BTC', '0.0001')],
    });
    const earnPasses = await syncUntilComplete(s, owner, wallet);
    const earned = earnPasses.at(-1).result;
    assert.deepEqual([earned.outcome, earned.reason], ['complete', null]);
    assert.equal(earnPasses.reduce((sum, pass) => sum + pass.result.imported, 0), 2);
    const earnUrls = earnPasses.flatMap(({ urls: list }) => list);
    assert.ok(earnPasses.every(({ urls: list }) => list.length <= 40), 'At most 40 requests a pass');
    for (const category of ['FlexibleSaving', 'OnChain']) {
      const read = earnUrls.filter((url) => url.pathname === '/v5/earn/yield' && url.searchParams.get('category') === category)
        .map((url) => [Number(url.searchParams.get('startTime')), Number(url.searchParams.get('endTime'))]);
      assert.ok(read.length >= 13, `${category} yield read in seven-day windows`);
      assert.ok(read.every(([from, to]) => to - from <= 7 * DAY), `${category} windows within Bybit's limit`);
      assert.ok(read[0][0] >= ago(90 * DAY) && read[0][0] <= ago(88 * DAY), `${category} starts three months back`);
      assert.ok(read.at(-1)[1] >= ago(60_000), `${category} read up to now`);
    }
    for (const path of ['/v5/earn/position', '/v5/earn/fixed-term/position']) assert.ok(earnUrls.some((url) => url.pathname === path), path);
    const earnLegs = (await legsOf(db, wallet)).filter((row) => row.txid.startsWith('bybit-earn-'));
    assert.deepEqual(earnLegs.map((row) => [row.txid, row.asset, row.received, row.sent, row.direction, row.raw.product]), [
      ['bybit-earn-flexible-1002001', 'USDT', '500000000000000000', '0', 'in', 'flexible'],
      ['bybit-earn-onchain-1002005', 'BTC', '100000000000000', '0', 'in', 'onchain'],
    ]);
    // Each paid yield is recorded as a staking reward without asking.
    const rewards = await db.query(`SELECT txid, type, automatic FROM chain_transaction_classification_versions
      WHERE "addressId"=$1 AND txid LIKE 'bybit-earn-%' ORDER BY txid`, [wallet]);
    assert.deepEqual(rewards.map((row) => [row.txid, row.type, row.automatic]), [
      ['bybit-earn-flexible-1002001', 'staking-reward', true],
      ['bybit-earn-onchain-1002005', 'staking-reward', true],
    ]);
    const listedRewards = (await listOf()).filter((item) => item.chain?.txid?.startsWith('bybit-earn-'));
    assert.deepEqual(listedRewards.map((item) => [item.type, item.status, item.asset.symbol, item.quantity, item.account?.id,
      item.classification?.automatic]).sort(), [
      ['staking-reward', 'recorded', 'BTC', '0.0001', exchange, true],
      ['staking-reward', 'recorded', 'USDT', '0.5', exchange, true],
    ]);
    // BYBIT-GAPS with Earn: what Bybit holds in Earn counts; the records match it.
    assert.deepEqual(earned.address.balances, [
      { symbol: 'BTC', quantity: '0.71009' }, { symbol: 'ETH', quantity: '0' }, { symbol: 'SOL', quantity: '0' },
      { symbol: 'USDT', quantity: '599.5' }, { symbol: 'USDC', quantity: '0' },
    ]);
    assert.deepEqual([earned.address.exchange.earnAllowed, earned.address.exchange.earn], [true, [
      { symbol: 'USDT', quantity: '300', product: 'flexible' },
      { symbol: 'BTC', quantity: '0.1', product: 'onchain' },
    ]]);
    assert.deepEqual(earned.address.exchange.untracked, [{ symbol: 'S', quantity: '5' }, { symbol: 'W', quantity: '10' }]);
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.71009', USDT: '599.5' });
    const earnAgain = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([earnAgain.result.outcome, earnAgain.result.imported], ['complete', 0]);
    assert.equal((await legsOf(db, wallet)).filter((row) => row.txid.startsWith('bybit-earn-')).length, 2);
    // Earn turned off again: its positions no longer count and nothing is asked.
    await post('bybit', { keys: [readOnly, replacement] });
    const earnOff = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([earnOff.result.outcome, earnOff.result.address.exchange.earnAllowed, earnOff.result.address.exchange.earn],
      ['complete', false, null]);
    assert.ok(!earnOff.urls.some((url) => url.pathname.startsWith('/v5/earn/')));
    assert.deepEqual(earnOff.result.address.balances.find((item) => item.symbol === 'USDT'), { symbol: 'USDT', quantity: '299.5' });
    console.log(`PASS BYBIT-EARN without the Earn permission nothing of Earn is asked; once ticked on the same key, ${earnPasses.length} passes read three months of yield in seven-day windows: 0.5 USDT and 0.0001 BTC paid become automatic staking rewards (older, pending and untracked yield left out), 300 USDT and 0.1 BTC in Earn count in Bybit's balance, which then matches the records; turned off, Earn no longer counts`);

    // BYBIT-CONVERT: a key without the Exchange History permission reads no converts and says so.
    const noConvert = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([noConvert.result.outcome, noConvert.result.address.exchange.convertAllowed], ['complete', false]);
    assert.ok(!noConvert.urls.some((url) => url.pathname.startsWith('/v5/asset/exchange/')), 'No convert request without the permission');
    // The owner ticks Exchange History on the same key. Bybit lists a convert of 0.01 BTC into
    // 650 USDT, one of 100 USDT into 0.6 SOL, one still processing, one failed and one between
    // two untracked coins; the older coin exchange records add 20 S sold for 10 USDT before
    // converts were listed in full, and one made after that date, which the convert history
    // would list instead.
    const convertKey = { ...replacement, info: { ...replacement.info, permissions: { ...replacement.info.permissions, Exchange: ['ExchangeHistory'] } } };
    const converted = (id, at, fromCoin, fromAmount, toCoin, toAmount, exchangeStatus = 'success') => ({ at, row: { accountType: 'funding',
      exchangeTxId: id, userId: String(uid), fromCoin, fromCoinType: 'crypto', fromAmount, toCoin, toCoinType: 'crypto', toAmount,
      exchangeStatus, extInfo: {}, convertRate: '0', createdAt: String(at) } });
    const exchanged = (id, at, fromCoin, fromAmount, toCoin, toAmount) => ({ at, row: { fromCoin, fromAmount, toCoin, toAmount,
      exchangeRate: '0', createdTime: String(Math.floor(at / 1000)), exchangeTxId: id } });
    await post('bybit', {
      keys: [readOnly, convertKey],
      balances: {
        FUND: [{ coin: 'USDT', walletBalance: '909.5', transferBalance: '909.5', bonus: '' }, { coin: 'BTC', walletBalance: '0.1901', transferBalance: '0.1901', bonus: '' },
          { coin: 'SOL', walletBalance: '0.6', transferBalance: '0.6', bonus: '' }],
        UNIFIED: balances.UNIFIED,
      },
      converts: [converted('5100000000000000000000000001', ago(5 * DAY), 'BTC', '0.01', 'USDT', '650'),
        converted('5100000000000000000000000002', ago(4 * DAY), 'USDT', '100', 'SOL', '0.6'),
        converted('5100000000000000000000000003', ago(60 * 60_000), 'USDT', '50', 'ETH', '0.02', 'processing'),
        converted('5100000000000000000000000004', ago(3 * DAY), 'USDT', '70', 'ETH', '0.03', 'failure'),
        converted('5100000000000000000000000005', ago(2 * DAY), 'S', '3', 'W', '1')],
      coinExchanges: [exchanged('5200000000000000001', Date.UTC(2025, 7, 1), 'S', '20', 'USDT', '10'),
        exchanged('5200000000000000002', ago(30 * DAY), 'USDT', '5', 'ETH', '0.002')],
    });
    const convertPass = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([convertPass.result.outcome, convertPass.result.imported, convertPass.result.address.exchange.convertAllowed],
      ['complete', 3, true]);
    const convertUrls = convertPass.urls.filter((url) => url.pathname.startsWith('/v5/asset/exchange/'));
    assert.deepEqual(convertUrls.map((url) => `${url.pathname}${url.search}`), [
      '/v5/asset/exchange/query-convert-history?index=1&limit=100',
      '/v5/asset/exchange/order-record?limit=50',
    ]);
    const convertLegs = (await legsOf(db, wallet)).filter((row) => row.txid.startsWith('bybit-trade-convert-'));
    assert.deepEqual(convertLegs.map((row) => [row.txid, row.asset, row.received, row.sent, row.direction, row.raw.convert,
      row.raw.trade.side, row.raw.quoteAsset ?? null, row.raw.quoteUnits ?? null]), [
      ['bybit-trade-convert-5200000000000000001', 'USDT', '10000000000000000000', '0', 'in', 'exchange', 'sell', null, null],
      ['bybit-trade-convert-5100000000000000000000000001', 'BTC', '0', '10000000000000000', 'out', 'convert', 'sell', 'USDT', '650000000000000000000'],
      ['bybit-trade-convert-5100000000000000000000000002', 'SOL', '600000000000000000', '0', 'in', 'convert', 'buy', 'USDT', '-100000000000000000000'],
    ]);
    // Converts between USDT and a tracked coin are recognised as a Sell and a Buy without asking.
    const convertAnswers = await db.query(`SELECT txid, type, automatic FROM chain_transaction_classification_versions
      WHERE "addressId"=$1 AND txid LIKE 'bybit-trade-convert-51%' ORDER BY txid`, [wallet]);
    assert.deepEqual(convertAnswers.map((row) => [row.txid, row.type, row.automatic]), [
      ['bybit-trade-convert-5100000000000000000000000001', 'sell', true],
      ['bybit-trade-convert-5100000000000000000000000002', 'buy', true],
    ]);
    // BYBIT-GAPS: the converts close the difference; Bybit's balance matches the records.
    assert.deepEqual(convertPass.result.address.balances, [
      { symbol: 'BTC', quantity: '0.70009' }, { symbol: 'ETH', quantity: '0' }, { symbol: 'SOL', quantity: '0.6' },
      { symbol: 'USDT', quantity: '1159.5' }, { symbol: 'USDC', quantity: '0' },
    ]);
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.70009', SOL: '0.6', USDT: '1159.5' });
    const convertAgain = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([convertAgain.result.outcome, convertAgain.result.imported], ['complete', 0]);
    // Permission withdrawn again: nothing is asked; what was read stays.
    await post('bybit', { keys: [readOnly, replacement] });
    const convertOff = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([convertOff.result.outcome, convertOff.result.address.exchange.convertAllowed], ['complete', false]);
    assert.ok(!convertOff.urls.some((url) => url.pathname.startsWith('/v5/asset/exchange/')));
    assert.equal((await legsOf(db, wallet)).filter((row) => row.txid.startsWith('bybit-trade-convert-')).length, 3);
    console.log('PASS BYBIT-CONVERT without Exchange History no convert is asked; once ticked on the same key, a convert into USDT is a Sell and one from USDT a Buy, recorded without asking; processing, failed and untracked converts are left out; older coin exchanges count, newer ones come from the convert history only; Bybit\'s balance then matches the records');

    // BYBIT-ANY-COIN: an account read while the app tracked only BTC, ETH, SOL, USDT and USDC.
    // It stored 15 XRP bought for 30 USDT as the 30 USDT spent, and 8 DOGE sold for 4 USDT as
    // the 4 USDT received, which the owner answered as Other; 40 TON and 7 NOPE deposited long
    // ago were left out. Bybit now reports all of them; it lists XRP and TON against USDT only.
    const [{ everyCoinAt }] = await db.query('SELECT "everyCoinAt" FROM bybit_accounts WHERE "walletId"=$1', [wallet]);
    assert.ok(everyCoinAt instanceof Date, 'An account added now counts every coin from the start');
    const legacyAt = ago(6 * DAY);
    const xrpFill = { ...fill, symbol: 'XRPUSDT', execId: '2100000000000000101', execPrice: '2', execQty: '15', execValue: '30',
      execFee: '0', feeCurrency: 'XRP', execTime: String(legacyAt) };
    const dogeFill = { ...fill, symbol: 'DOGEUSDT', side: 'Sell', execId: '2100000000000000102', execPrice: '0.5', execQty: '8',
      execValue: '4', execFee: '0', feeCurrency: 'USDT', execTime: String(legacyAt + 60_000) };
    const legacy = (row, side, base, units) => {
      const id = `bybit-trade-${row.execId}`;
      const raw = { kind: 'trade', trade: { side, base, quote: 'USDT', price: row.execPrice, quantity: row.execQty, value: row.execValue,
        fee: row.execFee, feeCoin: row.feeCurrency }, record: row, txid: id };
      return db.query(`INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw,asset)
        VALUES ($1,$2,$3,0,$4,$5,$6,0,$7,$8,'USDT')`, [owner, wallet, id, new Date(Number(row.execTime)),
        units > 0n ? String(units) : '0', units < 0n ? String(-units) : '0', units > 0n ? 'in' : 'out', JSON.stringify(raw)]);
    };
    const E18 = 10n ** 18n;
    await legacy(xrpFill, 'buy', 'XRP', -30n * E18);
    await legacy(dogeFill, 'sell', 'DOGE', 4n * E18);
    await s.classifications.classify(owner, wallet, 'bybit-trade-2100000000000000102', { requestId: randomUUID(), hidden: false,
      expectedVersion: 0, classification: { type: 'other' } });
    await db.query('UPDATE bybit_accounts SET "everyCoinAt"=NULL WHERE "walletId"=$1', [wallet]);
    const legsBefore = (await legsOf(db, wallet)).length;
    const oldDeposit = (at, coin, amount, n) => deposit(at, { coin, chain: coin, amount, txID: txid(n) });
    await post('bybit', {
      append: true,
      executions: [{ at: legacyAt, row: xrpFill }, { at: legacyAt + 60_000, row: dogeFill }],
      deposits: [oldDeposit(ago(100 * DAY), 'TON', '40', 20), oldDeposit(ago(200 * DAY), 'NOPE', '7', 21)],
      balances: {
        FUND: [{ coin: 'USDT', walletBalance: '909.5', transferBalance: '909.5', bonus: '' }, { coin: 'BTC', walletBalance: '0.1901', transferBalance: '0.1901', bonus: '' },
          { coin: 'SOL', walletBalance: '0.6', transferBalance: '0.6', bonus: '' }, { coin: 'TON', walletBalance: '40', transferBalance: '40', bonus: '' }],
        UNIFIED: [...balances.UNIFIED, { coin: 'XRP', walletBalance: '15', transferBalance: '15', bonus: '' },
          { coin: 'NOPE', walletBalance: '7', transferBalance: '7', bonus: '' }],
      },
      markets: { XRP: '2.5', TON: '3' },
    });
    const everyPasses = await syncUntilComplete(s, owner, wallet);
    const counted = everyPasses.at(-1).result;
    assert.equal(counted.outcome, 'complete');
    assert.ok(everyPasses.length > 1, 'The whole history is read again');
    const legsAfter = await legsOf(db, wallet);
    assert.equal(legsAfter.length, legsBefore + 2, 'Only the two coins left out are added; nothing is stored twice');
    const legOf = (id) => legsAfter.find((row) => row.txid === id);
    const xrpLeg = legOf('bybit-trade-2100000000000000101');
    assert.deepEqual([xrpLeg.asset, xrpLeg.received, xrpLeg.sent, xrpLeg.direction, xrpLeg.raw.quoteAsset, xrpLeg.raw.quoteUnits,
      xrpLeg.raw.record.execId, xrpLeg.raw.txid], ['XRP', '15000000000000000000', '0', 'in', 'USDT', '-30000000000000000000',
      '2100000000000000101', 'bybit-trade-2100000000000000101']);
    const dogeLeg = legOf('bybit-trade-2100000000000000102');
    assert.deepEqual([dogeLeg.asset, dogeLeg.received, dogeLeg.raw.quoteAsset ?? null], ['USDT', '4000000000000000000', null],
      'A trade the owner answered stays as it was answered');
    assert.deepEqual(legsAfter.filter((row) => ['TON', 'NOPE'].includes(row.asset)).map((row) => [row.asset, row.received]),
      [['NOPE', '7000000000000000000'], ['TON', '40000000000000000000']]);
    const xrpAnswer = await db.query(`SELECT type, automatic FROM chain_transaction_classification_versions
      WHERE "addressId"=$1 AND txid='bybit-trade-2100000000000000101'`, [wallet]);
    assert.deepEqual(xrpAnswer.map((row) => [row.type, row.automatic]), [['buy', true]]);
    // 1159.5 USDT − 30 for the XRP + 4 for the DOGE.
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.70009', NOPE: '7', SOL: '0.6', TON: '40', USDT: '1133.5', XRP: '15' });
    assert.deepEqual(counted.address.balances, [
      { symbol: 'BTC', quantity: '0.70009' }, { symbol: 'ETH', quantity: '0' }, { symbol: 'SOL', quantity: '0.6' },
      { symbol: 'USDT', quantity: '1159.5' }, { symbol: 'USDC', quantity: '0' },
      { symbol: 'NOPE', quantity: '7' }, { symbol: 'TON', quantity: '40' }, { symbol: 'XRP', quantity: '15' },
    ]);
    assert.deepEqual(counted.address.exchange.untracked, [{ symbol: 'S', quantity: '5' }]);
    const coins = await db.query(`SELECT symbol, "priceSource", count(*)::int AS n FROM accounting_instruments
      WHERE "ownerId"=$1 AND symbol IN ('NOPE','TON','XRP') GROUP BY symbol, "priceSource" ORDER BY symbol`, [owner]);
    assert.deepEqual(coins.map((row) => [row.symbol, row.priceSource, row.n]), [['NOPE', 'market', 1], ['TON', 'market', 1], ['XRP', 'market', 1]]);
    const recounted = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([recounted.result.outcome, recounted.result.imported], ['complete', 0]);
    assert.ok(recounted.urls.length <= 12, 'The history is read again once only');
    console.log(`PASS BYBIT-ANY-COIN an account read for five coins counts every coin: in ${everyPasses.length} passes its history is read again; the XRP bought for USDT moves 15 XRP and is recorded as an automatic Buy, the DOGE sale the owner answered stays as answered, 40 TON and 7 NOPE deposited long ago are added, nothing twice; one market-priced asset each; a one-letter ticker stays untracked`);

    // BYBIT-ANY-COIN prices: the coins no catalog provider is asked for are priced from Bybit's
    // spot market, hourly and once from its daily candles; NOPE has no market there.
    const { PricesService } = require(`${dist}/prices/prices.service.js`);
    const { BybitMarketClient } = require(`${dist}/prices/bybit-market.js`);
    const { CoinGeckoClient, KrakenClient } = require(`${dist}/prices/price-providers.js`);
    const { latestMarketPrices } = require(`${dist}/prices/market-price.store.js`);
    const prices = new PricesService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: 'true' }),
      new KrakenClient({ pauseMs: 0, retryPauseMs: 0 }), new CoinGeckoClient(), new BybitMarketClient());
    const klines = (urls, interval) => urls.filter((url) => url.pathname === '/v5/market/kline' && url.searchParams.get('interval') === interval)
      .map((url) => url.searchParams.get('symbol'));
    const collected = await newRequests(() => prices.collect(new Date()));
    assert.equal(collected.result.outcome, 'collected');
    assert.deepEqual(klines(collected.urls, '60'), ['NOPEUSDT', 'TONUSDT', 'XRPUSDT']);
    assert.deepEqual(klines(collected.urls, 'D'), ['TONUSDT', 'XRPUSDT']);
    assert.ok(collected.urls.every((url) => url.pathname === '/v5/market/kline'), 'Market prices need no key');
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const observed = await db.query(`SELECT asset, kind, count(*)::int AS n, max("observedAt") AS last,
        trim_scale(min(price))::text AS low, trim_scale(max(price))::text AS high
      FROM price_observations WHERE source='bybit' GROUP BY asset, kind ORDER BY asset, kind`);
    assert.deepEqual(observed.map((row) => [row.asset, row.kind, row.n, row.low, row.high]), [
      ['TON', 'daily-close', 39, '3', '3'], ['TON', 'hourly-close', 1, '3', '3'],
      ['XRP', 'daily-close', 39, '2.5', '2.5'], ['XRP', 'hourly-close', 1, '2.5', '2.5'],
    ]);
    assert.equal(observed.find((row) => row.kind === 'hourly-close').last.toISOString(), hour.toISOString());
    const [bybitSource] = await db.query("SELECT state, \"errorCode\", \"errorMessage\" FROM sync_sources WHERE key='prices:bybit'");
    assert.deepEqual(bybitSource, { state: 'delayed', errorCode: 'missing_assets', errorMessage: 'Bybit has no USDT market for NOPE' });
    const latest = await latestMarketPrices(db.manager, ['NOPE', 'TON', 'XRP'], new Date());
    assert.deepEqual(latest.map((row) => [row.asset, row.price, row.source]), [['TON', '3', 'bybit'], ['XRP', '2.5', 'bybit']]);
    const view = await prices.read(new Date());
    assert.deepEqual(view.assets.slice(-3).map((row) => [row.asset, row.price, row.source, row.status]),
      [['NOPE', null, null, 'none'], ['TON', '3', 'bybit', 'fresh'], ['XRP', '2.5', 'bybit', 'fresh']]);
    const recollected = await newRequests(() => prices.collect(new Date()));
    assert.deepEqual(klines(recollected.urls, 'D'), [], 'Daily history is read once per coin');
    await assert.rejects(() => db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
      VALUES ('XRP','USD','binance',now(),1,'spot')`), /price_observations_source_check/);
    console.log('PASS BYBIT-ANY-COIN-PRICE the coins no catalog provider is asked for get Bybit\'s last closed hourly candle and, once, its daily candles against USDT, without a key; a coin without a Bybit market stays unpriced and is named; the source check admits bybit only besides kraken and coingecko');

    // BYBIT-COUNT-GAP: Bybit holds 3 DOT no record explains (a purchase the API never lists)
    // and 5 TON fewer than the records. The owner counts each difference: one more record of the
    // account, unanswered, counted at once; the same request twice stores one record.
    const gapBalances = {
      FUND: [{ coin: 'USDT', walletBalance: '909.5', transferBalance: '909.5', bonus: '' }, { coin: 'BTC', walletBalance: '0.1901', transferBalance: '0.1901', bonus: '' },
        { coin: 'SOL', walletBalance: '0.6', transferBalance: '0.6', bonus: '' }, { coin: 'TON', walletBalance: '35', transferBalance: '35', bonus: '' }],
      UNIFIED: [...balances.UNIFIED, { coin: 'XRP', walletBalance: '15', transferBalance: '15', bonus: '' },
        { coin: 'NOPE', walletBalance: '7', transferBalance: '7', bonus: '' }, { coin: 'DOT', walletBalance: '3', transferBalance: '3', bonus: '' }],
    };
    await post('bybit', { append: true, balances: gapBalances });
    const reported = await s.addresses.sync(owner, wallet);
    assert.equal(reported.outcome, 'complete');
    assert.deepEqual(reported.address.balances.filter((item) => ['DOT', 'TON'].includes(item.symbol)),
      [{ symbol: 'DOT', quantity: '3' }, { symbol: 'TON', quantity: '35' }]);
    const gapsBefore = (await legsOf(db, wallet)).length;
    const heldBefore = await held(db, owner, exchange);
    assert.equal(heldBefore.DOT, undefined);
    assert.equal(heldBefore.TON, '40');
    const dotGap = { requestId: randomUUID(), coin: 'DOT', direction: 'in', quantity: '3', reported: '3' };
    const counted3 = await s.addresses.countGap(owner, wallet, dotGap);
    assert.equal(counted3.transactionCount, gapsBefore + 1);
    const repeated = await s.addresses.countGap(owner, wallet, dotGap);
    assert.equal(repeated.transactionCount, gapsBefore + 1, 'The same request stores one record');
    const tonGap = { requestId: randomUUID(), coin: 'TON', direction: 'out', quantity: '5', reported: '35' };
    await s.addresses.countGap(owner, wallet, tonGap);
    const gapLegs = (await legsOf(db, wallet)).filter((row) => row.txid.includes('-gap-'));
    assert.deepEqual(gapLegs.map((row) => [row.txid, row.asset, row.received, row.sent, row.direction, row.raw.balanceGap]).sort(),
      [[`bybit-deposit-gap-${dotGap.requestId}`, 'DOT', '3000000000000000000', '0', 'in', true],
        [`bybit-withdrawal-gap-${tonGap.requestId}`, 'TON', '0', '5000000000000000000', 'out', true]].sort());
    assert.deepEqual(await held(db, owner, exchange), { ...heldBefore, DOT: '3', TON: '35' });
    const dot = await db.query(`SELECT "priceSource" FROM accounting_instruments WHERE "ownerId"=$1 AND symbol='DOT'`, [owner]);
    assert.deepEqual(dot.map((row) => row.priceSource), ['market']);
    // Left unanswered, a counted record is a deposit or withdrawal in the account's list.
    const unanswered = await db.query(`SELECT count(*)::int AS n FROM chain_transaction_classification_versions
      WHERE "addressId"=$1 AND txid LIKE '%-gap-%'`, [wallet]);
    assert.equal(unanswered[0].n, 0);
    // A balance Bybit no longer reports, a larger difference than the balance, another owner's
    // or a missing address, and malformed input store nothing.
    const refusedGap = (input, id = wallet) => s.addresses.countGap(owner, id, input);
    await assert.rejects(() => refusedGap({ ...dotGap, requestId: randomUUID(), reported: '2.5' }), /another balance/);
    await assert.rejects(() => refusedGap({ ...dotGap, requestId: randomUUID(), quantity: '3.5' }), /exceeds/);
    await assert.rejects(() => refusedGap({ ...dotGap, requestId: randomUUID() }, randomUUID()), /Not Found/);
    await assert.rejects(() => refusedGap({ ...dotGap, requestId: randomUUID(), coin: 'EUR' }), /Invalid wallet address input/);
    await assert.rejects(() => refusedGap({ ...dotGap, requestId: randomUUID(), extra: 1 }), /Invalid wallet address input/);
    assert.equal((await legsOf(db, wallet)).filter((row) => row.txid.includes('-gap-')).length, 2);
    console.log('PASS BYBIT-COUNT-GAP a difference between Bybit\'s balance and the records is counted as one more record of the account: 3 DOT Bybit holds without a record become a deposit, 5 TON it holds fewer a withdrawal, both counting at once without a purchase price and with a market-priced asset; the same request stores one record; a balance Bybit no longer reports, a difference larger than the balance and bad input store nothing');

    // BYBIT-KEY on every pass: a key the owner later lets withdraw (or trade) in Bybit is
    // deleted at the next sync before anything else is asked; a read-only key added again resumes.
    const widened = { ...replacement, info: { ...replacement.info,
      permissions: { ...replacement.info.permissions, Wallet: ['AccountTransfer', 'Withdraw'] } } };
    await post('bybit', { keys: [readOnly, widened] });
    const wide = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([wide.result.outcome, wide.result.reason], ['provider_error', 'key_rejected']);
    assert.match(wide.result.address.sync.errorMessage, /^Bybit did not accept the API key: .*The key can now trade or withdraw, so the app deleted it\.$/);
    assert.deepEqual(wide.urls.map((url) => url.pathname), ['/v5/user/query-api'], 'Nothing else is asked with that key');
    assert.deepEqual((await db.query('SELECT credentials FROM bybit_accounts WHERE "walletId"=$1', [wallet]))[0].credentials, {});
    const keyless = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([keyless.result.outcome, keyless.result.reason, keyless.urls.length], ['provider_error', 'not_configured', 0]);
    await post('bybit', { keys: [readOnly, replacement] });
    await s.addresses.register(owner, { network: 'bybit', apiKey: replacement.apiKey, apiSecret: replacement.apiSecret });
    assert.equal((await s.addresses.sync(owner, wallet)).outcome, 'complete');
    console.log('PASS BYBIT-KEY a key later given the Withdraw permission is deleted at the next sync before anything else is asked; the account then has no key until a read-only one is added again, which resumes it');

    // Constraints and privacy.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'bybit','not-a-uid')`,
      [owner]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'bitcoin',$2)`,
      [owner, String(uid)]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw,asset)
      VALUES ($1,$2,'bybit-trade-x y',0,now(),1,0,0,'in','{"txid":"bybit-trade-x y"}','BTC')`, [owner, wallet]), /wallet_address_transactions_txid_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw,asset)
      VALUES ($1,$2,'bybit-earn-fixed-1',0,now(),1,0,0,'in','{"txid":"bybit-earn-fixed-1"}','BTC')`, [owner, wallet]), /wallet_address_transactions_txid_check/);
    await assert.rejects(() => db.query(`UPDATE bybit_accounts SET earn='{}'::jsonb WHERE "walletId"=$1`, [wallet]), /bybit_accounts_earn_check/);
    await assert.rejects(() => db.query(`INSERT INTO bybit_accounts("ownerId","walletId",credentials,"keyHint","ipBound","historyFrom","tradesReadTo","depositsReadTo","internalReadTo","withdrawalsReadTo")
      VALUES ($1,$2,'{}','abcd',false,now(),now(),now(),now(),now())`, [stranger, wallet]), /foreign key|duplicate key/);
    await assert.rejects(() => db.query('DELETE FROM wallet_addresses WHERE id=$1', [wallet]), /foreign key/);
    await refusal(() => s.addresses.sync(stranger, wallet), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS BYBIT-DB a Bybit account is named by its numeric user ID; record ids, owner and account rows are checked; another owner gets 404');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new SyncBybitAccount1793300000000().down(), /recovery plan/);
    await assert.rejects(() => new ReadBybitEarn1794000000000().down(), /recovery plan/);
    await assert.rejects(() => new ReadBybitConverts1794400000000().down(), /recovery plan/);
    await assert.rejects(() => new PriceBybitCoins1794500000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS BYBIT-MIGRATION fresh 53 applies once; no Bybit migration goes down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
