'use strict';

// Real PostgreSQL acceptance for track-ethereum-wallets (M14). Only Etherscan is synthetic:
// requests leave through HTTPS_PROXY to the providers.cjs stub, which answers the raw list
// items this probe posts. Every address, hash and amount is synthetic.
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
const { EtherscanClient } = require(`${dist}/wallet-addresses/etherscan-client.js`);
const { EthereumSyncAdapter } = require(`${dist}/wallet-addresses/ethereum-sync.adapter.js`);
const { TrackEthereumWallets1792000000000 } = require(`${dist}/migrations/1792000000000-TrackEthereumWallets.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_ethereum_wallets_e2e';
const control = 'http://providers:8080/__control';
const etherscanKey = 'acceptance-etherscan-key';
const now = new Date('2026-10-06T12:00:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const keccak = (value) => createHash('keccak-256').update(value).digest('hex');
// Synthetic addresses: lowercase hex of a fixed label, never a real wallet.
const address = (label) => `0x${sha256(`ct-e2e-eth:${label}`).slice(0, 40)}`;
const hash = (n) => `0x${sha256(`ct-e2e-eth-tx:${n}`)}`;
const blockHash = (block) => `0x${sha256(`ct-e2e-eth-block:${block}`)}`;
const bare = (n) => hash(n).slice(2);
const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const wallets = { main: address('main'), cold: address('cold'), keyless: address('keyless'), busy: address('busy') };
const outside = address('outside');
const ether = (value) => BigInt(Math.round(value * 1e6)) * 10n ** 12n;
const time = (block) => 1720000000 + (block - 20000000) * 12;
// The Bitcoin wallet that shares the scheduler: a synthetic base58check address.
const bitcoinAddress = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';

// EIP-55, restated from the standard so the probe does not trust the code it checks.
function checksummed(lower) {
  const digest = keccak(lower.slice(2));
  return `0x${[...lower.slice(2)].map((char, i) => (parseInt(digest[i], 16) >= 8 ? char.toUpperCase() : char)).join('')}`;
}

const normal = (n, block, from, to, value, gasUsed, gasPrice, isError = '0') => ({
  blockNumber: String(block), timeStamp: String(time(block)), hash: hash(n), blockHash: blockHash(block),
  from, to, value: String(value), gas: '100000', gasPrice: String(gasPrice), gasUsed: String(gasUsed),
  isError, txreceipt_status: isError === '0' ? '1' : '0', input: '0x',
});
const internal = (n, block, from, to, value) => ({
  blockNumber: String(block), timeStamp: String(time(block)), hash: hash(n), from, to, value: String(value),
  contractAddress: '', input: '', type: 'call', gas: '2300', gasUsed: '0', traceId: '0', isError: '0', errCode: '',
});
const token = (n, block, contract, symbol, from, to, value, logIndex) => ({
  blockNumber: String(block), timeStamp: String(time(block)), hash: hash(n), blockHash: blockHash(block),
  from, to, value: String(value), contractAddress: contract, tokenName: symbol, tokenSymbol: symbol,
  tokenDecimal: '6', logIndex: String(logIndex), gas: '100000', gasPrice: '1', gasUsed: '1',
});

const feeSwap = 21000n * 10n ** 9n * 5n;
const feeUsdt = 50000n * 2n * 10n ** 9n;
const feeOwn = 21000n * 10n ** 9n;
// The provider history (the stub filters each list by address and block range).
const history = {
  normal: [
    // ETH-IDENTITY: one hash moves 1.5 ETH and 250 USDC to the main wallet.
    normal(1, 20000001, outside, wallets.main, ether(1.5), 21000, 5 * 10 ** 9),
    // A USDT send: the main wallet pays gas to the token contract.
    normal(2, 20000010, wallets.main, usdt, 0, 50000, 2 * 10 ** 9),
    // 0.5 ETH from the main wallet to the cold wallet (another of the owner's accounts).
    normal(3, 20000020, wallets.main, wallets.cold, ether(0.5), 21000, 10 ** 9),
    // A reverted send the main wallet still pays gas for.
    normal(7, 20000022, wallets.main, outside, ether(9), 21000, 10 ** 9, '1'),
    // Not final yet: the tip is less than 64 blocks above it.
    normal(5, 20000050, outside, wallets.main, ether(1), 21000, 10 ** 9),
  ],
  internal: [internal(4, 20000030, outside, wallets.main, ether(0.25))],
  tokens: [
    token(1, 20000001, usdc, 'USDC', outside, wallets.main, 250000000n, 7),
    token(6, 20000005, usdt, 'USDT', outside, wallets.main, 300000000n, 2),
    token(2, 20000010, usdt, 'USDT', wallets.main, outside, 100000000n, 3),
    // Address poisoning: a zero-value copycat transfer is never stored.
    token(8, 20000025, usdc, 'USDC', wallets.main, outside, 0n, 1),
    // Any other token is out of scope (Q7).
    token(9, 20000026, address('other-token'), 'XYZ', outside, wallets.main, 5000000n, 4),
  ],
};
// Independent oracle of the stored legs of the main wallet, newest block first.
const mainLegs = [
  { txid: bare(4), asset: null, received: ether(0.25), sent: 0n, fee: 0n, direction: 'in', block: 20000030, blockHash: null },
  { txid: bare(7), asset: null, received: 0n, sent: feeOwn, fee: feeOwn, direction: 'out', block: 20000022 },
  { txid: bare(3), asset: null, received: 0n, sent: ether(0.5) + feeOwn, fee: feeOwn, direction: 'out', block: 20000020 },
  { txid: bare(2), asset: null, received: 0n, sent: feeUsdt, fee: feeUsdt, direction: 'out', block: 20000010 },
  { txid: `${bare(2)}-3`, asset: 'USDT', received: 0n, sent: 100000000n, fee: 0n, direction: 'out', block: 20000010 },
  { txid: `${bare(6)}-2`, asset: 'USDT', received: 300000000n, sent: 0n, fee: 0n, direction: 'in', block: 20000005 },
  { txid: bare(1), asset: null, received: ether(1.5), sent: 0n, fee: 0n, direction: 'in', block: 20000001 },
  { txid: `${bare(1)}-7`, asset: 'USDC', received: 250000000n, sent: 0n, fee: 0n, direction: 'in', block: 20000001 },
];

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function etherscanUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => new URL(url)).filter(({ hostname }) => hostname === 'api.etherscan.io');
}
async function newRequests(action) {
  const before = (await etherscanUrls()).length;
  const result = await action();
  return { result, urls: (await etherscanUrls()).slice(before) };
}
const call = (url) => [url.searchParams.get('action'), url.searchParams.get('address'), url.searchParams.get('startblock'), url.searchParams.get('endblock')];
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
    assert.match(name, /^capital_tracker_ethereum_wallets_e2e$/);
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
  return (await db.query(`SELECT txid, asset, "blockHeight", "blockHash", "blockTime", "receivedUnits"::text AS received,
    "sentUnits"::text AS sent, "feeUnits"::text AS fee, direction, raw FROM wallet_address_transactions
    WHERE "addressId"=$1 ORDER BY "blockHeight" DESC, txid`, [addressId]));
}
function assertLegs(rows, legs) {
  assert.deepEqual(rows.map((row) => ({ txid: row.txid, asset: row.asset, received: row.received, sent: row.sent,
    fee: row.fee, direction: row.direction, block: row.blockHeight })),
  legs.map(({ txid, asset, received, sent, fee, direction, block }) => ({ txid, asset, received: String(received),
    sent: String(sent), fee: String(fee), direction, block })));
  rows.forEach((row, index) => {
    const expected = legs[index];
    assert.equal(row.blockHash, expected.blockHash === null ? null : blockHash(expected.block).slice(2));
    assert.equal(row.blockTime.toISOString(), new Date(time(expected.block) * 1000).toISOString());
    assert.equal(row.raw.txid, row.txid, 'Raw provider observation is retained');
  });
}
function services(db, apiKey = etherscanKey) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const bitcoin = new BitcoinSyncAdapter(db, new EsploraClient());
  const ethereum = new EthereumSyncAdapter(db, new EtherscanClient({ apiKey, pauseMs: 0 }));
  const scheduler = (enabled) => new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }),
    [bitcoin, ethereum], classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    operations: make('operation-list.service', 'OperationListService'),
    classifications,
    scheduler,
    addresses: new WalletAddressService(db, scheduler(false)),
  };
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 44/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('eth-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('eth-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const account = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const mainAccount = await account('Main');
    const coldAccount = await account('Cold');

    // WAL-ADD, WAL-INVALID, WAL-DUP: no provider call while an address is added.
    const added = await newRequests(async () => {
      const first = await s.addresses.register(owner, { network: 'ethereum', address: checksummed(wallets.main), accountId: mainAccount, label: 'Main ETH' });
      const again = await s.addresses.register(owner, { network: 'ethereum', address: wallets.main.toUpperCase().replace('0X', '0x'), accountId: coldAccount });
      for (const input of [
        { network: 'ethereum', address: bitcoinAddress },
        { network: 'ethereum', address: wallets.main.slice(0, 41) },
        // A mixed-case address whose checksum is wrong was mistyped.
        { network: 'ethereum', address: `0x${checksummed(wallets.main).slice(2).replace(/[a-fA-F]/, (char) => (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()))}` },
        { network: 'bitcoin', address: wallets.main },
        { network: 'solana', address: wallets.main },
        { network: 'ethereum', address: `0x${'4c'.repeat(32)}` },
      ]) await refusal(() => s.addresses.register(owner, input), 400);
      return { first, again };
    });
    assert.deepEqual(added.urls, []);
    const { first, again } = added.result;
    assert.deepEqual([first.created, again.created, again.value.id], [true, false, first.value.id]);
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label, first.value.balances, first.value.sync.state],
      ['ethereum', wallets.main, mainAccount, 'Main ETH', null, 'never']);
    const main = first.value.id;
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_addresses WHERE "ownerId"=$1', [owner]))[0].n, 1);
    console.log('PASS WAL-ADD Ethereum address stored lower case from a checksummed input; WAL-DUP returns the same wallet; WAL-INVALID 400 for a Bitcoin address, a short or mistyped one, a private key; no provider call');

    // ETH-IDENTITY: the first sync reads every list once over the final blocks.
    await post('ethereum', { tip: 20000100, ...history });
    const sync1 = await newRequests(() => s.addresses.sync(owner, main));
    assert.deepEqual([sync1.result.outcome, sync1.result.reason, sync1.result.imported], ['complete', null, 8]);
    assert.deepEqual(sync1.urls.map(call), [
      ['eth_blockNumber', null, null, null],
      ['txlist', wallets.main, '0', '20000036'],
      ['txlistinternal', wallets.main, '0', '20000036'],
      ['tokentx', wallets.main, '0', '20000036'],
    ]);
    assert.ok(sync1.urls.every((url) => url.searchParams.get('chainid') === '1' && url.pathname === '/v2/api'));
    assertLegs(await stored(db, main), mainLegs);
    const bothLegs = (await stored(db, main)).filter((row) => row.txid.startsWith(bare(1)));
    assert.deepEqual(bothLegs.map((row) => [row.txid, row.asset]), [[bare(1), null], [`${bare(1)}-7`, 'USDC']]);
    assert.equal(bothLegs[0].raw.hash, hash(1));
    assert.equal(bothLegs[1].raw.transfer.logIndex, '7');
    // SYNC-RECONCILE: per asset, received minus sent of the whole stored history.
    const summary = sync1.result.address;
    assert.deepEqual(summary.balances, [
      { symbol: 'ETH', quantity: '1.249858000000000000' },
      { symbol: 'USDT', quantity: '200.000000' },
      { symbol: 'USDC', quantity: '250.000000' },
    ]);
    assert.deepEqual([summary.chainBalance, summary.transactionCount, summary.sync.state], ['1.249858000000000000', 8, 'complete']);
    assert.equal((await db.query('SELECT "scannedBlock" FROM wallet_addresses WHERE id=$1', [main]))[0].scannedBlock, 20000036);
    console.log('PASS ETH-IDENTITY one hash moving ETH and USDC stores two legs (native, and token with log index 7); fees in ETH; a reverted send keeps only its fee; zero-value and unknown tokens skipped');
    console.log('PASS SYNC-RECONCILE complete history gives ETH 1.249858, USDT 200, USDC 250');

    // CLS-PROVISIONAL: the sync created each moved asset, so the unclassified history already
    // gives the account the chain's balances, without a purchase price.
    {
      const { readValuationInputs, accountsAt } = require(`${dist}/accounting/portfolio-valuation.service.js`);
      const { canonicalDecimalToAtoms, formatAtoms } = require(`${dist}/accounting/money.js`);
      const inputs = await readValuationInputs(db.manager, owner);
      const held = accountsAt(inputs, new Date().toISOString()).find((item) => item.accountId === mainAccount);
      const symbol = new Map(inputs.instruments.map((item) => [item.id, item.symbol]));
      const totals = new Map();
      for (const lot of held.lots) {
        const key = symbol.get(lot.instrumentId);
        totals.set(key, (totals.get(key) ?? 0n) + canonicalDecimalToAtoms(lot.quantity));
        assert.equal(lot.costUsd, null);
      }
      assert.deepEqual([...totals].map(([key, atoms]) => [key, formatAtoms(atoms)]).sort(),
        [['ETH', '1.249858'], ['USDC', '250'], ['USDT', '200']]);
    }
    console.log('PASS CLS-PROVISIONAL unclassified ETH, USDT and USDC count in the account at the chain balances');

    // Resync: no duplicates; only blocks that became final are read.
    const sync2 = await newRequests(() => s.addresses.sync(owner, main));
    assert.deepEqual([sync2.result.outcome, sync2.result.imported], ['complete', 0]);
    assert.deepEqual(sync2.urls.map(call), [['eth_blockNumber', null, null, null]]);
    await post('ethereum', { tip: 20000120 });
    const sync3 = await newRequests(() => s.addresses.sync(owner, main));
    assert.deepEqual([sync3.result.outcome, sync3.result.imported], ['complete', 1]);
    assert.deepEqual(sync3.urls.map(call).slice(1), [
      ['txlist', wallets.main, '20000037', '20000056'],
      ['txlistinternal', wallets.main, '20000037', '20000056'],
      ['tokentx', wallets.main, '20000037', '20000056'],
    ]);
    const finalLegs = [{ txid: bare(5), asset: null, received: ether(1), sent: 0n, fee: 0n, direction: 'in', block: 20000050 }, ...mainLegs];
    assertLegs(await stored(db, main), finalLegs);
    // Reading the same final blocks again stores nothing twice.
    await db.query('UPDATE wallet_addresses SET "scannedBlock"=NULL, "completedAt"=NULL WHERE id=$1', [main]);
    const replay = await s.addresses.sync(owner, main);
    assert.deepEqual([replay.outcome, replay.imported, replay.address.transactionCount], ['complete', 0, 9]);
    assertLegs(await stored(db, main), finalLegs);
    console.log('PASS ETH-IDENTITY resync stores each leg once: 0 new on the same tip, 1 once its block is final, 0 after a full replay');

    // Constraints: only the two networks, lower-case Ethereum addresses and leg ids.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'solana',$2)`, [owner, wallets.busy]), /wallet_addresses_(network|address)_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'ethereum',$2)`, [owner, checksummed(wallets.busy)]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockTime",
      "receivedUnits","sentUnits","feeUnits",direction,raw) VALUES ($1,$2,$3,1,now(),0,0,0,'in','{}')`, [owner, main, hash(1)]), /check/);
    console.log('PASS ETH-DB network, address and leg id checks refuse anything else');

    // ETH-LINK: once the main wallet's ETH has a cost, its send to the cold wallet becomes one transfer.
    const cold = (await s.addresses.register(owner, { network: 'ethereum', address: wallets.cold, accountId: coldAccount })).value.id;
    assert.deepEqual((await s.addresses.sync(owner, cold)).imported, 1);
    await s.classifications.classify(owner, main, bare(1), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '3000' } });
    await s.classifications.classify(owner, main, `${bare(1)}-7`, { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '250' } });
    const links = await db.query(`SELECT "addressId", type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [bare(3)]);
    assert.equal(links.length, 2, 'Both legs of the own transfer are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const list = (await s.operations.read(owner, {}, now)).operations;
    const byTx = (txid) => list.filter((operation) => operation.chain?.txid === txid);
    assert.deepEqual(byTx(bare(1)).map((operation) => [operation.asset.symbol, operation.quantity, operation.status]),
      [['ETH', '1.5', 'recorded']]);
    assert.deepEqual(byTx(`${bare(1)}-7`).map((operation) => [operation.asset.symbol, operation.quantity, operation.status]),
      [['USDC', '250', 'recorded']]);
    const transfer = byTx(bare(3));
    assert.equal(transfer.length, 1, 'A linked pair is listed once');
    assert.deepEqual([transfer[0].type, transfer[0].asset.symbol, transfer[0].quantity, transfer[0].fee?.asset.symbol],
      ['transfer', 'ETH', '0.5', 'ETH']);
    const usdtSend = byTx(`${bare(2)}-3`)[0];
    assert.deepEqual([usdtSend.asset.symbol, usdtSend.quantity, usdtSend.fee], ['USDT', '100', null]);
    const gas = byTx(bare(2))[0];
    assert.deepEqual([gas.asset.symbol, gas.quantity, gas.direction], ['ETH', '0.0001', 'out']);
    console.log('PASS ETH-LINK a 0.5 ETH send between own accounts auto-links into one transfer; token legs list as USDC and USDT, gas as ETH');

    // SYNC-ISOLATION and SYNC-BG: the hourly job runs both networks; one network failing
    // leaves the other synced, and a server without the key says so without calling Etherscan.
    await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "nextRunAt")
      SELECT 'wallet:' || id, 'synced', now(), now() + interval '1 day' FROM wallet_addresses
      ON CONFLICT (key) DO UPDATE SET "nextRunAt" = EXCLUDED."nextRunAt"`);
    const btc = (await s.addresses.register(owner, { network: 'bitcoin', address: bitcoinAddress })).value.id;
    const keyless = (await s.addresses.register(owner, { network: 'ethereum', address: wallets.keyless })).value.id;
    await post('bitcoin-history', { address: bitcoinAddress, count: 2 });
    const noKey = services(db, '');
    const t0 = new Date();
    const tick = await newRequests(() => noKey.scheduler(true).tick(t0));
    assert.deepEqual(tick.result, { outcome: 'ran', wallets: [{ id: btc, state: 'synced' }, { id: keyless, state: 'failed' }] });
    assert.deepEqual(tick.urls, [], 'No Etherscan request without a key');
    let listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual([listed.get(keyless).sync.status, listed.get(keyless).sync.errorMessage],
      ['failed', 'Ethereum sync needs a valid Etherscan API key on the server (ETHERSCAN_API_KEY).']);
    assert.equal(listed.get(btc).transactionCount, 2);
    // With the key, the next due run recovers; a busy Etherscan delays only its wallet.
    const busy = (await s.addresses.register(owner, { network: 'ethereum', address: wallets.busy })).value.id;
    await post('ethereum', { normal: [...history.normal, normal(10, 20000040, outside, wallets.keyless, ether(2), 21000, 10 ** 9)],
      fault: { onRequest: 1, rateLimited: true } });
    const t1 = new Date(t0.getTime() + 15 * 60000);
    const recovered = await s.scheduler(true).tick(t1);
    // A wallet never synced comes first; the rate limit answers its first request.
    assert.deepEqual(recovered, { outcome: 'ran', wallets: [{ id: busy, state: 'delayed' }, { id: keyless, state: 'synced' }] });
    assert.equal(new Map((await s.addresses.list(owner)).map((item) => [item.id, item])).get(busy).sync.errorMessage,
      'The Ethereum data source is busy. The app tries again in a few minutes.');
    const t2 = new Date(t1.getTime() + 15 * 60000);
    assert.deepEqual(await s.scheduler(true).tick(t2), { outcome: 'ran', wallets: [{ id: busy, state: 'synced' }] });
    listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual([listed.get(keyless).sync.status, listed.get(keyless).sync.errorMessage, listed.get(keyless).balances[0]],
      ['synced', null, { symbol: 'ETH', quantity: '2.000000000000000000' }]);
    assert.deepEqual([listed.get(busy).sync.errorMessage, listed.get(busy).transactionCount, listed.get(busy).balances.map((item) => item.quantity)],
      [null, 0, ['0.000000000000000000', '0.000000', '0.000000']]);
    assertLegs(await stored(db, main), finalLegs);
    console.log('PASS SYNC-ISOLATION without ETHERSCAN_API_KEY only Ethereum wallets fail, with that reason and no request; Bitcoin syncs; a rate-limited Etherscan delays one wallet');
    console.log('PASS SYNC-BG the hourly job syncs Ethereum wallets beside Bitcoin ones and recovers on the next due run');

    // Reads stay owner-scoped and per asset.
    const page = await s.addresses.transactions(owner, main, {});
    assert.equal(page.total, 9);
    assert.deepEqual(page.items.find((item) => item.txid === `${bare(1)}-7`), {
      txid: `${bare(1)}-7`, blockHeight: 20000001, blockTime: new Date(time(20000001) * 1000).toISOString(), direction: 'in',
      symbol: 'USDC', received: '250.000000', sent: '0.000000', net: '250.000000', fee: '0.000000000000000000',
      receivedBtc: '250.000000', sentBtc: '0.000000', netBtc: '250.000000', feeBtc: '0.000000000000000000',
      usdValue: null, usdValueStatus: 'missing',
    });
    await refusal(() => s.addresses.sync(stranger, main), 404);
    await refusal(() => s.addresses.transactions(stranger, main, {}), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS ETH-PRIVATE another owner gets 404 for the wallet and sees none; legs read per asset');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new TrackEthereumWallets1792000000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS ETH-MIGRATION fresh 36 applies once; down refuses');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
