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
const { EvmSyncAdapter } = require(`${dist}/wallet-addresses/evm-sync.adapter.js`);
const { evmChain } = require(`${dist}/wallet-addresses/evm-chains.js`);
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
    // Any other token: see TOKEN-ANY below, on a wallet of its own.
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
  const ethereum = new EvmSyncAdapter(db, new EtherscanClient({ apiKey, pauseMs: 0 }), evmChain('ethereum'));
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
  assert.match(migrate(database), /Migrations applied: 55/);
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
    console.log('PASS ETH-IDENTITY one hash moving ETH and USDC stores two legs (native, and token with log index 7); fees in ETH; a reverted send keeps only its fee; zero-value transfers skipped');
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
    // TOKEN-FEE: the ether leg that paid the gas is the USDT send's fee, not a row of its own.
    assert.deepEqual([usdtSend.asset.symbol, usdtSend.quantity, usdtSend.fee?.asset.symbol, usdtSend.fee?.quantity],
      ['USDT', '100', 'ETH', '0.0001']);
    assert.deepEqual(byTx(bare(2)), []);
    console.log('PASS ETH-LINK a 0.5 ETH send between own accounts auto-links into one transfer; token legs list as USDC and USDT, the USDT send with its ETH gas as the fee');

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

    // ETH-STAKE-*: a stake() deposit into a pool that answers balanceOfUnderlying stays the
    // wallet's ETH, grows by the pool's rewards and comes back out with a claimed exit.
    {
      const staker = address('staker');
      const pool = address('pool');
      const queue = address('exit-queue');
      const notPool = address('not-a-pool');
      const zero = `0x${'0'.repeat(40)}`;
      const stakeCall = (n, block, to, value, input) => ({ ...normal(n, block, staker, to, value, 100000, 10 ** 9), input });
      const feeStake = 100000n * 10n ** 9n;
      const stakeHistory = {
        normal: [
          normal(20, 20000060, outside, staker, ether(3), 21000, 10 ** 9),
          stakeCall(21, 20000070, pool, ether(2), '0x3a4b66f1'),
          // stake() on a contract without balanceOfUnderlying is no pool: an ordinary payment.
          stakeCall(22, 20000072, notPool, ether(0.1), '0x3a4b66f1'),
          // requestExit(uint256) moves no ether; claiming it returns 0.51 ETH from the exit queue.
          stakeCall(23, 20000080, pool, 0, `0x721c6513${(ether(0.51)).toString(16).padStart(64, '0')}`),
          stakeCall(24, 20000090, pool, 0, '0xb7ba18c7'),
        ],
        internal: [internal(24, 20000090, queue, staker, ether(0.51))],
        // The pool token minted for the deposit is the pool's share, already the staked ETH: left
        // out, so the stake never counts twice (TOKEN-ANY).
        tokens: [token(21, 20000070, pool, 'synETH', zero, staker, ether(1.98), 9)],
      };
      const readings = [
        { holder: staker, block: 20000070, units: String(ether(2)) },
        { holder: staker, block: 20000075, units: String(ether(2.004)) },
        { holder: staker, block: 20000080, units: String(ether(1.5)) },
      ];
      await post('ethereum', { tip: 20000139, ...stakeHistory, pools: { [pool]: { symbol: 'synETH', readings } } });
      const stakeAccount = await account('Staking');
      const stakerId = (await s.addresses.register(owner, { network: 'ethereum', address: staker, accountId: stakeAccount })).value.id;
      const ethCall = (url) => url.searchParams.get('action') === 'eth_call'
        ? ['eth_call', url.searchParams.get('to'), url.searchParams.get('data').slice(0, 10), url.searchParams.get('tag')]
        : call(url);
      const first = await newRequests(() => s.addresses.sync(owner, stakerId));
      assert.deepEqual([first.result.outcome, first.result.reason, first.result.imported], ['complete', null, 3]);
      const tag = `0x${(20000075).toString(16)}`;
      assert.deepEqual(first.urls.map(ethCall), [
        ['eth_blockNumber', null, null, null],
        ['txlist', staker, '0', '20000075'],
        ['txlistinternal', staker, '0', '20000075'],
        ['tokentx', staker, '0', '20000075'],
        ...[notPool, pool].sort().map((to) => ['eth_call', to, '0x3af9e669', tag]),
        ['eth_call', pool, '0x3af9e669', tag],
        ['eth_call', pool, '0x95d89b41', tag],
      ]);
      assert.equal(first.urls.find((url) => url.searchParams.get('to') === pool).searchParams.get('data'),
        `0x3af9e669${staker.slice(2).padStart(64, '0')}`);
      const fee = (n) => feeStake * BigInt(n);
      const units = (value) => (Number(value) === 0 ? 0n : BigInt(value));
      const stakeRows = async () => ({
        moves: (await db.query(`SELECT txid, contract, "blockHeight", units::text FROM wallet_ether_stake_moves
          WHERE "addressId"=$1 ORDER BY "blockHeight"`, [stakerId])).map((row) => [row.txid, row.contract, row.blockHeight, row.units]),
        rewards: (await db.query(`SELECT contract, "blockHeight", units::text FROM wallet_ether_stake_rewards
          WHERE "addressId"=$1 ORDER BY "blockHeight"`, [stakerId])).map((row) => [row.contract, row.blockHeight, row.units]),
      });
      assert.deepEqual(await stakeRows(), {
        moves: [[bare(21), pool, 20000070, String(ether(2))]],
        rewards: [[pool, 20000075, String(ether(0.004))]],
      });
      // 3 in, 0.1 paid out, two fees; the 2 ETH deposit stays and earned 0.004.
      const firstEth = ether(3) - ether(0.1) - fee(2) + ether(0.004);
      assert.equal(units(first.result.address.balances[0].quantity.replace('.', '')), firstEth);
      assert.deepEqual(first.result.address.staking, {
        symbol: 'ETH', quantity: '2.004000000000000000', rewards: '0.004000000000000000',
        accounts: [{ account: pool, validator: null, pool: 'synETH', state: 'active',
          quantity: '2.004000000000000000', rewards: '0.004000000000000000' }],
      });
      console.log('PASS ETH-STAKE-FIND a stake() deposit into a contract that answers balanceOfUnderlying is a pool; one that does not stays a payment');
      console.log('PASS ETH-STAKE-BALANCE the 2 ETH deposit stays in the wallet balance as staked ETH with its 0.004 ETH reward');

      // The claimed exit leaves the pool; the pool's growth since is a reward.
      await post('ethereum', { tip: 20000160 });
      const second = await s.addresses.sync(owner, stakerId);
      assert.deepEqual([second.outcome, second.imported], ['complete', 2]);
      assert.deepEqual(await stakeRows(), {
        moves: [[bare(21), pool, 20000070, String(ether(2))], [bare(24), pool, 20000090, String(-ether(0.51))]],
        rewards: [[pool, 20000075, String(ether(0.004))], [pool, 20000096, String(ether(0.006))]],
      });
      const finalEth = ether(3) - ether(0.1) - fee(4) + ether(0.01);
      assert.equal(units(second.address.balances[0].quantity.replace('.', '')), finalEth);
      assert.deepEqual([second.address.staking.quantity, second.address.staking.rewards, second.address.staking.accounts[0].state],
        ['1.500000000000000000', '0.010000000000000000', 'active']);
      const listed = (await s.operations.read(owner, {}, now)).operations.filter((item) => item.wallet?.id === stakerId);
      const row = (n) => listed.find((item) => item.chain?.txid === bare(n));
      assert.deepEqual([row(21).type, row(21).direction, row(21).status, row(21).quantity, row(21).fee.quantity],
        ['stake', 'internal', 'recorded', '2', '0.0001']);
      assert.deepEqual([row(24).type, row(24).direction, row(24).status, row(24).quantity], ['unstake', 'internal', 'recorded', '0.51']);
      assert.deepEqual([row(22).status, row(22).direction], ['needs-classification', 'out']);
      // CLS-PROVISIONAL: the account holds what the chain shows, rewards without a purchase price.
      {
        const { readValuationInputs, accountsAt } = require(`${dist}/accounting/portfolio-valuation.service.js`);
        const { canonicalDecimalToAtoms } = require(`${dist}/accounting/money.js`);
        const inputs = await db.transaction((manager) => readValuationInputs(manager, owner));
        const held = accountsAt(inputs, new Date().toISOString()).find((item) => item.accountId === stakeAccount);
        const total = held.lots.reduce((sum, lot) => sum + canonicalDecimalToAtoms(lot.quantity), 0n);
        assert.equal(total, finalEth * 10n ** 12n);
      }
      console.log('PASS ETH-STAKE-MOVE the deposit and the claimed 0.51 ETH exit list as Stake and Unstake, recorded, with only the fee leaving');
      console.log('PASS ETH-STAKE-REWARD growth after the exit is a reward at the block read; the account holds the chain balance');

      // ETH-STAKE-FIND: a wallet synced before pools were followed is read once from its stored history.
      await db.query('DELETE FROM wallet_ether_stake_rewards WHERE "addressId"=$1', [stakerId]);
      await db.query('DELETE FROM wallet_ether_stake_moves WHERE "addressId"=$1', [stakerId]);
      await db.query('DELETE FROM wallet_ether_stake_positions WHERE "addressId"=$1', [stakerId]);
      await db.query('DELETE FROM wallet_stake_scans WHERE "addressId"=$1', [stakerId]);
      const backfilled = await newRequests(() => s.addresses.sync(owner, stakerId));
      assert.deepEqual([backfilled.result.outcome, backfilled.result.imported], ['complete', 0]);
      assert.deepEqual(backfilled.urls.map(ethCall), [
        ['eth_blockNumber', null, null, null],
        ...[notPool, pool].sort().map((to) => ['eth_call', to, '0x3af9e669', `0x${(20000096).toString(16)}`]),
        ['eth_call', pool, '0x3af9e669', `0x${(20000096).toString(16)}`],
        ['eth_call', pool, '0x95d89b41', `0x${(20000096).toString(16)}`],
      ]);
      assert.deepEqual(await stakeRows(), {
        moves: [[bare(21), pool, 20000070, String(ether(2))], [bare(24), pool, 20000090, String(-ether(0.51))]],
        rewards: [[pool, 20000096, String(ether(0.01))]],
      });
      assert.equal(units(backfilled.result.address.balances[0].quantity.replace('.', '')), finalEth);
      console.log('PASS ETH-STAKE-FIND an address synced before pools were followed finds its deposit and exit in the stored history once');

      // A refused pool reading leaves the wallet to try again.
      await post('ethereum', { fault: { onRequest: 2, rateLimited: true } });
      const refused = await s.addresses.sync(owner, stakerId);
      assert.deepEqual([refused.outcome, refused.reason], ['provider_error', 'rate_limited']);
      assert.equal((await stakeRows()).rewards.length, 1);
      await assert.rejects(() => db.query(`INSERT INTO wallet_ether_stake_positions("ownerId","addressId",contract) VALUES ($1,$2,$3)`,
        [owner, stakerId, checksummed(address('upper'))]), /wallet_ether_stake_positions_contract_check/);
      await assert.rejects(() => db.query(`INSERT INTO wallet_ether_stake_moves("ownerId","addressId",txid,contract,"blockHeight","blockTime",units)
        VALUES ($1,$2,$3,$4,1,now(),0)`, [owner, stakerId, bare(30), pool]), /wallet_ether_stake_moves_units_check/);
      console.log('PASS ETH-STAKE-STATE a refused pool reading reports a provider error; contract and zero moves are refused by the schema');
    }

    // TOKEN-ANY: any ERC-20 token the wallet moves is read with what Etherscan says about it.
    // A token copying USDT's symbol gets a ticker of its own; one without readable decimals is
    // left out. A token no price source lists is left out of the balances, the portfolio and the
    // transaction list on its own (TOKEN-DUST), and the owner can bring it back.
    {
      const holder = address('token-holder');
      const syn = address('syn-token');
      const fakeUsdt = address('fake-usdt');
      const broken = address('broken-token');
      const named = (item, tokenName, tokenDecimal) => ({ ...item, tokenName, tokenDecimal });
      const tokenHistory = {
        normal: [
          normal(30, 20000101, outside, holder, ether(1), 21000, 10 ** 9),
          normal(34, 20000104, holder, syn, 0, 50000, 10 ** 9),
        ],
        internal: [],
        tokens: [
          named(token(31, 20000102, syn, 'SYN', outside, holder, 42n * 10n ** 18n, 1), 'Synthetic Token', '18'),
          token(32, 20000103, fakeUsdt, 'USDT', outside, holder, 5000000n, 1),
          named(token(33, 20000103, broken, 'BRK', outside, holder, 7n, 2), 'Broken', ''),
          named(token(34, 20000104, syn, 'SYN', holder, outside, 2n * 10n ** 18n, 3), 'Synthetic Token', '18'),
        ],
      };
      await post('ethereum', { tip: 20000200, ...tokenHistory });
      const tokenAccount = await account('Tokens');
      const holderId = (await s.addresses.register(owner, { network: 'ethereum', address: holder, accountId: tokenAccount })).value.id;
      const synced = await newRequests(() => s.addresses.sync(owner, holderId));
      assert.deepEqual([synced.result.outcome, synced.result.reason, synced.result.imported], ['complete', null, 5]);
      const fakeTicker = `USDT${fakeUsdt.slice(2, 6).toUpperCase()}`;
      const tokenLegs = [
        { txid: bare(34), asset: null, received: 0n, sent: 50000n * 10n ** 9n, fee: 50000n * 10n ** 9n, direction: 'out', block: 20000104 },
        { txid: `${bare(34)}-3`, asset: syn, received: 0n, sent: 2n * 10n ** 18n, fee: 0n, direction: 'out', block: 20000104 },
        { txid: `${bare(32)}-1`, asset: fakeUsdt, received: 5000000n, sent: 0n, fee: 0n, direction: 'in', block: 20000103 },
        { txid: `${bare(31)}-1`, asset: syn, received: 42n * 10n ** 18n, sent: 0n, fee: 0n, direction: 'in', block: 20000102 },
        { txid: bare(30), asset: null, received: ether(1), sent: 0n, fee: 0n, direction: 'in', block: 20000101 },
      ];
      assertLegs(await stored(db, holderId), tokenLegs);
      assert.deepEqual((await db.query(`SELECT network, contract, symbol, name, decimals, ticker, "coingeckoId"
        FROM chain_tokens ORDER BY ticker`)).map((row) => Object.values(row)), [
        ['ethereum', syn, 'SYN', 'Synthetic Token', 18, 'SYN', null],
        ['ethereum', fakeUsdt, 'USDT', 'USDT', 6, fakeTicker, null],
      ]);
      assert.deepEqual(synced.result.address.balances, [
        { symbol: 'ETH', quantity: '0.999950000000000000' },
        { symbol: 'USDT', quantity: '0.000000' },
        { symbol: 'USDC', quantity: '0.000000' },
      ]);
      // TOKEN-HIDE: the copy of USDT is left out of the balances, and listed apart with its reason;
      // TOKEN-DUST: so is SYN, which no price source lists, with no dust threshold set.
      assert.deepEqual(synced.result.address.hiddenTokens, [
        { symbol: 'SYN', name: 'Synthetic Token', quantity: '40.000000000000000000', reason: 'dust' },
        { symbol: fakeTicker, name: 'USDT', quantity: '5.000000', reason: 'lookalike' },
      ].sort((left, right) => left.symbol.localeCompare(right.symbol)));
      // D1: each token is one market-priced asset, created once however often the sync runs.
      assert.deepEqual((await s.addresses.sync(owner, holderId)).imported, 0);
      const instruments = async () => (await db.query(`SELECT symbol, "priceSource", count(*)::int AS n
        FROM accounting_instruments WHERE "ownerId"=$1 AND symbol = ANY($2) GROUP BY 1, 2 ORDER BY 1`, [owner, ['SYN', fakeTicker]]))
        .map((row) => Object.values(row));
      // A token the address leaves out is no coin of the portfolio: it gets no asset until it is brought back.
      assert.deepEqual(await instruments(), []);
      const rows = async () => {
        const list = (await s.operations.read(owner, {}, now)).operations;
        return [`${bare(31)}-1`, `${bare(32)}-1`, `${bare(34)}-3`].map((txid) => {
          const row = list.find((operation) => operation.chain?.txid === txid);
          return [row.asset.symbol, row.asset.name, row.asset.network, row.quantity, row.estimatedValueUsd, row.status,
            row.fee?.asset.symbol ?? null, row.fee?.quantity ?? null];
        });
      };
      // TOKEN-DUST: every leg of a token the address leaves out is dust, sent or received; none asks.
      assert.deepEqual((await rows()).map((row) => row[5]), ['dust', 'dust', 'dust']);
      const hiddenCount = (await s.classifications.needsClassificationCount(owner)).count;
      // The owner brings SYN back: its legs ask again, and the SYN send shows its ETH gas as its fee (TOKEN-FEE).
      const restored = await s.addresses.setTokenVisibility(owner, holderId, { tickers: ['SYN'], visibility: 'shown' });
      assert.deepEqual(restored.balances.at(-1), { symbol: 'SYN', quantity: '40.000000000000000000', name: 'Synthetic Token', listed: false });
      assert.deepEqual(await instruments(), [['SYN', 'market', 1]]);
      assert.deepEqual(await rows(), [
        ['SYN', 'Synthetic Token', 'ethereum', '42', null, 'needs-classification', null, null],
        [fakeTicker, 'USDT', 'ethereum', '5', null, 'dust', null, null],
        ['SYN', 'Synthetic Token', 'ethereum', '2', null, 'needs-classification', 'ETH', '0.00005'],
      ]);
      assert.equal((await s.classifications.needsClassificationCount(owner)).count, hiddenCount + 2);
      // With a dust threshold set, a restored token with no price is still not dust: its value is not known.
      const { OwnerSettingsService } = require(`${dist}/owner-settings/owner-settings.service.js`);
      await new OwnerSettingsService(db).update(owner, { dustThresholdUsd: '1' });
      assert.deepEqual((await rows()).map((row) => row[5]), ['needs-classification', 'dust', 'needs-classification']);
      assert.equal((await s.classifications.needsClassificationCount(owner)).count, hiddenCount + 2);
      await new OwnerSettingsService(db).update(owner, { dustThresholdUsd: null });
      console.log('PASS TOKEN-ANY any ERC-20 token is read with its symbol, name and decimals; a USDT copycat gets its own ticker; a token without decimals is left out; balances list each token; one market asset per token');
      console.log('PASS TOKEN-DUST a token no price source lists is left out of the balances, the transactions to classify and the list at once, sent or received; the owner brings it back and its legs ask again, with the ETH gas as the fee');

      // TOKEN-BACKFILL: an address synced before every token was read gets its stored history
      // read again for them, once, before anything new; ether legs stay as they are.
      await db.query(`DELETE FROM wallet_address_transactions WHERE "addressId"=$1 AND asset LIKE '0x%'`, [holderId]);
      await db.query('UPDATE wallet_addresses SET "tokenBackfillTo"="scannedBlock" WHERE id=$1', [holderId]);
      const pending = (await s.addresses.list(owner)).find((item) => item.id === holderId);
      assert.deepEqual(pending.balances.map((item) => item.symbol), ['ETH', 'USDT', 'USDC'], 'No token balance from a part of its history');
      const backfill = await newRequests(() => s.addresses.sync(owner, holderId));
      assert.deepEqual([backfill.result.outcome, backfill.result.imported], ['complete', 3]);
      assert.deepEqual(backfill.urls.map(call), [
        ['eth_blockNumber', null, null, null],
        ['tokentx', holder, '0', '20000136'],
      ]);
      assertLegs(await stored(db, holderId), tokenLegs);
      assert.deepEqual((await db.query('SELECT "tokenBackfillTo", "tokenBackfillAt" FROM wallet_addresses WHERE id=$1', [holderId]))[0],
        { tokenBackfillTo: null, tokenBackfillAt: null });
      assert.deepEqual(backfill.result.address.balances.map((item) => item.symbol), ['ETH', 'USDT', 'USDC', 'SYN']);
      assert.deepEqual(backfill.result.address.hiddenTokens.map((item) => item.symbol), [fakeTicker]);
      const after = await newRequests(() => s.addresses.sync(owner, holderId));
      assert.deepEqual([after.result.imported, after.urls.map(call)], [0, [['eth_blockNumber', null, null, null]]]);
      console.log('PASS TOKEN-BACKFILL a wallet read before any token was followed has its old token transfers read once, up to the stored block; no balance shows a token until then');

      // TOKEN-ANY-PRICE: held tokens are priced by contract from CoinGecko, hourly; one CoinGecko
      // does not list gets no price and is asked about once a day.
      const { PricesService } = require(`${dist}/prices/prices.service.js`);
      const { BybitMarketClient } = require(`${dist}/prices/bybit-market.js`);
      const { CoinGeckoClient, KrakenClient } = require(`${dist}/prices/price-providers.js`);
      const { latestMarketPrices } = require(`${dist}/prices/market-price.store.js`);
      const { isUnlistedToken } = require(`${dist}/wallet-addresses/chain-assets.js`);
      const prices = new PricesService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: 'true' }),
        new KrakenClient({ pauseMs: 0, retryPauseMs: 0 }), new CoinGeckoClient(), new BybitMarketClient());
      const geckoCalls = (urls) => urls.filter((url) => url.hostname === 'api.coingecko.com' && url.pathname.startsWith('/api/v3/simple/token_price/'))
        .map((url) => [url.pathname.split('/').pop(), url.searchParams.get('contract_addresses')]);
      const requestsOf = async (action) => {
        const before = (await (await fetch(`${control}/requests`)).json()).length;
        const result = await action();
        const all = await (await fetch(`${control}/requests`)).json();
        return { result, urls: all.slice(before).map(({ url }) => new URL(url)) };
      };
      assert.equal(isUnlistedToken('ethereum', syn), true, 'No source lists the token before it is priced');
      await post('token-prices', { ethereum: { [syn.toLowerCase()]: 0.25 } });
      const priced = await requestsOf(() => prices.collect(new Date()));
      assert.equal(priced.result.outcome, 'collected');
      // Both held tokens are asked about, in one request; only SYN is known.
      assert.deepEqual(geckoCalls(priced.urls), [['ethereum', [syn, fakeUsdt].sort().join(',')]]);
      const stateOf = async () => (await db.query(`SELECT ticker, "coingeckoId", "priceCheckedAt" IS NOT NULL AS checked
        FROM chain_tokens ORDER BY ticker`)).map((row) => Object.values(row));
      assert.deepEqual(await stateOf(), [['SYN', syn, true], [fakeTicker, null, true]]);
      const latest = await latestMarketPrices(db.manager, ['SYN', fakeTicker], new Date());
      assert.deepEqual(latest.map((row) => [row.asset, row.price, row.source]), [['SYN', '0.25', 'coingecko']]);
      assert.equal(isUnlistedToken('ethereum', syn), false, 'The app now knows CoinGecko lists SYN');
      assert.equal(isUnlistedToken('ethereum', fakeUsdt), true);
      // Listed tokens are asked every run; the one CoinGecko does not know, once: it is spam, and
      // spam is not priced again until the owner brings it back.
      const again = await requestsOf(() => prices.collect(new Date()));
      assert.deepEqual(geckoCalls(again.urls), [['ethereum', syn]]);
      await db.query(`UPDATE chain_tokens SET "priceCheckedAt" = now() - interval '25 hours' WHERE contract = $1`, [fakeUsdt]);
      const later = await requestsOf(() => prices.collect(new Date()));
      assert.deepEqual(geckoCalls(later.urls), [['ethereum', syn]], 'An unlisted token is not asked about again by itself');
      // The owner hides SYN: a hidden token is not priced either.
      await s.addresses.setTokenVisibility(owner, holderId, { tickers: ['SYN'], visibility: 'hidden' });
      const hiddenRun = await requestsOf(() => prices.collect(new Date()));
      assert.deepEqual(geckoCalls(hiddenRun.urls), []);
      // The owner brings both back: they are asked about at once, the one checked longest ago first.
      await s.addresses.setTokenVisibility(owner, holderId, { tickers: ['SYN', fakeTicker], visibility: 'shown' });
      const recheck = await requestsOf(() => prices.collect(new Date()));
      assert.deepEqual(geckoCalls(recheck.urls), [['ethereum', `${fakeUsdt},${syn}`]]);
      // A restored unlisted token is asked about once a day again, as long as it stays restored.
      await db.query(`UPDATE chain_tokens SET "priceCheckedAt" = now() - interval '25 hours' WHERE contract = $1`, [fakeUsdt]);
      const daily = await requestsOf(() => prices.collect(new Date()));
      assert.deepEqual(geckoCalls(daily.urls), [['ethereum', `${fakeUsdt},${syn}`]]);
      // Back to the copycat being left out by the app's own rule, as the stages below expect.
      await db.query(`UPDATE wallet_addresses SET "shownTokens" = array_remove("shownTokens", $2) WHERE id = $1`, [holderId, fakeUsdt]);
      await db.query(`DELETE FROM accounting_instruments WHERE "ownerId" = $1 AND symbol = $2`, [owner, fakeTicker]);
      // TOKEN-HIDE: the asset of a coin the wallets leave out is not listed in the portfolio, and
      // is again when the owner brings the token back.
      {
        const { PortfolioValuationService } = require(`${dist}/accounting/portfolio-valuation.service.js`);
        const listed = async (ticker) => (await new PortfolioValuationService(db).read(owner, {}, new Date()))
          .assets.filter((item) => item.symbol === ticker).length;
        assert.equal(await listed('SYN'), 1, 'A token the wallets show is an asset of the portfolio');
        await s.addresses.setTokenVisibility(owner, holderId, { tickers: ['SYN'], visibility: 'hidden' });
        assert.equal(await listed('SYN'), 0, 'A coin the wallets leave out is not listed');
        assert.deepEqual(await instruments(), [['SYN', 'market', 1]], 'Its asset stays; only the table skips it');
        await s.addresses.setTokenVisibility(owner, holderId, { tickers: ['SYN'], visibility: 'shown' });
        assert.equal(await listed('SYN'), 1);
        await prices.collect(new Date());
      }
      // A token no wallet holds any more is not asked about.
      await db.query(`DELETE FROM wallet_address_transactions WHERE "addressId"=$1 AND asset = $2`, [holderId, syn]);
      const sold = await requestsOf(() => prices.collect(new Date()));
      assert.deepEqual(geckoCalls(sold.urls), []);
      assert.equal((await db.query(`SELECT state FROM sync_sources WHERE key='prices:tokens'`))[0].state, 'synced');
      // CoinGecko failing is named, and the tokens are asked again next time.
      await post('token-prices', { status: 429 });
      await db.query(`UPDATE chain_tokens SET "priceCheckedAt" = NULL`);
      await prices.collect(new Date());
      assert.deepEqual((await db.query(`SELECT state, "errorCode", "errorMessage" FROM sync_sources WHERE key='prices:tokens'`))[0],
        { state: 'failed', errorCode: 'rate_limited', errorMessage: 'CoinGecko rate limit reached' });
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM chain_tokens WHERE "priceCheckedAt" IS NULL`))[0].n, 2);
      // The Bybit step never prices a token by its ticker.
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM price_observations WHERE source='bybit'`))[0].n, 0);
      await post('token-prices', {});
      console.log('PASS TOKEN-ANY-PRICE held tokens are priced by contract from CoinGecko, each run; a token it does not list stays unpriced and unlisted and is asked about once a day; a token no wallet holds is not asked; a failure is named; Bybit never prices a token');

      // A token never takes a ticker an existing market asset (a Bybit coin, say) already uses:
      // one asset key names one coin only.
      {
        const collider = address('xrp-token-holder');
        const xrpToken = address('xrp-lookalike');
        await db.query(`INSERT INTO accounting_instruments(id,"ownerId",name,symbol,"requestId","canonicalPayload","assetType","valuationCurrency","priceSource")
          VALUES($1,$2,'XRP',$3,$4,$5,'crypto','USD','market')`, [randomUUID(), owner, 'XRP', randomUUID(), JSON.stringify({ name: 'XRP', symbol: 'XRP' })]);
        await post('ethereum', { tip: 20000400, normal: [normal(60, 20000301, outside, collider, ether(1), 21000, 10 ** 9)], internal: [],
          tokens: [named(token(61, 20000302, xrpToken, 'XRP', outside, collider, 3n * 10n ** 18n, 1), 'Ripple Lookalike', '18')] });
        const colliderId = (await s.addresses.register(owner, { network: 'ethereum', address: collider, accountId: tokenAccount })).value.id;
        assert.equal((await s.addresses.sync(owner, colliderId)).outcome, 'complete');
        const [row] = await db.query(`SELECT symbol, ticker FROM chain_tokens WHERE contract = $1`, [xrpToken]);
        assert.equal(row.symbol, 'XRP');
        assert.equal(row.ticker, `XRP${xrpToken.slice(2, 6).toUpperCase()}`, 'The ticker of the market asset XRP is left to it');
        console.log('PASS TOKEN-TICKER a token named like an existing market asset gets a ticker of its own');
      }

      // TOKEN-HIDE: a token that cannot be real, or one the owner does not want, is left out of an
      // address's balances; the owner can bring either back. The legs stay as stored.
      {
        const spamHolder = address('spam-holder');
        const wanted = address('wanted-token');
        const forged = address('forged-token');
        const copycat = address('copycat-eth');
        await post('ethereum', { tip: 20000600, normal: [normal(70, 20000501, outside, spamHolder, ether(1), 21000, 10 ** 9)], internal: [],
          tokens: [
            named(token(71, 20000502, wanted, 'WANTED', outside, spamHolder, 7000000n, 1), 'Wanted Token', '6'),
            // A forged transfer out of a wallet that never held the token: the history goes below zero.
            named(token(72, 20000503, forged, 'FRG', spamHolder, outside, 3000000000n, 1), 'Forged Token', '6'),
            named(token(73, 20000504, copycat, 'ETH', outside, spamHolder, 40000000n, 1), 'Ether', '6'),
          ] });
        const spamId = (await s.addresses.register(owner, { network: 'ethereum', address: spamHolder, accountId: tokenAccount })).value.id;
        assert.equal((await s.addresses.sync(owner, spamId)).outcome, 'complete');
        const view = async () => (await s.addresses.list(owner)).find((item) => item.id === spamId);
        const copyTicker = `ETH${copycat.slice(2, 6).toUpperCase()}`;
        const tickerOf = (contract) => db.query('SELECT ticker FROM chain_tokens WHERE contract=$1', [contract]).then((rows) => rows[0].ticker);
        const frg = await tickerOf(forged);
        const symbols = (items) => items.map((item) => item.symbol);
        let seen = await view();
        assert.deepEqual(symbols(seen.balances), ['ETH', 'USDT', 'USDC']);
        assert.deepEqual(seen.hiddenTokens, [
          { symbol: copyTicker, name: 'Ether', quantity: '40.000000', reason: 'lookalike' },
          { symbol: frg, name: 'Forged Token', quantity: '-3000.000000', reason: 'negative' },
          { symbol: 'WANTED', name: 'Wanted Token', quantity: '7.000000', reason: 'dust' },
        ].sort((left, right) => left.symbol.localeCompare(right.symbol)));
        assert.equal(seen.chainBalance, '1.000000000000000000', 'ETH is not a token: it always counts');

        // TOKEN-DUST: a token left out is no coin of the portfolio, asks nothing in Transactions
        // and does not count in what needs classifying; the raw legs stay.
        const { readValuationInputs, accountsAt } = require(`${dist}/accounting/portfolio-valuation.service.js`);
        const portfolioSymbols = async () => {
          const inputs = await db.transaction((manager) => readValuationInputs(manager, owner));
          const names = new Map(inputs.instruments.map((item) => [item.id, item.symbol]));
          const held = accountsAt(inputs, new Date().toISOString()).find((item) => item.accountId === tokenAccount);
          return { instruments: new Set(names.values()), held: new Set((held?.lots ?? []).map((lot) => names.get(lot.instrumentId))) };
        };
        const statusOf = async (n) => (await s.operations.read(owner, {}, now)).operations.find((item) => item.chain?.txid === `${bare(n)}-1`).status;
        const leftOutTxs = [71, 72, 73];
        const spamNeeds = (await s.classifications.needsClassificationCount(owner)).count;
        {
          const { instruments, held } = await portfolioSymbols();
          for (const name of ['WANTED', frg, copyTicker]) assert.equal(instruments.has(name) || held.has(name), false, `${name} is no coin of the portfolio`);
          assert.deepEqual(await Promise.all(leftOutTxs.map(statusOf)), ['dust', 'dust', 'dust']);
        }

        // TOKEN-DUST: a token no source lists is left out on its own; once it is listed, one worth less than the dust threshold is.
        {
          const { OwnerSettingsService } = require(`${dist}/owner-settings/owner-settings.service.js`);
          const settings = new OwnerSettingsService(db);
          const hiddenOf = async () => Object.fromEntries((await view()).hiddenTokens.map((item) => [item.symbol, item.reason]));
          assert.equal((await hiddenOf()).WANTED, 'dust', 'Unlisted: worth nothing, with or without a threshold');
          await settings.update(owner, { dustThresholdUsd: '1' });
          assert.equal((await hiddenOf()).WANTED, 'dust');
          const reload = async () => { forgetTokens(); await loadChainTokens(db.manager); };
          const { forgetTokens } = require(`${dist}/wallet-addresses/chain-assets.js`);
          const { loadChainTokens } = require(`${dist}/wallet-addresses/chain-tokens.js`);
          const price = (value, minute) => db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
            VALUES ('WANTED','USD','coingecko', now() - interval '${minute} minutes', $1, 'spot')`, [value]);
          // A listed token whose price is not known yet is not known to be dust.
          await db.query('UPDATE chain_tokens SET "coingeckoId"=$1 WHERE contract=$2', [wanted, wanted]);
          await reload();
          assert.equal((await hiddenOf()).WANTED, undefined);
          // 7 tokens at 0.01 USD are worth 0.07 USD, below the threshold; at 1 USD they are worth 7 USD.
          await price('0.01', 10);
          assert.equal((await hiddenOf()).WANTED, 'dust');
          await price('1', 5);
          assert.equal((await hiddenOf()).WANTED, undefined);
          // Without a threshold a token with a price is never dust, listed or not: the price decides.
          await settings.update(owner, { dustThresholdUsd: null });
          assert.equal((await hiddenOf()).WANTED, undefined);
          await db.query('UPDATE chain_tokens SET "coingeckoId"=NULL WHERE contract=$1', [wanted]);
          await reload();
          assert.equal((await hiddenOf()).WANTED, undefined);
        }
        const choose = (tickers, visibility, id = spamId, who = owner) => s.addresses.setTokenVisibility(who, id, { tickers, visibility });
        const stored = async () => (await db.query('SELECT "hiddenTokens", "shownTokens" FROM wallet_addresses WHERE id=$1', [spamId]))[0];

        // The owner hides a token they do not want.
        seen = await choose(['WANTED'], 'hidden');
        assert.deepEqual(symbols(seen.balances), ['ETH', 'USDT', 'USDC']);
        assert.deepEqual(seen.hiddenTokens.find((item) => item.symbol === 'WANTED'), { symbol: 'WANTED', name: 'Wanted Token', quantity: '7.000000', reason: 'owner' });
        assert.deepEqual(await stored(), { hiddenTokens: [wanted], shownTokens: [] });
        // The choice survives a sync, and the legs are still stored.
        assert.equal((await s.addresses.sync(owner, spamId)).imported, 0);
        assert.deepEqual(symbols((await view()).balances), ['ETH', 'USDT', 'USDC']);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_address_transactions WHERE "addressId"=$1', [spamId]))[0].n, 4);

        // The owner brings back a token the app hid: it shows, with its negative balance.
        seen = await choose([frg], 'shown');
        assert.deepEqual(seen.balances.at(-1), { symbol: frg, quantity: '-3000.000000', name: 'Forged Token', listed: false });
        assert.deepEqual(await stored(), { hiddenTokens: [wanted], shownTokens: [forged] });
        // And hides it again for good; the last word wins and a token is in one list only.
        seen = await choose([frg, 'WANTED'], 'hidden');
        assert.equal(seen.hiddenTokens.find((item) => item.symbol === frg).reason, 'owner');
        assert.deepEqual(await stored(), { hiddenTokens: [wanted, forged].sort(), shownTokens: [] });
        seen = await choose(['WANTED', frg, copyTicker], 'shown');
        assert.deepEqual(symbols(seen.balances), ['ETH', 'USDT', 'USDC', ...[copyTicker, 'WANTED', frg].sort((left, right) => left.localeCompare(right))]);
        assert.deepEqual(seen.hiddenTokens, []);
        // Brought back, the three are coins of the portfolio again and their legs ask to be classified.
        {
          const { held } = await portfolioSymbols();
          for (const name of ['WANTED', copyTicker]) assert.equal(held.has(name), true, `${name} is held again`);
          assert.deepEqual(await Promise.all(leftOutTxs.map(statusOf)), ['needs-classification', 'needs-classification', 'needs-classification']);
          assert.equal((await s.classifications.needsClassificationCount(owner)).count, spamNeeds + 3);
        }

        // Only tokens this address holds can be chosen; a wallet of another network and another owner are refused.
        await refusal(() => choose(['NOSUCH'], 'hidden'), 400);
        await refusal(() => choose(['SYN'], 'hidden'), 400);
        await refusal(() => choose(['USDT'], 'hidden'), 400);
        await refusal(() => choose(['WANTED'], 'gone'), 400);
        await refusal(() => choose([], 'hidden'), 400);
        await refusal(() => choose(['wanted'], 'hidden'), 400);
        await refusal(() => choose(['WANTED'], 'hidden', main, stranger), 404);
        await refusal(() => choose(['WANTED'], 'hidden', randomUUID()), 404);
        assert.deepEqual(await stored(), { hiddenTokens: [], shownTokens: [copycat, forged, wanted].sort() });
        // A balance is not partial while the history is read again for tokens: nothing is hidden or shown then.
        await db.query('UPDATE wallet_addresses SET "tokenBackfillTo"="scannedBlock" WHERE id=$1', [spamId]);
        assert.deepEqual([symbols((await view()).balances), (await view()).hiddenTokens], [['ETH', 'USDT', 'USDC'], []]);
        console.log('PASS TOKEN-HIDE a negative balance, a copy of ETH and a token no source lists are left out of the balances, the portfolio, the list and the count to classify with their reason; the owner hides, brings back and hides tokens, the last word wins, the choice survives a sync and the legs stay; unknown tokens, other owners and bad bodies are refused');
      }
    }

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
