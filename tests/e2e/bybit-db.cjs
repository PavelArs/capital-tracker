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
  // Neither coin is tracked: nothing is stored.
  { at: T1 + 60_000, row: { ...fill, symbol: 'XRPEUR', execId: '2100000000000000002', execTime: String(T1 + 60_000), feeCurrency: 'XRP' } },
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
    { coin: 'XRP', walletBalance: '5', transferBalance: '5', bonus: '' }],
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
  assert.match(migrate(database), /Migrations applied: 49/);
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
    assert.deepEqual(summary.exchange.untracked, [{ symbol: 'XRP', quantity: '5' }]);
    assert.ok(Date.parse(summary.exchange.reportedAt) >= started);
    assert.equal(summary.sync.state, 'complete');
    const usdt = (await db.query("SELECT id FROM accounting_instruments WHERE \"ownerId\"=$1 AND symbol='USDT'", [owner]))[0].id;
    const journal = await s.trades.getJournal(owner, exchange);
    await s.trades.create(owner, exchange, { requestId: randomUUID(), expectedJournalRevision: journal.journal.journalRevision,
      instrumentId: usdt, side: 'buy', occurredAt: new Date(ago(DAY)).toISOString(), orderWithinTimestamp: 0,
      quantity: '200', grossUsd: '200', feeUsd: '0' });
    assert.deepEqual(await held(db, owner, exchange), { BTC: '0.70999', USDT: '599' });
    console.log('PASS BYBIT-GAPS Bybit reports 599 USDT against 399 recorded; the 200 USDT P2P purchase entered by hand closes the gap; 5 XRP shown as untracked');

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
        fixed: [{ positionId: '4064', productId: '724', category: 'FixedTermSaving', coin: 'MNT', amount: '10', status: 'Active' }],
      },
      flexibleYield: [paid('FlexibleSaving', 1, yieldAt, 'USDT', '0.5'), paid('FlexibleSaving', 2, ago(100 * DAY), 'USDT', '9'),
        paid('FlexibleSaving', 3, ago(2 * DAY), 'USDT', '0.25', 'Pending'), paid('FlexibleSaving', 4, ago(20 * DAY), 'MNT', '1')],
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
    assert.deepEqual(earned.address.exchange.untracked, [{ symbol: 'MNT', quantity: '10' }, { symbol: 'XRP', quantity: '5' }]);
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
    // two untracked coins; the older coin exchange records add 20 XRP sold for 10 USDT before
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
        converted('5100000000000000000000000005', ago(2 * DAY), 'XRP', '3', 'MNT', '1')],
      coinExchanges: [exchanged('5200000000000000001', Date.UTC(2025, 7, 1), 'XRP', '20', 'USDT', '10'),
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
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS BYBIT-MIGRATION fresh 49 applies once; no Bybit migration goes down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
